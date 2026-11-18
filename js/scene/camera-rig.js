// Camera presets framed from the real case size, eased transitions, orbit limits, a pan
// clamp that keeps the target inside the case, and a slow idle sway in the viewer.
// The default 3/4 view frames the parts (board, graphics card), not the whole case; "Full"
// shows the whole case from the same side.
import * as THREE from 'three';
import { FOOT, SIDE } from './layout.js?v=00a22f4faf';

export const CAMERA_PRESETS = Object.freeze([
  { id: 'angle', label: '3/4', dir: [0.6, 0.3, 0.74], parts: true },
  { id: 'full', label: 'Full', dir: [0.62, 0.32, 0.72] },
  { id: 'front', label: 'Front', dir: [1, 0.1, 0.03] },
  { id: 'side', label: 'Side', dir: [0.03, 0.1, 1] },
  { id: 'top', label: 'Top', dir: [0.12, 1, 0.16] },
  { id: 'inside', label: 'Inside', dir: [0.24, 0.14, 1], inside: true },
]);

const UP = new THREE.Vector3(0, 1, 0);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
// Idle sway: `idle` s after the last input the camera swings ±`amp` rad around the target, one
// swing every `period` s, easing in over `ramp` s. Any input stops it where it is.
const SWAY = { amp: 0.24, period: 28, idle: 3.5, ramp: 2.5 };

/**
 * Where the parts are, for framing them rather than the whole case: board and graphics card
 * in x/y, the middle of the main chamber in depth. Null without a motherboard.
 * @returns {{center: THREE.Vector3, radius: number}|null}
 */
export function partsFrame(layout) {
  const b = layout.board;
  if (!b) return null;
  const c = layout.case;
  const lo = [b.x0, b.y0];
  const hi = [b.x1, b.y1];
  const g = layout.gpu?.box;
  if (g) for (const a of [0, 1]) { lo[a] = Math.min(lo[a], g.min[a]); hi[a] = Math.max(hi[a], g.max[a]); }
  return {
    center: new THREE.Vector3((lo[0] + hi[0]) / 2, FOOT + (lo[1] + hi[1]) / 2, (c.trayZ + c.W / 2 - SIDE) / 2),
    radius: Math.max(14, 0.5 * Math.hypot(hi[0] - lo[0], hi[1] - lo[1]) * 1.2),
  };
}

/** Distance at which a sphere of radius `r` fills the narrower field of view of `camera`. */
export function fitDistance(camera, r) {
  const v = THREE.MathUtils.degToRad(camera.fov);
  const h = 2 * Math.atan(Math.tan(v / 2) * camera.aspect);
  return r / Math.sin(Math.min(v, h) / 2);
}

/**
 * @param {{camera: THREE.PerspectiveCamera, controls: object}} viewer
 * @param {{reducedMotion?: boolean, onPresetChange?: (id: string|null) => void}} opts
 */
