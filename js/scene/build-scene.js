// Keeps the 3D scene in step with the build. One model per part, built once and reused:
// a change rebuilds only the parts that changed and disposes the ones removed. Everything
// else just moves to its new placement from layoutBuild(). Also runs the exploded view.
// Fan speed and lighting live in effects.js.
// Build-by-hand sets a visibility mask (setMask) so only installed pieces show; every piece
// still sits at its layoutBuild() placement for the whole build.
import * as THREE from 'three';
import { layoutBuild, cross, FOOT } from './layout.js';
import { createModel, MODELLED } from './parts.js';
import { partSlots, pieceKey } from './assembly.js';
import { buildGhostCase, NO_PICK_LAYER } from './case.js';
import { disposeTree } from './resources.js';
import { mat, finish } from './materials.js';
import { tubeLook } from './models/cooler.js';

const PANEL_SECONDS = 0.35;
const EXPLODE_RATE = 5;     // 1/s: exponential approach to the slider value
const PANEL_EXPLODE = 22;   // extra cm the side panel moves out at 100 %

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const basis = new THREE.Matrix4();

/** Set an object's pose from a layout placement { p, ex, ey }. */
export function place(obj, { p, ex, ey }) {
  basis.makeBasis(v3(ex), v3(ey), v3(cross(ex, ey)));
  obj.quaternion.setFromRotationMatrix(basis);
  obj.position.set(p[0], p[1], p[2]);
}

