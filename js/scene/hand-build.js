// Build by hand, the 3D side: drag proxies, snap guides, install animations and the moving
// parts of a real build (socket lever, M.2 covers, slot covers). The plan and the rules live
// in assembly.js; the UI (tray, progress, messages) in js/ui/hand-panel.js.
//
// Every piece is already placed by build-scene at its layout pose for the whole build and
// only hidden by the mask, so a seated piece is simply shown again: the hand-built PC is
// the viewer's PC. Proxies and ghosts are clones that share geometry and materials.
// The Auto-build cinematic (cinematic.js) drives the same seat() with `from: 'tray'`.
import * as THREE from 'three';
import { mat } from './materials.js?v=4fbe99bdc0';
import { place } from './build-scene.js?v=4fbe99bdc0';
import { NO_PICK_LAYER } from './case.js?v=4fbe99bdc0';
import { createThumbnailer } from './thumbnails.js?v=4fbe99bdc0';
import { freePieces } from './assembly.js?v=4fbe99bdc0';

const HOVER = 3.2;          // cm a snapped part hovers above its spot
const SNAP_ANGLE = 0.075;   // rad: how close the pointer ray must pass a snap point
const FOLLOW_RATE = 18;     // 1/s: proxy approach to the pointer
const SEAT_S = 0.3;
const SETTLE_S = 0.14;
const LEVER_OPEN = 1.7;     // rad
const COVER_LIFT = 2.6;     // cm
const MECH_RATE = 3.2;      // 1/s for lever, covers and slot covers

// Thumbnail view direction per stage, in the part's own axes (see each model's header).
const THUMB_DIR = {
  prep: [0.35, 0.3, 1], psu: [0.5, 0.35, 1], motherboard: [0.15, 0.1, 1], cpu: [0.3, 0.45, 1],
  radiator: [0.3, 0.35, -1], cooler: [1, 0.45, 0.7], ram: [0.25, 0.8, 1], m2: [0.15, 0.3, 1],
  sata: [0.25, 0.35, 1], gpu: [0.3, 0.3, 1], fans: [0.3, 0.35, 1],
};
// Camera direction (world) when focusing a stage.
const FOCUS_DIR = { fans: [0.55, 0.4, 0.9], radiator: [0.55, 0.45, 0.9], psu: [0.3, 0.2, 1] };

const easeOut = (t) => 1 - (1 - t) ** 3;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

/** Clone without copying userData (three.js deep-copies it as JSON, which models can't survive). */
function cloneClean(obj) {
  const stash = [];
  obj.traverse((o) => { stash.push([o, o.userData]); o.userData = {}; });
  const c = obj.clone(true);
  for (const [o, ud] of stash) o.userData = ud;
  c.traverse((o) => {
    o.visible = true;
    o.layers.set(NO_PICK_LAYER);
  });
  return c;
}
/** Remove a clone; only its instance buffers are its own. */
function dropClone(c) {
  if (!c) return;
  c.removeFromParent();
  c.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
}

/**
 * @param {{viewer: object, bscene: object, rig: object, reducedMotion?: boolean, sound: object}} opts
 */
