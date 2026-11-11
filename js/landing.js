// Landing page: loading screen, WebGL check, lazy-loads the 3D hero; preset cards load
// when their section comes near the screen.
import { CONFIG } from './config.js';

const loader = document.getElementById('loader');
const loaderStep = document.getElementById('loader-step');
const loaderFill = document.getElementById('loader-fill');
const stage = document.getElementById('hero-stage');
const canvas = document.getElementById('hero-canvas');
const readout = document.getElementById('hero-readout');

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function progress(step, frac) {
  loaderStep.textContent = step;
  loaderFill.style.width = `${Math.round(frac * 100)}%`;
}

function hideLoader() {
  loader.dataset.done = 'true';
  loader.setAttribute('aria-busy', 'false');
}

function showFallback(reason) {
  stage.dataset.mode = 'fallback';
  document.getElementById('hero-fallback-reason').textContent = reason;
  hideLoader();
}

// Never trap the page behind the loader, whatever happens.
const safety = setTimeout(hideLoader, 8000);

async function init() {
  // Probe WebGL 2 without loading three.js (renderer.js imports it).
  // `?webgl=0` forces the static fallback for testing.
  const forcedOff = new URLSearchParams(location.search).get('webgl') === '0';
  const probe = document.createElement('canvas');
  if (forcedOff || !probe.getContext('webgl2')) {
    showFallback('Your browser has WebGL 2 turned off or unsupported, so this is a static drawing.');
    return;
  }

  try {
    progress('Loading 3D engine', 0.1);
    const { startHero } = await import('./scene/hero.js');
    const hero = await startHero(canvas, {
      reducedMotion,
      onProgress: progress,
      onQualityChange: updateReadout,
    });
    stage.dataset.mode = 'live';
    hideLoader();
    clearTimeout(safety);

    function updateReadout() {
      const q = hero.viewer.quality === 'low' ? 'LQ' : 'HQ';
      const fps = hero.viewer.fps ? `${Math.round(hero.viewer.fps)} FPS` : '-- FPS';
      readout.textContent = reducedMotion ? `${q} · STATIC` : `${q} · ${fps}`;
    }
    updateReadout();
    if (!reducedMotion) setInterval(updateReadout, 1000);

    // Pause rendering when the hero is off screen or the tab is hidden.
    let visible = true;
    const sync = () => hero.setActive(visible && !document.hidden);
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; sync(); }).observe(stage);
    document.addEventListener('visibilitychange', sync);
  } catch (err) {
    console.warn(`${CONFIG.appName}: 3D preview failed, showing static drawing.`, err);
    showFallback('The 3D preview could not start on this device, so this is a static drawing.');
  }
}

init();

// ---------------------------------------------------------------- presets
const presetEl = document.getElementById('preset-cards');
const presetIO = new IntersectionObserver(async ([e]) => {
  if (!e.isIntersecting) return;
  presetIO.disconnect();
  try {
    const [{ loadCatalog }, { loadPresets }, cards, { html }] = await Promise.all([
      import('./catalog.js'), import('./presets.js'), import('./ui/preset-cards.js'), import('./ui/dom.js'),
    ]);
    const [catalog, presets] = await Promise.all([loadCatalog(), loadPresets()]);
    cards.renderPresetCards(presetEl, {
      presets,
      catalog,
      actions: (s) => html`
        <a class="btn btn--sm btn--primary" href="builder.html?preset=${s.preset.id}">Open in builder</a>
        <a class="btn btn--sm" href="builder.html?preset=${s.preset.id}&play=1">Watch it build</a>
        <a class="linkbtn preset__compare" href="${cards.presetCompareUrl(s)}">Compare</a>`,
    });
  } catch (err) {
    console.warn(`${CONFIG.appName}: presets failed to load.`, err);
    presetEl.innerHTML = '<p class="muted">The preset builds could not be loaded. Open the builder and use Presets there.</p>';
  }
}, { rootMargin: '400px' });
presetIO.observe(presetEl);