function isShown(o) {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/**
 * @param {{viewer: object, anisotropy?: number, reducedMotion?: boolean, onChange?: (layout: object) => void}} opts
 */
export function createBuildScene({ viewer, anisotropy = 4, reducedMotion = false, onChange, theme: theme0 = 'auto' }) {
  let theme = theme0; // black / white build theme (look.js), applied when models are built
  const root = new THREE.Group();
  root.name = 'build';
  root.position.y = FOOT;
  viewer.scene.add(root);

  const slots = new Map(); // key -> { key, category, part, index, model }
  let layout = null;
  let current = null; // the build `layout` was computed from
  let ghost = null;
  const cables = new Map(); // name -> { sig, group }
  let target = null;
  let explodeGoal = 0;
  let explodeT = 0;
  let mask = null; // (key) => boolean while building by hand

  // ---- sync (serialised: a newer build waits for the current one, older ones are skipped)
  let pending = null;
  let busy = false;
  function sync(build) {
    pending = build;
    if (!busy) pump();
  }
  async function pump() {
    busy = true;
    try {
      while (pending) {
        const b = pending;
        pending = null;
        await apply(b);
      }
    } finally {
      busy = false;
    }
  }

  async function apply(build) {
    layout = layoutBuild(build);
    current = build;
    const want = partSlots(build, MODELLED);
    const keys = new Set(want.map((w) => w.key));
    for (const [k, s] of slots) {
      if (!keys.has(k)) {
        disposeTree(s.model);
        slots.delete(k);
      }
    }
    for (const w of want) {
      let s = slots.get(w.key);
      if (!s) {
        const model = await createModel(w.part, { caseLayout: layout.case, anisotropy, theme });
        model.userData.slotKey = w.key;
        root.add(model);
        s = { ...w, model };
        slots.set(w.key, s);
        if (w.category === 'case') applyPanel();
      }
      s.index = w.index;
      s.part = w.part;
    }

    // Ghost outline while no case is chosen.
    if (!build.case && !ghost) {
      ghost = buildGhostCase(layout.case);
      root.add(ghost);
    }
    if (ghost) ghost.visible = !build.case;

    placeAll();
    updateCables(build);
    applyMask();
    applyExplode();
    refreshHighlight();
    viewer.invalidateShadows();
    onChange?.(layout);
  }

  // Every placed object remembers its base pose and explode direction for applyExplode().
  function put(obj, it, key) {
    obj.userData.placed = !!it?.placement;
    obj.userData.pieceKey = key;
    obj.visible = !!it?.placement;
    if (!it?.placement) return;
    place(obj, it.placement);
    obj.userData.base = obj.position.clone();
    obj.userData.explode = v3(it.explode ?? [0, 0, 1]).multiplyScalar(it.dist ?? 6);
  }
  function placeAll() {
    for (const s of slots.values()) {
      if (s.category === 'case') continue; // standoffs and slot covers: applyMask()
      const items = layout.items.filter((it) => it.category === s.category && it.index === s.index);
      const units = s.model.userData.units;
      if (units) units.forEach((u, i) => put(u, items.find((it) => it.unit === i), pieceKey(s.key, i)));
      else put(s.model, items.find((it) => it.unit === null), pieceKey(s.key, null));
    }
  }

  // ---- build-by-hand mask. Keys: piece keys (assembly.js), 'case:standoff:<ff>',
  // 'case:slot-cover:<i>', 'board:io-shield', 'cables:psu', 'cables:aio'.
  function applyMask() {
    const show = mask ?? (() => true);
    for (const s of slots.values()) {
      const ud = s.model.userData;
      if (s.category === 'case') {
        (ud.standoffs ?? []).forEach((m) => { m.visible = !mask || m.userData.forms.some((ff) => show(`case:standoff:${ff}`)); });
        if (mask) (ud.slotCovers ?? []).forEach((c, i) => { c.visible = show(`case:slot-cover:${i}`); });
        continue;
      }
      const pieces = ud.units ?? [s.model];
      for (const o of pieces) o.visible = !!o.userData.placed && show(o.userData.pieceKey);
      if (s.category === 'motherboard') {
        // Shield only: the I/O plate goes in before the board.
        const shieldOnly = !s.model.visible && !!s.model.userData.placed && !!mask && show('board:io-shield');
        if (shieldOnly) s.model.visible = true;
        for (const c of s.model.children) c.visible = !shieldOnly || c.name === 'io-shield';
      }
    }
    for (const [name, c] of cables) c.group.visible = explodeT < 0.02 && (!mask || show(name === 'psu-cables' ? 'cables:psu' : 'cables:aio'));
    if (!mask) placeAllCovers();
  }
  // Viewer: hide the slot covers the graphics card's bracket replaces.
  function placeAllCovers() {
    const c = [...slots.values()].find((x) => x.category === 'case');
    (c?.model.userData.slotCovers ?? []).forEach((m, i) => { m.visible = !layout?.gpu?.covers.includes(i); });
  }

  // Cables in case space: the PSU bundle (to the lowest grommet, behind the tray) and AIO tubes.
  // Rebuilt only when their route changes; tagged with their part's key so hovering picks the part.
  function cableSet(name, slot, routes, radius, material) {
    const sig = slot && routes.length ? JSON.stringify([slot.key, routes, radius]) : '';
    const old = cables.get(name);
    if (old?.sig === sig) return;
    if (old) disposeTree(old.group);
    cables.delete(name);
    if (!sig) return;
    const group = new THREE.Group();
    group.name = name;
    for (const pts of routes) {
      const curve = new THREE.CatmullRomCurve3(pts.map((p) => v3(p)));
      const geo = new THREE.TubeGeometry(curve, 48, radius, 10, false);
      // Tile the sleeve weave by real length (the default UV runs 0..1 along any tube).
      const uv = geo.attributes.uv;
      const reps = curve.getLength() / 1.2;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * reps, uv.getY(i) * 3);
      const tube = new THREE.Mesh(geo, material);
      tube.castShadow = true;
      group.add(tube);
    }
    group.userData.slotKey = slot.key;
    root.add(group);
    cables.set(name, { sig, group });
  }
  function updateCables(build) {
    const slotOf = (c) => [...slots.values()].find((s) => s.category === c);
    const psu = slotOf('psu');
    const pts = layout.psu?.bundle;
    const routes = pts ? [[0, 0], [0.9, 0.2], [-0.9, -0.1]].map(([dy, dz]) => pts.map((p, i) => [p[0], p[1] + (i ? dy : dy * 0.5), p[2] + (i > 1 ? dz : 0)])) : [];
    cableSet('psu-cables', psu, routes, build.psu?.modular === 'full' ? 0.45 : 0.6, mat('sleeve'));
    const tube = tubeLook(build.cooler, theme);
    cableSet('aio-tubes', slotOf('cooler'), layout.cooler?.tubes ?? [], tube.radius, finish('sleeve', tube.colour));
  }

  // ---- exploded view: parts move along their layout direction; cables hide while apart
  function applyExplode() {
    const e = explodeT * explodeT * (3 - 2 * explodeT);
    root.traverse((o) => {
      if (o.userData.base) o.position.copy(o.userData.base).addScaledVector(o.userData.explode, e);
    });
    applyMask();
    applyPanel();
  }

  // ---- highlight: accent boxes drawn on top of everything (shows parts hidden under covers too)
  const helpers = [];
  function helper(i) {
    if (!helpers[i]) {
      const h = new THREE.Box3Helper(new THREE.Box3());
      h.material.dispose();
      h.material = mat('highlight');
      h.renderOrder = 999;
      h.layers.set(NO_PICK_LAYER);
      viewer.scene.add(h);
      helpers[i] = h;
    }
    return helpers[i];
  }
  function targets() {
    if (!target) return [];
    const out = [];
    for (const s of slots.values()) {
      if (s.category !== target.category || (target.id && s.part.id !== target.id)) continue;
      const units = s.model.userData.units;
      if (units) out.push(...units.filter((u) => u.visible));
      else if (s.model.visible) out.push(s.model);
    }
    return out;
  }
  function refreshHighlight() {
    root.updateMatrixWorld(true);
    const objs = targets();
    objs.forEach((o, i) => {
      const h = helper(i);
      h.box.setFromObject(o).expandByScalar(0.25);
      h.visible = true;
    });
    for (let i = objs.length; i < helpers.length; i++) helpers[i].visible = false;
    return objs.length > 0;
  }

  // ---- picking
  const raycaster = new THREE.Raycaster();
  function pick(ndc) {
    raycaster.setFromCamera(ndc, viewer.camera);
    for (const hit of raycaster.intersectObject(root, true)) {
      if (!isShown(hit.object)) continue;
      let o = hit.object;
      while (o && !o.userData.slotKey) o = o.parent;
      const s = o && slots.get(o.userData.slotKey);
      if (s) return { category: s.category, id: s.part.id, part: s.part, approx: s.model.userData.approx ?? [] };
    }
    return null;
  }

  // ---- side panel: slides out toward the viewer, then hides
  let panelOn = true;
  let panelT = 1;
  function panelNode() {
    return [...slots.values()].find((s) => s.category === 'case')?.model.userData.sidePanel ?? null;
  }
  function applyPanel() {
    const p = panelNode();
    if (!p) return;
    p.userData.baseZ ??= p.position.z;
    const e = panelT * panelT * (3 - 2 * panelT);
    const ex = explodeT * explodeT * (3 - 2 * explodeT);
    p.position.z = p.userData.baseZ + (1 - e) * 14 + ex * PANEL_EXPLODE;
    p.visible = panelT > 0.001;
  }
  function setSidePanel(on, { animate = !reducedMotion } = {}) {
    panelOn = on;
    if (!animate) panelT = on ? 1 : 0;
    applyPanel();
    viewer.invalidateShadows();
  }

  // ---- per frame
  function update(dt) {
    const goal = panelOn ? 1 : 0;
    if (panelT !== goal) {
      panelT = goal > panelT ? Math.min(1, panelT + dt / PANEL_SECONDS) : Math.max(0, panelT - dt / PANEL_SECONDS);
      applyPanel();
      if (panelT === goal) viewer.invalidateShadows();
    }
    if (explodeT !== explodeGoal) {
      const d = explodeGoal - explodeT;
      explodeT = reducedMotion || Math.abs(d) < 0.002 ? explodeGoal : explodeT + d * Math.min(1, dt * EXPLODE_RATE);
      applyExplode();
      if (target) refreshHighlight();
      viewer.invalidateShadows();
    }
  }

  return {
    root,
    sync,
    update,
    pick,
    setSidePanel,
    get sidePanel() { return panelOn; },
    get layout() { return layout; },
    get build() { return current; },
    get busy() { return busy || !!pending; },
    /** Build-by-hand: show only what `fn(key)` allows (see applyMask); null shows everything. */
    setMask(fn) {
      mask = fn;
      applyMask();
      refreshHighlight();
      viewer.invalidateShadows();
    },
    /** The object for a piece key (a unit or a whole model), placed at its layout pose. */
    pieceObject(key) {
      for (const s of slots.values()) {
        for (const o of s.model.userData.units ?? [s.model]) if (o.userData.pieceKey === key) return o;
      }
      return null;
    },
    /** The model for a category (first one), e.g. the case or the motherboard. */
    modelOf: (category) => [...slots.values()].find((s) => s.category === category)?.model ?? null,
    /** Highlight a part ({category, id}) or a whole category ({category}); null clears. Returns true if anything is shown. */
    highlight(t) {
      target = t;
      return refreshHighlight();
    },
    /** Hide highlight boxes (e.g. for a screenshot) without forgetting the target. */
    setHelpersVisible(on) {
      if (!on) helpers.forEach((h) => { h.visible = false; });
      else refreshHighlight();
    },
    has: (category) => [...slots.values()].some((s) => s.category === category),
    get theme() { return theme; },
    /** Black / white build theme: rebuilds every model in the colour its product is sold in. */
    setTheme(t) {
      if (t === theme) return;
      theme = t;
      for (const s of slots.values()) disposeTree(s.model);
      slots.clear();
      for (const c of cables.values()) disposeTree(c.group);
      cables.clear();
      if (current) sync(current);
    },
    /** Exploded view amount, 0..1 (animates toward it). */
    setExplode(v, { animate = true } = {}) {
      explodeGoal = Math.min(1, Math.max(0, v));
      if (!animate) {
        explodeT = explodeGoal;
        applyExplode();
        viewer.invalidateShadows();
      }
    },
    get explode() { return explodeGoal; },
    /** Current models, for effects.js: [{ key, category, part, model }]. */
    get models() { return [...slots.values()]; },
    approxFor: (category, id) => [...slots.values()].find((s) => s.category === category && (!id || s.part.id === id))?.model.userData.approx ?? [],
  };
}
