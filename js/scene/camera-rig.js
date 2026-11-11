// Camera presets framed from the real case size, eased transitions, orbit limits and a pan
// clamp that keeps the target inside the case.
import * as THREE from 'three';
import { FOOT } from './layout.js';

export const CAMERA_PRESETS = Object.freeze([
  { id: 'angle', label: '3/4', dir: [0.62, 0.32, 0.72] },
  { id: 'front', label: 'Front', dir: [1, 0.1, 0.03] },
  { id: 'side', label: 'Side', dir: [0.03, 0.1, 1] },
  { id: 'top', label: 'Top', dir: [0.12, 1, 0.16] },
  { id: 'inside', label: 'Inside', dir: [0.24, 0.14, 1], inside: true },
]);

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

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

  controls.addEventListener('start', () => {
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
    frame = {
      center, inside,
      radius: 0.5 * Math.hypot(c.D, c.H, c.W),
      insideRadius: b ? Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.48 : 12,
      min: new THREE.Vector3(-c.D / 2, 0, -c.W / 2),
      max: new THREE.Vector3(c.D / 2, FOOT + c.H, c.W / 2),
    };
    controls.maxDistance = frame.radius * 7;
  }

  // Distance at which a sphere of `r` fills the narrower field of view.
  function fitDistance(r) {
    const v = THREE.MathUtils.degToRad(camera.fov);
    const h = 2 * Math.atan(Math.tan(v / 2) * camera.aspect);
    return r / Math.sin(Math.min(v, h) / 2);
  }

  function goTo(id, { animate = !reducedMotion } = {}) {
    const preset = CAMERA_PRESETS.find((p) => p.id === id) ?? CAMERA_PRESETS[0];
    if (!frame) return;
    current = preset.id;
    onPresetChange?.(current);
    const target = (preset.inside ? frame.inside : frame.center).clone();
    const dist = preset.inside ? fitDistance(frame.insideRadius) : fitDistance(frame.radius) * 0.94;
    const pos = new THREE.Vector3(...preset.dir).normalize().multiplyScalar(dist).add(target);
    if (!animate) {
      tween = null;
      camera.position.copy(pos);
      controls.target.copy(target);
      controls.update();
      return;
    }
    tween = { t: 0, dur: 0.75, p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target };
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
        controls.enabled = true;
      }
    }
    if (frame) controls.target.clamp(frame.min, frame.max);
  }

  return {
    setFrame,
    goTo,
    update,
    /** Re-frame the current preset (e.g. after the case changes size). */
    refresh: (opts) => { if (current) goTo(current, opts); },
    get preset() { return current; },
    next() {
      const i = CAMERA_PRESETS.findIndex((p) => p.id === current);
      goTo(CAMERA_PRESETS[(i + 1) % CAMERA_PRESETS.length].id);
      return current;
    },
  };
}
