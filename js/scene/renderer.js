// Shared viewer: renderer, image-based lighting, bloom, resize, render loop, quality levels.
// Units: 1 unit = 1 cm. Physically based lights, so point light intensity is in candela.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CONFIG } from '../config.js';

/** three.js r163+ needs WebGL 2. Safe to call before three.js is loaded. */
export function isWebGL2Available() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2'));
  } catch {
    return false;
  }
}

// three.js ACES fit (RRT + ODT) for a neutral grey at exposure 1.
function acesGrey(x) {
  const v = x / 0.6;
  return (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
}

/**
 * Linear colour that comes out as `hex` after ACES tone mapping. Used so the
 * tone-mapped background and fog match the page's CSS --bg exactly.
 */
export function compensateToneMapping(hex) {
  const target = new THREE.Color(hex);
  const out = new THREE.Color();
  for (const k of ['r', 'g', 'b']) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (acesGrey(mid) < target[k]) lo = mid; else hi = mid;
    }
    out[k] = (lo + hi) / 2;
  }
  return out;
}

/** 'high' | 'low'. `?quality=low` in the URL forces a level for testing. */
export function detectQuality() {
  const forced = new URLSearchParams(location.search).get('quality');
  if (forced === 'low' || forced === 'high') return forced;
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 8;
  const smallTouch = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 500;
  if ((cores <= 4 && memory <= 4) || smallTouch) return 'low';
  return 'high';
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{quality?: 'high'|'low', fov?: number, onQualityChange?: Function}} opts
 */
export function createViewer(canvas, opts = {}) {
  let quality = opts.quality || detectQuality();

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  // Clear colour is tone-mapped only through the composer (high quality), so the
  // background needs compensation there; fog is always tone-mapped.
  const bgRaw = new THREE.Color(CONFIG.scene.background);
  const bgToned = compensateToneMapping(CONFIG.scene.background);
  scene.background = bgToned.clone();

  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envRT = pmrem.fromScene(room, 0.04);
  room.dispose();
  pmrem.dispose();
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.75;

  const camera = new THREE.PerspectiveCamera(opts.fov ?? 30, 1, 1, 2000);

  // Bloom pipeline. MSAA render target keeps edges clean through post-processing.
  const composerTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, composerTarget);
  composer.addPass(new RenderPass(scene, camera));
  // High threshold: only emissive LEDs (intensity > 1) bloom, not lit surfaces.
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.7, 0.45, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let width = 1;
  let height = 1;

  function applyQuality() {
    const high = quality === 'high';
    const dpr = Math.min(window.devicePixelRatio || 1, high ? CONFIG.scene.maxPixelRatio : 1);
    renderer.setPixelRatio(dpr);
    composer.setPixelRatio(dpr);
    scene.background.copy(high ? bgToned : bgRaw);
    if (renderer.shadowMap.enabled !== high) {
      renderer.shadowMap.enabled = high;
      // Materials must recompile when shadows toggle.
      scene.traverse((o) => {
        if (!o.material) return;
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; });
      });
    }
    resize(width, height);
  }

  function resize(w, h) {
    width = Math.max(1, Math.floor(w));
    height = Math.max(1, Math.floor(h));
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    opts.onResize?.(width, height);
  }

  const ro = new ResizeObserver(([entry]) => {
    const box = entry.contentRect;
    resize(box.width, box.height);
    if (!running) render();
  });
  ro.observe(canvas);

  function render() {
    if (quality === 'high') composer.render();
    else renderer.render(scene, camera);
  }

  // ---- Render loop with a frame-rate monitor that can drop quality once ----
  let running = false;
  let rafId = 0;
  let last = 0;
  let onFrame = null;
  const fps = { value: 0, frames: 0, acc: 0, checked: false, warmup: 1 }; // warmup in seconds

  function tick(now) {
    rafId = requestAnimationFrame(tick);
    const dt = Math.min((now - (last || now)) / 1000, 0.1);
    last = now;
    onFrame?.(dt, now / 1000);
    render();
    trackFps(dt);
  }

  function trackFps(dt) {
    if (dt <= 0) return;
    if (fps.warmup > 0) { fps.warmup -= dt; return; }
    fps.frames++;
    fps.acc += dt;
    if (fps.acc >= 1) {
      fps.value = fps.frames / fps.acc;
      fps.frames = 0;
      fps.acc = 0;
      if (!fps.checked && quality === 'high' && !opts.quality) {
        fps.checked = true;
        if (fps.value < CONFIG.scene.lowFpsThreshold) setQuality('low');
      }
    }
  }

  function start(frameFn) {
    if (frameFn) onFrame = frameFn;
    if (running) return;
    running = true;
    last = 0;
    rafId = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(rafId);
  }

  function setQuality(q) {
    if (q === quality) return;
    quality = q;
    applyQuality();
    opts.onQualityChange?.(quality);
  }

  function dispose() {
    stop();
    ro.disconnect();
    scene.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
    envRT.dispose();
    composer.dispose();
    composerTarget.dispose();
    renderer.dispose();
  }

  const rect = canvas.getBoundingClientRect();
  width = rect.width || 1;
  height = rect.height || 1;
  applyQuality();

  return {
    renderer, scene, camera, bloom,
    get quality() { return quality; },
    get fps() { return fps.value; },
    get running() { return running; },
    render, start, stop, setQuality, dispose,
    /** Compile shaders up front so the first frames don't stutter. */
    compile: () => {
      if (renderer.extensions.has('KHR_parallel_shader_compile')) return renderer.compileAsync(scene, camera);
      renderer.compile(scene, camera);
      return Promise.resolve();
    },
    /** Fog colour that matches the page background after tone mapping. */
    fogColor: bgToned.clone(),
    maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
  };
}
