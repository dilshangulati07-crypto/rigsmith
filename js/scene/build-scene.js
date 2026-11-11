// Keeps the 3D scene in step with the build. One model per part, built once and reused:
// a change rebuilds only the parts that changed and disposes the ones removed. Everything
// else just moves to its new placement from layoutBuild().
import * as THREE from 'three';
import { layoutBuild, cross, FOOT } from './layout.js';
import { createModel, MODELLED } from './parts.js';
import { buildGhostCase, NO_PICK_LAYER } from './case.js';
import { disposeTree } from './resources.js';
import { mat } from './materials.js';

const FAN_RPS = 2.2; // on-screen revolutions per second at 1800 rpm (real speeds alias at 60 fps)
const PANEL_SECONDS = 0.35;

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const basis = new THREE.Matrix4();

function place(obj, { p, ex, ey }) {
  basis.makeBasis(v3(ex), v3(ey), v3(cross(ex, ey)));
  obj.quaternion.setFromRotationMatrix(basis);
  obj.position.set(p[0], p[1], p[2]);
}

function isShown(o) {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
}

// Slots the build needs, keyed so a part keeps its model when other parts change.
function wantedSlots(build) {
  const out = [];
  for (const category of MODELLED) {
    const v = build[category];
    if (Array.isArray(v)) {
      const seen = {};
      v.forEach((part, index) => {
        seen[part.id] = (seen[part.id] ?? 0) + 1;
        out.push({ key: `${category}:${part.id}:${seen[part.id]}`, category, part, index });
      });
    } else if (v) out.push({ key: `${category}:${v.id}`, category, part: v, index: 0 });
  }
  return out;
}

/**
 * @param {{viewer: object, anisotropy?: number, reducedMotion?: boolean, onChange?: (layout: object) => void}} opts
 */
export function createBuildScene({ viewer, anisotropy = 4, reducedMotion = false, onChange }) {
  const root = new THREE.Group();
  root.name = 'build';
  root.position.y = FOOT;
  viewer.scene.add(root);

  const slots = new Map(); // key -> { key, category, part, index, model }
  let layout = null;
  let ghost = null;
  let bundle = null;
  let bundleSig = '';
  let target = null;

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
    const want = wantedSlots(build);
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
        const model = await createModel(w.part, { caseLayout: layout.case, anisotropy });
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
    updateBundle(build);
    refreshHighlight();
    viewer.invalidateShadows();
    onChange?.(layout);
  }

  function placeAll() {
    for (const s of slots.values()) {
      const m = s.model;
      if (s.category === 'motherboard' && layout.board) place(m, layout.board.placement);
      else if (s.category === 'psu' && layout.psu) place(m, layout.psu.placement);
      else if (s.category === 'storage') {
        const e = layout.storage.find((x) => x.index === s.index);
        m.visible = !!e?.placement;
        if (e?.placement) place(m, e.placement);
      } else if (s.category === 'fans') {
        const entries = layout.fans.filter((f) => f.partIndex === s.index);
        (m.userData.units ?? []).forEach((u, i) => {
          const f = entries.find((e) => e.unit === i);
          u.visible = !!f;
          if (f) place(u, f.placement);
        });
      }
    }
  }

  // PSU cable bundle, routed behind the tray to the lowest grommet. Rebuilt only when the
  // PSU position changes. Lives in case space; tagged with the PSU's key so hovering it picks the PSU.
  function updateBundle(build) {
    const psuSlot = [...slots.values()].find((s) => s.category === 'psu');
    const sig = psuSlot && layout.psu ? JSON.stringify([psuSlot.key, layout.psu.bundle]) : '';
    if (sig === bundleSig) return;
    bundleSig = sig;
    if (bundle) disposeTree(bundle);
    bundle = null;
    if (!sig) return;
    bundle = new THREE.Group();
    bundle.name = 'psu-cables';
    const pts = layout.psu.bundle;
    const thick = build.psu?.modular === 'full' ? 0.45 : 0.6;
    for (const [dy, dz] of [[0, 0], [0.9, 0.2], [-0.9, -0.1]]) {
      const curve = new THREE.CatmullRomCurve3(pts.map((p, i) => new THREE.Vector3(p[0], p[1] + (i ? dy : dy * 0.5), p[2] + (i > 1 ? dz : 0))));
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, thick, 10, false), mat('sleeve'));
      tube.castShadow = true;
      bundle.add(tube);
    }
    bundle.userData.slotKey = psuSlot.key;
    root.add(bundle);
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
      if (s.category === 'fans') out.push(...(s.model.userData.units ?? []).filter((u) => u.visible));
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
      if (s) return { category: s.category, id: s.part.id, part: s.part };
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
    p.position.z = p.userData.baseZ + (1 - e) * 14;
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
    if (reducedMotion) return;
    for (const s of slots.values()) {
      if (s.category !== 'fans') continue;
      const speed = FAN_RPS * Math.min(1.25, Math.max(0.6, (s.part.rpmMax ?? 1800) / 1800)) * Math.PI * 2 * dt;
      for (const r of s.model.userData.rotors ?? []) r.rotation.z += speed;
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
    get busy() { return busy || !!pending; },
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
  };
}
