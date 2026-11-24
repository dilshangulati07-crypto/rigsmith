// Shared viewer: renderer, image-based lighting (environment.js), post-processing (post.js),
// resize, render loop, quality levels, optional orbit controls and pause-when-hidden.
// Quality: 'low' renders straight to the canvas with no shadows; 'high' adds shadows, studio
// lighting, cheap ambient occlusion, bloom, SMAA and the first detail layer; 'ultra' adds full
// ambient occlusion and the finest detail layer (chosen by hand, never automatically).
// Exposure is CONFIG.scene.exposure; the background is compensated so it still matches --bg.
// Units: 1 unit = 1 cm. Physically based lights, so point light intensity is in candela.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CONFIG } from '../config.js?v=4fbe99bdc0';
import { createEnvironment } from './environment.js?v=4fbe99bdc0';
import { createPost } from './post.js?v=4fbe99bdc0';
import { DETAIL_HIGH, DETAIL_ULTRA } from './resources.js?v=4fbe99bdc0';

export const QUALITIES = Object.freeze(['low', 'high', 'ultra']);
export const QUALITY_LABEL = Object.freeze({ low: 'Low', high: 'High', ultra: 'Ultra' });

/** three.js r163+ needs WebGL 2. Safe to call before three.js is loaded. */
export function isWebGL2Available() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2'));
  } catch {
    return false;
  }
}

// three.js ACES fit (RRT + ODT) for a neutral grey at the given exposure.
function acesGrey(x, exposure = 1) {
  const v = (x * exposure) / 0.6;
  return (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
}

/**
 * Linear colour that comes out as `hex` after ACES tone mapping at `exposure`. Used so the
 * tone-mapped background and fog match the page's CSS --bg exactly.
 */
export function compensateToneMapping(hex, exposure = CONFIG.scene.exposure) {
  const target = new THREE.Color(hex);
  const out = new THREE.Color();
  for (const k of ['r', 'g', 'b']) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (acesGrey(mid, exposure) < target[k]) lo = mid; else hi = mid;
    }
    out[k] = (lo + hi) / 2;
  }
  return out;
}

/** 'high' | 'low' for this device. `?quality=low|high|ultra` in the URL forces a level for testing. */
export function detectQuality() {
  const forced = new URLSearchParams(location.search).get('quality');
  if (QUALITIES.includes(forced)) return forced;
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 8;
  const smallTouch = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 500;
  if ((cores <= 4 && memory <= 4) || smallTouch) return 'low';
  return 'high';
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{
 *   quality?: 'low'|'high'|'ultra', fov?: number, vignette?: number, onQualityChange?: Function, onResize?: Function,
 *   controls?: boolean,      // OrbitControls with damping (limits are set by the caller)
 *   autoPause?: boolean,     // stop the loop while the canvas is off screen or the tab is hidden
 *   staticShadows?: boolean, // render the shadow map only after invalidateShadows()
 * }} opts
 */
