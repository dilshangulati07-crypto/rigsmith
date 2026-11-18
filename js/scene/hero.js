// Landing-page hero: a real preset build (CONFIG.scene.heroPreset in data/presets.json) drawn
// by the same model factory, stage and lighting as the builder, in the showcase colour theme
// (CONFIG.scene.heroTheme), powered on with its lighting lit. The camera frames the machine
// close, turns slowly around it and tilts a little towards the pointer.
import * as THREE from 'three';
import { CONFIG } from '../config.js?v=00a22f4faf';
import { loadCatalog } from '../catalog.js?v=00a22f4faf';
import { loadPresets, presetBuild, findPreset } from '../presets.js?v=00a22f4faf';
import { createViewer } from './renderer.js?v=00a22f4faf';
import { createStage } from './stage.js?v=00a22f4faf';
import { createBuildScene } from './build-scene.js?v=00a22f4faf';
import { createEffects } from './effects.js?v=00a22f4faf';
import { setMaterialQuality } from './materials.js?v=00a22f4faf';
import { partsFrame, fitDistance } from './camera-rig.js?v=00a22f4faf';
import { FOOT } from './layout.js?v=00a22f4faf';

// Camera direction: front-left of the case, looking through the glass side.
const VIEW_DIR = new THREE.Vector3(0.6, 0.3, 0.74).normalize();
const SWAY = { amp: 0.55, period: 40 }; // rad, s
const TILT = { x: 0.16, y: 0.1, ease: 2.5 }; // rad at the edge of the window, 1/s
const UP = new THREE.Vector3(0, 1, 0);

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{reducedMotion: boolean, onProgress?: (step: string, frac: number) => void, onQualityChange?: Function}} opts
 * @returns {Promise<{viewer: object, preset: object, setActive: (on: boolean) => void}>}
 */
export async function startHero(canvas, { reducedMotion, onProgress, onQualityChange }) {
  onProgress?.('Starting renderer', 0.2);
  let pointer = { x: 0, y: 0 };
  const tilt = { x: 0, y: 0 };
  let framing = null; // { center, radius }
  let t = 0;

  const viewer = createViewer(canvas, {
    fov: 30,
    staticShadows: true,
    onQualityChange: (q) => { applyQuality(); onQualityChange?.(q); },
    onResize: () => frameCamera(),
  });
  const { camera } = viewer;
  const stage = createStage(viewer.scene, { shadowMapSize: 2048, viewer });
  function applyQuality() {
    setMaterialQuality(viewer.quality);
    stage.setQuality(viewer.quality);
  }
  applyQuality();

  onProgress?.('Loading parts', 0.35);
  const [catalog, presets] = await Promise.all([loadCatalog(), loadPresets()]);
  const preset = findPreset(presets, CONFIG.scene.heroPreset) ?? presets[0];

  onProgress?.('Building the models', 0.5);
  const bscene = createBuildScene({
    viewer,
    anisotropy: Math.min(8, viewer.maxAnisotropy),
    reducedMotion,
    theme: CONFIG.scene.heroTheme ?? 'auto',
    onChange: (layout) => {
      const c = layout.case;
      stage.fit(new THREE.Vector3(0, FOOT + c.H / 2, 0), 0.5 * Math.hypot(c.D, c.H, c.W));
      // The whole machine, a little tight, leaning towards the parts.
      const whole = { center: new THREE.Vector3(0, FOOT + c.H / 2, 0), radius: 0.5 * Math.hypot(c.D, c.H, c.W) };
      const parts = partsFrame(layout) ?? whole;
      framing = { center: whole.center.clone().lerp(parts.center, 0.3), radius: whole.radius * 0.9 };
      frameCamera();
      viewer.invalidateShadows();
    },
  });
  bscene.sync(presetBuild(preset, catalog));
  while (bscene.busy) await new Promise((r) => setTimeout(r, 16));
  const fx = createEffects({ viewer, scene: bscene, reducedMotion });
  fx.refresh();
  await viewer.envReady;

  function frameCamera() {
    if (!framing) return;
    const dist = fitDistance(camera, framing.radius);
    const dir = VIEW_DIR.clone().applyAxisAngle(UP, reducedMotion ? 0 : SWAY.amp * Math.sin((t * 2 * Math.PI) / SWAY.period) + tilt.x);
    dir.y += tilt.y;
    camera.position.copy(framing.center).addScaledVector(dir.normalize(), dist);
    camera.lookAt(framing.center);
  }

  onProgress?.('Compiling shaders', 0.8);
  try { await viewer.compile(); } catch { /* compile is only a warm-up */ }

  // Powered on: with motion, the fans spin up and the lighting fades in like a real boot.
  fx.setPower(true, { instant: reducedMotion });

  function frame(dt) {
    t += dt;
    const k = Math.min(1, dt * TILT.ease);
    tilt.x += (pointer.x * TILT.x - tilt.x) * k;
    tilt.y += (pointer.y * TILT.y - tilt.y) * k;
    bscene.update(dt);
    fx.update(dt);
    frameCamera();
  }

  if (reducedMotion) {
    // A still picture; the viewer redraws it on resize.
    fx.update(0);
    frameCamera();
    viewer.render();
  } else {
    viewer.start(frame);
    // The whole window steers the tilt, not only the canvas.
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      pointer = { x: e.clientX / innerWidth - 0.5, y: 0.5 - e.clientY / innerHeight };
    }, { passive: true });
    document.addEventListener('pointerleave', () => { pointer = { x: 0, y: 0 }; });
  }

  onProgress?.('Ready', 1);

  return {
    viewer,
    preset,
    /** Pause/resume the loop, e.g. when the hero scrolls out of view. */
    setActive(active) {
      if (reducedMotion) return;
      if (active) viewer.start();
      else viewer.stop();
    },
  };
}