export function createHandBuild({ viewer, bscene, rig, reducedMotion = false, sound }) {
  const root = bscene.root;
  const raycaster = new THREE.Raycaster();
  const thumbs = new Map(); // key -> data URL
  let thumbnailer = null;

  let plan = null;
  let installed = new Set();
  let stageId = null;
  let active = false;

  // ---- poses (root space)
  const inv = new THREE.Matrix4();
  const m4 = new THREE.Matrix4();
  const scratch = new THREE.Vector3();
  function rootPose(obj) {
    root.updateMatrixWorld(true);
    inv.copy(root.matrixWorld).invert();
    m4.multiplyMatrices(inv, obj.matrixWorld);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    m4.decompose(pos, quat, scratch);
    return { pos, quat };
  }
  function poseOf(placement) {
    const o = new THREE.Object3D();
    place(o, placement);
    return { pos: o.position.clone(), quat: o.quaternion.clone() };
  }

  // ---- source objects for a piece
  function prepKit() {
    const board = bscene.modelOf('motherboard');
    const pc = bscene.modelOf('case');
    const g = new THREE.Group();
    const ff = plan.layout.board?.ff;
    const shield = board?.getObjectByName('io-shield');
    if (shield) {
      const c = cloneClean(shield);
      const { pos, quat } = rootPose(shield);
      c.position.copy(pos);
      c.quaternion.copy(quat);
      g.add(c);
    }
    for (const s of pc?.userData.standoffs ?? []) {
      if (!s.userData.forms.includes(ff)) continue;
      const c = cloneClean(s);
      g.add(c);
    }
    return g;
  }
  /** A fresh clone of a piece in root space at its final pose. */
  function cloneOf(key) {
    const p = plan.pieces.get(key);
    if (p.category === 'prep') return prepKit();
    const src = bscene.pieceObject(key);
    if (!src) return null;
    const c = cloneClean(src);
    const { pos, quat } = rootPose(src);
    c.position.copy(pos);
    c.quaternion.copy(quat);
    if (p.category === 'motherboard') c.getObjectByName('io-shield')?.removeFromParent();
    return c;
  }
  // Local box of a clone at the identity pose (its pose is put back afterwards).
  function localBox(c) {
    const pos = c.position.clone();
    const quat = c.quaternion.clone();
    const parent = c.parent;
    c.removeFromParent();
    c.position.set(0, 0, 0);
    c.quaternion.identity();
    c.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(c);
    c.position.copy(pos);
    c.quaternion.copy(quat);
    parent?.add(c);
    return b;
  }

  // ---- ghosts and guide boxes
  function makeGhost(src, kind) {
    const g = cloneClean(src);
    const m = mat(kind === 'ok' ? 'ghostOk' : kind === 'bad' ? 'ghostBad' : 'ghostHint');
    g.traverse((o) => {
      if (o.isMesh) {
        o.material = m;
        o.castShadow = false;
        o.receiveShadow = false;
        o.renderOrder = 997;
      }
    });
    return g;
  }
  function makeGuide(kind) {
    const h = new THREE.Box3Helper(new THREE.Box3());
    h.material.dispose();
    h.material = mat(kind === 'ok' ? 'guideOk' : kind === 'bad' ? 'guideBad' : 'guideHint');
    h.renderOrder = 998;
    h.layers.set(NO_PICK_LAYER);
    return h;
  }
  function dropGuide(h) {
    if (!h) return;
    h.removeFromParent();
    h.geometry.dispose();
  }
  const worldBox = (obj) => new THREE.Box3().setFromObject(obj).expandByScalar(0.3);

  // ---- drag state
  let drag = null; // { group, proxy, c0, candidates, snapped, goal: {pos, quat}, plane }
  let tweens = [];

  function candidateFor(id, kind, pose, approach, extra) {
    return { id, kind, pose, approach: approach.clone().normalize(), ...extra };
  }

  /** Start dragging a tray group. `ndc` = pointer in normalised device coords (may be off-canvas). */
  function beginDrag(groupKey, ndc) {
    if (!plan) return false;
    cancelDrag();
    const group = plan.groups.find((g) => g.key === groupKey);
    const free = freePieces(plan, installed, groupKey);
    if (!group || !free.length) return false;
    const proxy = cloneOf(free[0]);
    if (!proxy) return false;
    const q0 = proxy.quaternion.clone();
    const b = localBox(proxy);
    const c0 = b.getCenter(new THREE.Vector3());
    const radius = b.getSize(new THREE.Vector3()).length() / 2;

    const candidates = free.map((key) => {
      const p = plan.pieces.get(key);
      const pose = p.category === 'prep' ? { pos: new THREE.Vector3(), quat: new THREE.Quaternion() } : rootPose(bscene.pieceObject(key));
      return candidateFor(key, 'ok', pose, v3(p.explode), { pieceKey: key, hover: Math.min(HOVER, p.dist * 0.6) + 0.6 });
    });
    const approach = v3(plan.pieces.get(free[0]).explode);
    for (const d of group.decoys) candidates.push(candidateFor(d.id, 'bad', poseOf(d.placement), approach, { reason: d.reason, name: d.name, hover: HOVER }));
    for (const c of candidates) c.centre = c.pose.pos.clone().add(c0.clone().applyQuaternion(c.pose.quat));

    // Drag plane: through the middle of the snap points, facing the camera.
    const mid = candidates.reduce((a, c) => a.add(c.centre), new THREE.Vector3()).multiplyScalar(1 / candidates.length);
    const midWorld = root.localToWorld(mid.clone());
    const normal = viewer.camera.getWorldDirection(new THREE.Vector3()).negate();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, midWorld);

    root.add(proxy);
    drag = { group, proxy, q0, c0, radius, candidates, snapped: null, plane, goal: null, ghosts: new Map(), guide: null };
    moveDrag(ndc, { jump: true });
    return true;
  }

  const ray = new THREE.Ray();
  const hit = new THREE.Vector3();
  function moveDrag(ndc, { jump = false } = {}) {
    if (!drag) return null;
    raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), viewer.camera);
    ray.copy(raycaster.ray);
    // Nearest snap point along the pointer ray (angle from the camera), valid spots preferred.
    let best = null;
    let bestScore = Infinity;
    const cam = viewer.camera.position;
    for (const c of drag.candidates) {
      const w = root.localToWorld(c.centre.clone());
      const d = cam.distanceTo(w);
      const angle = ray.distanceToPoint(w) / d;
      const limit = Math.max(SNAP_ANGLE, Math.min(0.16, (drag.radius / d) * 0.45));
      const score = angle * (c.kind === 'bad' ? 1.2 : 1);
      if (angle < limit && score < bestScore) { best = c; bestScore = score; }
    }
    drag.snapped = best;
    if (best) {
      drag.goal = { pos: best.pose.pos.clone().addScaledVector(best.approach, best.hover), quat: best.pose.quat.clone() };
    } else if (ray.intersectPlane(drag.plane, hit)) {
      const local = root.worldToLocal(hit.clone());
      drag.goal = { pos: local.sub(drag.c0.clone().applyQuaternion(drag.q0)), quat: drag.q0.clone() };
    }
    if (jump && drag.goal) {
      drag.proxy.position.copy(drag.goal.pos);
      drag.proxy.quaternion.copy(drag.goal.quat);
    }
    showSnap(best);
    return best ? { snap: best.kind, reason: best.reason ?? null, name: best.name ?? null } : { snap: null };
  }

  function showSnap(c) {
    for (const [id, g] of drag.ghosts) g.visible = c?.id === id;
    if (!c) {
      if (drag.guide) drag.guide.visible = false;
      return;
    }
    let g = drag.ghosts.get(c.id);
    if (!g) {
      g = makeGhost(drag.proxy, c.kind);
      g.position.copy(c.pose.pos);
      g.quaternion.copy(c.pose.quat);
      root.add(g);
      drag.ghosts.set(c.id, g);
    }
    g.visible = true;
    if (drag.guide?.userData.kind !== c.kind) {
      dropGuide(drag.guide);
      drag.guide = makeGuide(c.kind);
      drag.guide.userData.kind = c.kind;
      viewer.scene.add(drag.guide);
    }
    g.updateMatrixWorld(true);
    drag.guide.box.copy(worldBox(g));
    drag.guide.visible = true;
  }

  function clearSnapVisuals(d) {
    for (const g of d.ghosts.values()) dropClone(g);
    d.ghosts.clear();
    dropGuide(d.guide);
    d.guide = null;
  }

  /** Release: { kind: 'ok', pieceKey } | { kind: 'bad', reason } | { kind: 'none' }. The proxy stays until seat() or discard(). */
  function endDrag() {
    if (!drag) return { kind: 'none' };
    const c = drag.snapped;
    clearSnapVisuals(drag);
    if (c?.kind === 'ok') return { kind: 'ok', pieceKey: c.pieceKey };
    if (c?.kind === 'bad') return { kind: 'bad', reason: c.reason };
    return { kind: 'none' };
  }

  function cancelDrag() {
    if (!drag) return;
    clearSnapVisuals(drag);
    dropClone(drag.proxy);
    drag = null;
  }

  // ---- tweens (seat, settle, return to tray)
  // abort() bumps the epoch: running seats drop their proxy and return false without installing.
  let epoch = 0;
  function abort() {
    epoch++;
    tweens.forEach((t) => t.resolve());
    tweens = [];
  }

  /** Root-space position that puts a proxy's centre just under the bottom edge of the view (the tray), at the depth of `pos`. */
  function trayPos(pos, c0, quat) {
    const off = c0.clone().applyQuaternion(quat);
    const depth = root.localToWorld(pos.clone().add(off)).project(viewer.camera).z;
    return root.worldToLocal(new THREE.Vector3(0, -1.25, depth).unproject(viewer.camera)).sub(off);
  }

  function tween(obj, to, dur, ease = easeOut) {
    return new Promise((resolve) => {
      if (reducedMotion || dur <= 0) {
        obj.position.copy(to.pos);
        if (to.quat) obj.quaternion.copy(to.quat);
        if (to.scale) obj.scale.setScalar(to.scale);
        resolve();
        return;
      }
      tweens.push({ obj, t: 0, dur, ease, p0: obj.position.clone(), q0: obj.quaternion.clone(), s0: obj.scale.x, to, resolve });
    });
  }

  /**
   * Ease the dragged proxy (or a new one, for keyboard placing) into `pieceKey`'s spot with a
   * small settle and a click, call `onSeated` (which installs it), then remove the proxy.
   * `from: 'tray'` starts a new proxy small at the tray (under the view) and flies it in over
   * `flyS` seconds. Resolves true once seated, false if abort() cut it short.
   */
  async function seat(pieceKey, { onSeated, from = null, flyS = 0.5 } = {}) {
    const e = epoch;
    let proxy = drag?.proxy;
    drag = null;
    const p = plan.pieces.get(pieceKey);
    const pose = p.category === 'prep' ? { pos: new THREE.Vector3(), quat: new THREE.Quaternion() } : rootPose(bscene.pieceObject(pieceKey));
    const approach = v3(p.explode).normalize();
    const gone = () => {
      if (e === epoch) return false;
      dropClone(proxy);
      return true;
    };
    if (!proxy) {
      proxy = cloneOf(pieceKey);
      proxy.quaternion.copy(pose.quat);
      const hover = pose.pos.clone().addScaledVector(approach, HOVER);
      if (from === 'tray') {
        proxy.position.copy(trayPos(hover, localBox(proxy).getCenter(new THREE.Vector3()), pose.quat));
        proxy.scale.setScalar(0.4);
        root.add(proxy);
        await tween(proxy, { pos: hover, scale: 1 }, flyS, easeInOut);
      } else {
        proxy.position.copy(pose.pos).addScaledVector(approach, Math.max(10, p.dist + 6));
        root.add(proxy);
        await tween(proxy, { pos: hover }, 0.35);
      }
      if (gone()) return false;
    }
    await tween(proxy, { pos: pose.pos.clone().addScaledVector(approach, -0.12), quat: pose.quat }, SEAT_S);
    if (gone()) return false;
    sound.play('click');
    await tween(proxy, { pos: pose.pos }, SETTLE_S, (t) => Math.sin((t * Math.PI) / 2));
    if (gone()) return false;
    onSeated?.(pieceKey);
    dropClone(proxy);
    viewer.invalidateShadows();
    return true;
  }

  /** Send the dragged proxy back to the tray (bottom of the view) and remove it. */
  async function discard() {
    const d = drag;
    drag = null;
    if (!d) return;
    sound.play('return');
    await tween(d.proxy, { pos: trayPos(d.proxy.position, d.c0, d.proxy.quaternion), scale: 0.4 }, 0.32);
    dropClone(d.proxy);
  }

  // ---- "Show me where": hint ghosts at the free spots of a group, pulsing for a few seconds.
  let hint = null; // { ghosts: [], guides: [], t }
  function clearHint() {
    if (!hint) return;
    hint.ghosts.forEach(dropClone);
    hint.guides.forEach(dropGuide);
    hint = null;
    mat('ghostHint').opacity = 0.2;
  }
  function showWhere(groupKey) {
    clearHint();
    const free = freePieces(plan, installed, groupKey);
    if (!free.length) return false;
    hint = { ghosts: [], guides: [], t: 0 };
    for (const key of free) {
      const src = cloneOf(key);
      const g = makeGhost(src, 'hint');
      dropClone(src);
      root.add(g);
      g.updateMatrixWorld(true);
      const h = makeGuide('hint');
      h.box.copy(worldBox(g));
      viewer.scene.add(h);
      hint.ghosts.push(g);
      hint.guides.push(h);
    }
    focusKeys(free, plan.pieces.get(free[0]).stage);
    return true;
  }

  // ---- camera
  function boxOfKeys(keys) {
    const b = new THREE.Box3();
    root.updateMatrixWorld(true);
    for (const key of keys) {
      const p = plan.pieces.get(key);
      const obj = p.category === 'prep' ? bscene.modelOf('motherboard') : bscene.pieceObject(key);
      if (obj) b.expandByObject(obj);
    }
    return b;
  }
  function focusKeys(keys, stage, opts) {
    // Standoffs and I/O shield: the whole case, so the rear cut-out and the tray both show.
    const b = stage === 'prep' ? new THREE.Box3().setFromObject(bscene.modelOf('case') ?? root) : boxOfKeys(keys);
    if (b.isEmpty()) return;
    const sphere = b.getBoundingSphere(new THREE.Sphere());
    rig.focus(sphere.center, Math.max(12, sphere.radius * (stage === 'prep' ? 0.85 : 1.25)), FOCUS_DIR[stage] ?? [0.3, 0.25, 1], opts);
  }
  /** Ease the camera to a stage's work area. `opts` go to rig.focus ({ animate, dur }). */
  function focusStage(id, opts) {
    if (!plan || !id) return;
    const keys = plan.groups.filter((g) => g.stage === id).flatMap((g) => g.pieces);
    focusKeys(keys, id, opts);
  }

  // ---- mechanisms: socket lever, M.2 covers, slot covers
  const mech = { lever: 0, covers: new Map(), slots: new Map() }; // current 0..1 per item
  function mechGoals() {
    const goals = { lever: 0, covers: new Map(), slots: new Map() };
    if (!active || !plan) return goals;
    const L = plan.layout;
    const cpuIn = [...plan.pieces.values()].some((p) => p.stage === 'cpu' && installed.has(p.key));
    goals.lever = stageId === 'cpu' && !cpuIn ? 1 : 0;
    for (const s of L.storage) {
      if (s.kind !== 'm2') continue;
      const piece = [...plan.pieces.values()].find((p) => p.category === 'storage' && p.index === s.index);
      if (piece) goals.covers.set(s.slot, stageId === 'm2' && !installed.has(piece.key) ? 1 : 0);
    }
    const gpuIdx = plan.stages.findIndex((s) => s.id === 'gpu');
    const curIdx = stageId ? plan.stages.findIndex((s) => s.id === stageId) : plan.stages.length;
    const off = gpuIdx >= 0 && curIdx >= gpuIdx;
    for (const i of L.gpu?.covers ?? []) goals.slots.set(i, off ? 1 : 0);
    return goals;
  }
  function applyMech(dt) {
    const goals = mechGoals();
    const step = (cur, goal) => (reducedMotion ? goal : cur + Math.sign(goal - cur) * Math.min(Math.abs(goal - cur), dt * MECH_RATE));
    let changed = false;
    let maskDirty = false;
    const board = bscene.modelOf('motherboard');
    const mechs = board?.userData.mechanisms;
    const nl = step(mech.lever, goals.lever);
    if (nl !== mech.lever) { mech.lever = nl; changed = true; }
    if (mechs?.lever) mechs.lever.rotation.x = LEVER_OPEN * easeOut(mech.lever);
    for (const { slot, cover } of mechs?.m2Covers ?? []) {
      const cur = mech.covers.get(slot) ?? 0;
      const n = step(cur, goals.covers.get(slot) ?? 0);
      if (n !== cur) { mech.covers.set(slot, n); changed = true; }
      cover.position.z = COVER_LIFT * easeOut(n);
    }
    const covers = bscene.modelOf('case')?.userData.slotCovers ?? [];
    covers.forEach((c, i) => {
      c.userData.baseX ??= c.position.x;
      const cur = mech.slots.get(i) ?? 0;
      const n = step(cur, goals.slots.get(i) ?? 0);
      if (n !== cur) {
        if ((cur >= 1) !== (n >= 1)) maskDirty = true;
        mech.slots.set(i, n);
        changed = true;
      }
      c.position.x = c.userData.baseX - 4 * easeOut(n);
    });
    if (maskDirty) bscene.setMask(maskFn);
    // Static shadows: redraw once the moving parts come to rest.
    if (changed) mech.moving = true;
    else if (mech.moving) {
      mech.moving = false;
      viewer.invalidateShadows();
    }
  }
  function resetMech() {
    mech.lever = 0;
    mech.covers.clear();
    mech.slots.clear();
    const mechs = bscene.modelOf('motherboard')?.userData.mechanisms;
    if (mechs?.lever) mechs.lever.rotation.x = 0;
    for (const { cover } of mechs?.m2Covers ?? []) cover.position.z = 0;
    for (const c of bscene.modelOf('case')?.userData.slotCovers ?? []) if (c.userData.baseX !== undefined) c.position.x = c.userData.baseX;
  }

  // ---- mask: what is in the case
  function maskFn(key) {
    if (!plan) return false;
    if (plan.pieces.has(key)) return installed.has(key);
    const prep = [...plan.pieces.values()].find((p) => p.stage === 'prep');
    const prepIn = !!prep && installed.has(prep.key);
    if (key === 'board:io-shield') return prepIn;
    if (key.startsWith('case:standoff:')) return prepIn && key.endsWith(`:${plan.layout.board?.ff}`);
    if (key.startsWith('case:slot-cover:')) return (mech.slots.get(Number(key.split(':')[2])) ?? 0) < 1;
    if (key === 'cables:aio') {
      const cooler = [...plan.pieces.values()].filter((p) => p.category === 'cooler');
      return cooler.length > 1 && cooler.every((p) => installed.has(p.key));
    }
    return false; // PSU cables: Phase 5B
  }

  // ---- thumbnails
  const thumbKey = (group) => `${group.key}|${group.part?.id ?? group.formFactor}`;
  function thumbnail(group) {
    const key = thumbKey(group);
    if (thumbs.has(key)) return thumbs.get(key);
    thumbnailer ??= createThumbnailer(viewer);
    const src = cloneOf(group.pieces[0]);
    if (!src) return null;
    if (group.stage !== 'prep') {
      src.position.set(0, 0, 0);
      src.quaternion.identity();
    }
    const url = thumbnailer.shoot(src, THUMB_DIR[group.stage]);
    dropClone(src);
    if (url) thumbs.set(key, url);
    return url;
  }

  // ---- per frame
  function update(dt) {
    if (drag?.goal && !tweens.some((t) => t.obj === drag.proxy)) {
      const k = Math.min(1, dt * FOLLOW_RATE);
      drag.proxy.position.lerp(drag.goal.pos, reducedMotion ? 1 : k);
      drag.proxy.quaternion.slerp(drag.goal.quat, reducedMotion ? 1 : k);
    }
    if (tweens.length) {
      const next = [];
      for (const tw of tweens) {
        tw.t = Math.min(1, tw.t + dt / tw.dur);
        const e = tw.ease(tw.t);
        tw.obj.position.lerpVectors(tw.p0, tw.to.pos, e);
        if (tw.to.quat) tw.obj.quaternion.slerpQuaternions(tw.q0, tw.to.quat, e);
        if (tw.to.scale) tw.obj.scale.setScalar(tw.s0 + (tw.to.scale - tw.s0) * e);
        if (tw.t >= 1) tw.resolve(); else next.push(tw);
      }
      tweens = next;
    }
    if (hint) {
      hint.t += dt;
      mat('ghostHint').opacity = reducedMotion ? 0.24 : 0.12 + 0.16 * (0.5 - 0.5 * Math.cos(hint.t * Math.PI * 1.6));
      if (hint.t > 4) clearHint();
    }
    if (active) applyMech(dt);
  }

  return {
    update,
    /** Enter build mode: panel off, no explode, mask on. */
    enter({ animate = true } = {}) {
      active = true;
      bscene.setExplode(0, { animate: false });
      bscene.setSidePanel(false, { animate: animate && !reducedMotion });
      bscene.setMask(maskFn);
    },
    leave() {
      active = false;
      cancelDrag();
      clearHint();
      abort();
      resetMech();
      bscene.setMask(null);
      bscene.setSidePanel(true);
    },
    /** New plan and/or installed set. `stage` = current stage id (or null when complete). */
    setState(nextPlan, nextInstalled, stage) {
      plan = nextPlan;
      installed = new Set(nextInstalled);
      stageId = stage;
      if (active) bscene.setMask(maskFn);
    },
    beginDrag,
    moveDrag,
    endDrag,
    cancelDrag,
    seat,
    abort,
    discard,
    get dragging() { return !!drag; },
    get animating() { return tweens.length > 0; },
    showWhere,
    clearHint,
    focusStage,
    /** Tray thumbnail (data URL) for a group, rendered on first use; null if its model isn't ready. */
    thumbnail,
    cachedThumb: (group) => thumbs.get(thumbKey(group)) ?? null,
    /** Canvas CSS point of a group's first free spot (or a decoy), for tests and hints. */
    screenPoint(groupKey, { decoy = null } = {}) {
      const group = plan?.groups.find((g) => g.key === groupKey);
      const free = freePieces(plan, installed, groupKey);
      if (!group || !free.length) return null;
      const src = cloneOf(free[0]);
      const c0 = localBox(src).getCenter(new THREE.Vector3());
      let pose;
      if (decoy !== null) pose = poseOf(group.decoys[decoy].placement);
      else pose = plan.pieces.get(free[0]).category === 'prep' ? { pos: new THREE.Vector3(), quat: new THREE.Quaternion() } : rootPose(bscene.pieceObject(free[0]));
      dropClone(src);
      const w = root.localToWorld(pose.pos.clone().add(c0.applyQuaternion(pose.quat))).project(viewer.camera);
      const r = viewer.renderer.domElement.getBoundingClientRect();
      return { x: r.left + (w.x + 1) / 2 * r.width, y: r.top + (1 - w.y) / 2 * r.height };
    },
    dispose() {
      this.leave();
      thumbnailer?.dispose();
      thumbs.clear();
    },
  };
}