export function createViewer(canvas, opts = {}) {
  let quality = opts.quality || detectQuality();
  let qualityAuto = false; // true once the frame-rate monitor has dropped quality

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = CONFIG.scene.exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if (opts.staticShadows) renderer.shadowMap.autoUpdate = false;

  const scene = new THREE.Scene();
  // Clear colour is tone-mapped only through the composer (High and Ultra), so the
  // background needs compensation there; fog is always tone-mapped.
  const bgRaw = new THREE.Color(CONFIG.scene.background);
  let bgToned = compensateToneMapping(CONFIG.scene.background);
  scene.background = bgToned.clone();

  // When the studio lighting arrives while the loop is stopped, draw one frame with it.
  let ready = false;
  const env = createEnvironment(renderer, scene, { onChange: () => { if (ready && !running) render(); } });

  const camera = new THREE.PerspectiveCamera(opts.fov ?? 30, 1, 1, 2000);
  camera.layers.enable(1); // layer 1: drawn but never ray-cast (glass, floor, guides)

  let controls = null;
  if (opts.controls) {
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
  }

  const post = createPost(renderer, scene, camera, { vignette: opts.vignette ?? 0 });
  const { bloom } = post;

  let width = 1;
  let height = 1;

  function applyQuality() {
    const high = quality !== 'low';
    const dpr = Math.min(window.devicePixelRatio || 1, high ? CONFIG.scene.maxPixelRatio : 1);
    renderer.setPixelRatio(dpr);
    post.setPixelRatio(dpr);
    post.setQuality(quality);
    env.setLevel(quality);
    // Detail layers: fine geometry that only the higher levels draw (see resources.js detail()).
    camera.layers.disable(DETAIL_HIGH);
    camera.layers.disable(DETAIL_ULTRA);
    if (high) camera.layers.enable(DETAIL_HIGH);
    if (quality === 'ultra') camera.layers.enable(DETAIL_ULTRA);
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
    post.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    opts.onResize?.(width, height);
  }

  const ro = new ResizeObserver(([entry]) => {
    const box = entry.contentRect;
    if (!box.width || !box.height) return; // hidden (display: none)
    resize(box.width, box.height);
    if (!running) render();
  });
  ro.observe(canvas);

  // Listeners run before a frame whose shadows changed (contact shadows re-render there).
  const shadowListeners = new Set();
  let shadowsDirty = true;
  function render() {
    if (shadowsDirty || renderer.shadowMap.autoUpdate) {
      shadowsDirty = false;
      for (const fn of shadowListeners) fn();
    }
    if (quality !== 'low') post.render();
    else renderer.render(scene, camera);
  }

  // ---- Render loop with a frame-rate monitor that can drop quality once ----
  let running = false;
  let rafId = 0;
  let last = 0;
  let onFrame = null;
  let afterRender = null; // runs right after each frame is drawn, while the canvas still holds it
  const fps = { value: 0, frames: 0, acc: 0, checked: false, warmup: 2.5 }; // warmup in seconds (skips shader compiles)

  function tick(now) {
    rafId = requestAnimationFrame(tick);
    const dt = Math.min((now - (last || now)) / 1000, 0.1);
    last = now;
    onFrame?.(dt, now / 1000);
    controls?.update();
    render();
    afterRender?.();
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
        if (fps.value < CONFIG.scene.lowFpsThreshold) {
          qualityAuto = true;
          setQuality('low');
        }
      }
    }
  }

  // `wanted`: the caller asked for the loop. `visible`: auto-pause says it may run.
  let wanted = false;
  let visible = true;

  function run() {
    if (running || !wanted || !visible) return;
    running = true;
    last = 0;
    fps.frames = 0;
    fps.acc = 0;
    fps.warmup = Math.max(fps.warmup, 0.5);
    rafId = requestAnimationFrame(tick);
  }

  function halt() {
    running = false;
    cancelAnimationFrame(rafId);
  }

  function start(frameFn) {
    if (frameFn) onFrame = frameFn;
    wanted = true;
    run();
  }

  function stop() {
    wanted = false;
    halt();
  }

  let io = null;
  let onScreen = true;
  const onVisibility = () => setVisible(!document.hidden && onScreen);
  function setVisible(v) {
    visible = v;
    if (v) run(); else halt();
  }
  if (opts.autoPause) {
    io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; onVisibility(); });
    io.observe(canvas);
    document.addEventListener('visibilitychange', onVisibility);
  }

  /** @param {'low'|'high'|'ultra'} q  @param {{manual?: boolean}} o  manual = the user chose it; stops auto changes */
  function setQuality(q, { manual = false } = {}) {
    if (manual) {
      fps.checked = true;
      qualityAuto = false;
    }
    if (q === quality) return;
    quality = q;
    applyQuality();
    invalidateShadows();
    opts.onQualityChange?.(quality);
  }

  function invalidateShadows() {
    renderer.shadowMap.needsUpdate = true;
    shadowsDirty = true;
  }

  /** Background colour as it should appear on screen (CSS hex number). */
  function setBackground(hex) {
    bgRaw.set(hex);
    bgToned = compensateToneMapping(hex);
    scene.background.copy(quality !== 'low' ? bgToned : bgRaw);
  }

  /**
   * Render one still at `scale` times the canvas's CSS size and return it as a PNG blob.
   * The size is capped by what the GPU can allocate; the real pixel size comes back too.
   */
  async function captureScaled(scale) {
    // The ResizeObserver can lag a layout change (photo mode just opened): measure now.
    const box = canvas.getBoundingClientRect();
    if (box.width && box.height && (Math.floor(box.width) !== width || Math.floor(box.height) !== height)) resize(box.width, box.height);
    const gl = renderer.getContext();
    const maxSide = Math.min(8192, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    const maxPixels = 16e6;
    const ratio = Math.min(scale, maxSide / width, maxSide / height, Math.sqrt(maxPixels / (width * height)));
    const before = renderer.getPixelRatio();
    const big = width * height * ratio * ratio > 6e6;
    try {
      if (big) post.setSamples(0);
      renderer.setPixelRatio(ratio);
      post.setPixelRatio(ratio);
      resize(width, height);
      invalidateShadows();
      render();
      const size = { width: canvas.width, height: canvas.height };
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      return { blob, ...size };
    } finally {
      if (big) post.setSamples(4);
      renderer.setPixelRatio(before);
      post.setPixelRatio(before);
      resize(width, height);
      render();
    }
  }

  function dispose() {
    stop();
    ro.disconnect();
    io?.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    controls?.dispose();
    scene.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
    env.dispose();
    post.dispose();
    renderer.dispose();
  }

  const rect = canvas.getBoundingClientRect();
  width = rect.width || 1;
  height = rect.height || 1;
  applyQuality();
  ready = true;

  return {
    renderer, scene, camera, bloom, controls,
    get quality() { return quality; },
    get qualityAuto() { return qualityAuto; },
    get fps() { return fps.value; },
    get running() { return running; },
    render, start, stop, setQuality, dispose, post, setBackground, captureScaled,
    /** Resolves when the studio lighting for the current quality is loaded (or fell back). */
    get envReady() { return env.ready; },
    /** Call `fn` before any frame whose shadows changed. Returns a function that removes it. */
    onShadowUpdate(fn) { shadowListeners.add(fn); return () => shadowListeners.delete(fn); },
    /** Call `fn` after every frame of the loop (copying the canvas for a video, a crossfade); null removes it. */
    setAfterRender: (fn) => { afterRender = fn; },
    /** With staticShadows: re-render the shadow map on the next frame. */
    invalidateShadows,
    /** Render one frame and return it as a PNG blob (must stay in the same task as render). */
    capture: () => {
      render();
      return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    },
    /** Compile shaders up front so the first frames don't stutter. */
    compile: () => {
      if (renderer.extensions.has('KHR_parallel_shader_compile')) return renderer.compileAsync(scene, camera);
      renderer.compile(scene, camera);
      return Promise.resolve();
    },
    /** Fog colour that matches the page background after tone mapping. */
    get fogColor() { return bgToned.clone(); },
    /** The normal tone-mapping exposure (fades scale this). */
    exposure: CONFIG.scene.exposure,
    maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
  };
}