export function createCameraRig(viewer, { reducedMotion = false, onPresetChange } = {}) {
  const { camera, controls } = viewer;
  controls.minPolarAngle = 0.02;
  controls.maxPolarAngle = Math.PI / 2 - 0.03; // never below the floor
  controls.minDistance = 8;

  let current = 'angle';
  let frame = null; // { center, radius, inside, min, max }
  let tween = null;
  let locked = false; // the Auto-build cinematic owns the camera: no orbiting by hand

  const sway = { on: false, idle: 0, phase: 0, applied: 0, held: false };
  const restSway = () => { sway.idle = 0; sway.phase = 0; sway.applied = 0; };

  controls.addEventListener('end', () => { sway.held = false; restSway(); });
  controls.addEventListener('start', () => {
    sway.held = true;
    restSway();
    tween = null;
    controls.enabled = true;
    if (current) {
      current = null;
      onPresetChange?.(null);
    }
  });

  function setFrame(layout) {
    const c = layout.case;
    const center = new THREE.Vector3(0, FOOT + c.H / 2, 0);
    const b = layout.board;
    const inside = b
      ? new THREE.Vector3((b.x0 + b.x1) / 2, FOOT + (b.y0 + b.y1) / 2, c.trayZ)
      : new THREE.Vector3(c.boardX0 + 12, FOOT + c.boardTopY - 15, c.trayZ);
    const parts = partsFrame(layout);
    frame = {
      center, inside, parts,
      radius: 0.5 * Math.hypot(c.D, c.H, c.W),
      insideRadius: b ? Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.48 : 12,
      min: new THREE.Vector3(-c.D / 2, 0, -c.W / 2),
      max: new THREE.Vector3(c.D / 2, FOOT + c.H, c.W / 2),
    };
    controls.maxDistance = frame.radius * 7;
  }

  const fit = (r) => fitDistance(camera, r);

  function goTo(id, { animate = !reducedMotion, dur = 0.75 } = {}) {
    const preset = CAMERA_PRESETS.find((p) => p.id === id) ?? CAMERA_PRESETS[0];
    if (!frame) return;
    current = preset.id;
    onPresetChange?.(current);
    restSway();
    const parts = preset.parts && frame.parts;
    const target = (preset.inside ? frame.inside : parts ? parts.center : frame.center).clone();
    const dist = preset.inside ? fit(frame.insideRadius) : parts ? fit(parts.radius) : fit(frame.radius) * 0.94;
    const pos = new THREE.Vector3(...preset.dir).normalize().multiplyScalar(dist).add(target);
    if (!animate) {
      tween = null;
      camera.position.copy(pos);
      controls.target.copy(target);
      controls.update();
      return;
    }
    tween = { t: 0, dur, p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target };
    controls.enabled = false;
  }

  /**
   * Ease to look at a region (build-by-hand: the area being worked on). Leaves preset mode.
   * @param {THREE.Vector3} center  @param {number} radius  @param {number[]} dir view direction
   */
  function focus(center, radius, dir = [0.35, 0.3, 1], { animate = !reducedMotion, dur = 0.8 } = {}) {
    if (current) {
      current = null;
      onPresetChange?.(null);
    }
    restSway();
    const target = center.clone();
    if (frame) target.clamp(frame.min, frame.max);
    const pos = new THREE.Vector3(...dir).normalize().multiplyScalar(Math.max(fit(Math.max(radius, 9)) * 0.9, controls.minDistance)).add(target);
    pos.y = Math.max(pos.y, 4);
    if (!animate) {
      tween = null;
      camera.position.copy(pos);
      controls.target.copy(target);
      controls.update();
      return;
    }
    tween = { t: 0, dur, p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target };
    controls.enabled = false;
  }

  function update(dt) {
    if (tween) {
      tween.t = Math.min(1, tween.t + dt / tween.dur);
      const k = ease(tween.t);
      camera.position.lerpVectors(tween.p0, tween.p1, k);
      controls.target.lerpVectors(tween.t0, tween.t1, k);
      if (tween.t >= 1) {
        tween = null;
        controls.enabled = !locked;
      }
    }
    if (frame) controls.target.clamp(frame.min, frame.max);
    updateSway(dt);
  }

  function updateSway(dt) {
    if (!sway.on || tween || locked || sway.held || !frame) { restSway(); return; }
    sway.idle += dt;
    if (sway.idle < SWAY.idle) return;
    const ramp = Math.min(1, (sway.idle - SWAY.idle) / SWAY.ramp);
    sway.phase += dt * ramp * ramp * (2 * Math.PI / SWAY.period);
    const want = SWAY.amp * Math.sin(sway.phase);
    const off = camera.position.clone().sub(controls.target).applyAxisAngle(UP, want - sway.applied);
    camera.position.copy(controls.target).add(off);
    sway.applied = want;
  }

  return {
    setFrame,
    goTo,
    focus,
    update,
    /** Re-frame the current preset (e.g. after the case changes size). */
    refresh: (opts) => { if (current) goTo(current, opts); },
    get preset() { return current; },
    /** Lock out orbiting by hand (eased moves still run). */
    lock(on) {
      locked = !!on;
      controls.enabled = !locked && !tween;
    },
    /** Turn the camera `angle` radians around the vertical axis through the target. */
    orbit(angle) {
      if (!angle) return;
      const off = camera.position.clone().sub(controls.target).applyAxisAngle(UP, angle);
      camera.position.copy(controls.target).add(off);
      if (current) {
        current = null;
        onPresetChange?.(null);
      }
    },
    /** Idle sway in the viewer (never with reduced motion). Turning it off leaves the camera where it is. */
    setAutoOrbit(on) {
      const v = !!on && !reducedMotion;
      if (v !== sway.on) restSway();
      sway.on = v;
    },
    get autoOrbit() { return sway.on; },
    /** True while easing to a preset or a focus point. */
    get moving() { return !!tween; },
    next() {
      const i = CAMERA_PRESETS.findIndex((p) => p.id === current);
      goTo(CAMERA_PRESETS[(i + 1) % CAMERA_PRESETS.length].id);
      return current;
    },
  };
}
