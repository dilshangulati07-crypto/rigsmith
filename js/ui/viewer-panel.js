// 3D view panel: starts the viewer, keeps it in sync with the build, and runs the tools
// (side panel, camera presets, quality, screenshot), FPS readout, empty state and hover.
// Loaded on demand the first time the panel is on screen, so the parts list never waits for three.js.
import * as THREE from 'three';
import { createViewer, isWebGL2Available } from '../scene/renderer.js';
import { createStage } from '../scene/stage.js';
import { createBuildScene } from '../scene/build-scene.js';
import { createCameraRig, CAMERA_PRESETS } from '../scene/camera-rig.js';
import { FOOT } from '../scene/layout.js';
import { getCategory } from '../categories.js';
import { CONFIG } from '../config.js';
import { html, render } from './dom.js';

const DRAWN = 'Drawn in 3D: case, motherboard, PSU, storage and case fans. CPU, cooler, memory and graphics card are not drawn yet.';

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'build';

export async function mountViewerPanel(el, app) {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.innerHTML = '';
  render(el, html`
    <div class="viewer__stage">
      <canvas class="viewer__canvas" role="img" aria-label="3D view of the build. The list under “Your build” describes the same parts in text."></canvas>
      <div class="viewer__frame brackets" aria-hidden="true"></div>
      <div class="viewer__hud">
        <p class="viewer__title"><span class="label">3D view</span> <span class="viewer__case mono" data-ref="case"></span></p>
        <p class="viewer__fps mono" data-ref="fps" title="Frame rate and render quality">-- FPS</p>
      </div>
      <div class="viewer__msg" data-ref="msg" hidden></div>
      <div class="viewer__loading" data-ref="loading" role="status" aria-live="polite">
        <p class="label">Loading 3D view</p>
        <div class="loader__bar"><div class="loader__fill" data-ref="bar" style="width:15%"></div></div>
        <p class="viewer__loading-step mono" data-ref="step">Loading the 3D engine</p>
      </div>
      <p class="viewer__hover mono" data-ref="hover" aria-live="polite"></p>
    </div>
    <div class="viewer__tools">
      <button class="vbtn" type="button" data-v="panel" aria-pressed="true" aria-keyshortcuts="G">Side panel</button>
      <div class="vgroup" role="group" aria-label="Camera">
        ${CAMERA_PRESETS.map((p) => html`<button class="vbtn" type="button" data-v="cam" data-cam="${p.id}" aria-pressed="${String(p.id === 'angle')}">${p.label}</button>`)}
      </div>
      <span class="viewer__spacer"></span>
      <button class="vbtn" type="button" data-v="quality">Quality: High</button>
      <button class="vbtn" type="button" data-v="shot" aria-keyshortcuts="P">Screenshot</button>
    </div>
    <div class="viewer__notes">
      <p data-ref="notes"></p>
      <p class="muted">${DRAWN} Positions follow the real case and board sizes; internal layouts are approximate.</p>
    </div>`);

  const ref = (k) => el.querySelector(`[data-ref="${k}"]`);
  const canvas = el.querySelector('canvas');
  const step = (text, frac) => {
    ref('step').textContent = text;
    ref('bar').style.width = `${Math.round(frac * 100)}%`;
  };
  const fail = (text) => {
    ref('loading').hidden = true;
    el.dataset.state = 'error';
    showMessage(html`<p class="label">3D view unavailable</p><p>${text} The list under “Your build” describes the same parts.</p>`);
    for (const b of el.querySelectorAll('.vbtn')) b.disabled = true;
  };
  function showMessage(content) {
    const m = ref('msg');
    if (!content) { m.hidden = true; return; }
    render(m, html`<div class="viewer__msg-card">${content}</div>`);
    m.hidden = false;
  }

  if (!isWebGL2Available()) {
    fail('This browser or device does not support WebGL 2.');
    return null;
  }

  // ---- viewer, stage, scene
  step('Starting the renderer', 0.35);
  let ready = false;
  let lastCaseSig = '';
  let lastTarget = null;
  let bscene = null;
  let rig = null;
  let viewer;
  try {
    viewer = createViewer(canvas, {
      fov: 30,
      controls: true,
      autoPause: true,
      staticShadows: true,
      onQualityChange: () => updateQualityUi(),
      onResize: () => { if (ready && rig.preset) rig.refresh({ animate: false }); },
    });
  } catch (err) {
    console.warn('Rigsmith: 3D view failed to start.', err);
    fail('The 3D renderer could not start on this device.');
    return null;
  }
  const stage = createStage(viewer.scene, { shadowMapSize: 2048 });
  rig = createCameraRig(viewer, { reducedMotion, onPresetChange: markPreset });

  bscene = createBuildScene({
    viewer,
    anisotropy: Math.min(8, viewer.maxAnisotropy),
    reducedMotion,
    onChange: (layout) => {
      const c = layout.case;
      stage.fit(new THREE.Vector3(0, FOOT + c.H / 2, 0), 0.5 * Math.hypot(c.D, c.H, c.W));
      rig.setFrame(layout);
      // Re-frame when the case (or its size) changes.
      const sig = `${c.D}|${c.W}|${c.H}|${!!layout.board}`;
      if (sig !== lastCaseSig) {
        const first = !lastCaseSig;
        lastCaseSig = sig;
        if (first) rig.goTo('angle', { animate: false });
        else rig.refresh();
      }
      updateStatus(layout);
    },
  });

  function updateStatus(layout) {
    const build = app.store.build;
    ref('case').textContent = build.case ? build.case.name : 'No case chosen';
    const notes = layout.notes;
    ref('notes').textContent = notes.join(' ');
    ref('notes').hidden = !notes.length;
    if (!build.case) {
      const any = Object.values(build).some((v) => (Array.isArray(v) ? v.length : v));
      showMessage(html`
        <p class="label">No case chosen</p>
        <p>${any ? 'Your parts are placed in a typical mid-tower outline until you pick a case.' : 'Pick a case to start the 3D build. Parts appear in it as you add them.'}</p>
        <button class="btn btn--sm" type="button" data-v="choose-case">Choose a case</button>`);
    } else showMessage(null);
  }

  // ---- tools
  function markPreset(id) {
    for (const b of el.querySelectorAll('[data-v="cam"]')) b.setAttribute('aria-pressed', String(b.dataset.cam === id));
  }
  function updateQualityUi() {
    el.querySelector('[data-v="quality"]').textContent = `Quality: ${viewer.quality === 'high' ? 'High' : 'Low'}`;
  }
  function setPanel(on) {
    bscene.setSidePanel(on);
    el.querySelector('[data-v="panel"]').setAttribute('aria-pressed', String(on));
  }

  async function screenshot() {
    bscene.setHelpersVisible(false);
    const blob = await viewer.capture();
    bscene.setHelpersVisible(true);
    if (!blob) { app.toast('Could not create the screenshot.', 'error'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${slug(CONFIG.appName)}-${slug(app.ui.current?.name ?? 'build')}-${new Date().toISOString().slice(0, 10)}.png`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    app.toast('Screenshot saved as PNG.');
  }

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b || b.disabled) return;
    const v = b.dataset.v;
    if (v === 'panel') setPanel(!bscene.sidePanel);
    if (v === 'cam') rig.goTo(b.dataset.cam);
    if (v === 'quality') viewer.setQuality(viewer.quality === 'high' ? 'low' : 'high', { manual: true });
    if (v === 'shot') screenshot();
    if (v === 'choose-case') app.setCategory('case', { focusBrowser: true });
  });

  // ---- hover and click in 3D
  const ndc = new THREE.Vector2();
  let pointer = null;
  let pickQueued = false;
  let down = null;
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    pointer = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
    if (!pickQueued && e.pointerType === 'mouse') {
      pickQueued = true;
      requestAnimationFrame(() => {
        pickQueued = false;
        if (pointer && !e.buttons) hoverFrom3D(pickAt(pointer));
      });
    }
  });
  canvas.addEventListener('pointerleave', () => { pointer = null; hoverFrom3D(null); });
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || performance.now() - down.t > 500) return;
    const r = canvas.getBoundingClientRect();
    const hit = pickAt({ x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 });
    if (hit) app.openDetail(hit.part);
  });
  function pickAt(p) {
    ndc.set(p.x, p.y);
    return bscene.pick(ndc);
  }
  let hoverKey = '';
  function hoverFrom3D(hit) {
    const key = hit ? `${hit.category}:${hit.id}` : '';
    if (key === hoverKey) return;
    hoverKey = key;
    canvas.style.cursor = hit ? 'pointer' : '';
    showTarget(hit ? { category: hit.category, id: hit.id } : null, hit?.part);
    app.onViewerHover?.(hit ? { category: hit.category, id: hit.id } : null);
  }
  function showTarget(target, part) {
    lastTarget = target;
    const shown = bscene.highlight(target);
    const label = target && shown ? `${getCategory(target.category).short} · ${part?.name ?? getCategory(target.category).label}` : '';
    ref('hover').textContent = label;
  }

  // ---- frame loop and FPS readout
  let fpsClock = 0;
  viewer.start((dt) => {
    rig.update(dt);
    bscene.update(dt);
    fpsClock += dt;
    if (fpsClock >= 0.5) {
      fpsClock = 0;
      const fps = viewer.fps;
      ref('fps').textContent = `${fps ? Math.round(fps) : '--'} FPS · ${viewer.quality === 'high' ? 'High' : 'Low'}${viewer.qualityAuto ? ' (auto)' : ''}`;
    }
  });

  // ---- first build
  step('Building the models', 0.6);
  bscene.sync(app.store.build);
  while (bscene.busy) await new Promise((r) => setTimeout(r, 16));
  step('Compiling shaders', 0.85);
  try { await viewer.compile(); } catch { /* compile is only a warm-up */ }
  ready = true;
  updateQualityUi();
  // ?debug3d exposes the viewer for checking draw calls and GPU memory in the console.
  if (new URLSearchParams(location.search).has('debug3d')) window.rigsmith3d = { viewer, scene: bscene };
  ref('loading').hidden = true;
  el.dataset.state = 'ready';

  return {
    sync: (build) => bscene.sync(build),
    /** Highlight from the parts list: {category, id?} or null. */
    highlight(target) {
      const part = target?.id ? app.catalog.get(target.id) : null;
      showTarget(target, part);
    },
    toggleSidePanel: () => setPanel(!bscene.sidePanel),
    nextCamera: () => rig.next(),
    screenshot,
  };
}
