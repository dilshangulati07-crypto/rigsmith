// 3D view panel: starts the viewer, keeps it in sync with the build, and runs the tools
// (side panel, camera presets, quality, screenshot, photo mode, power, fan profile, lighting,
// exploded view), FPS readout, empty state and hover. "Build by hand" mode lives in hand-panel.js,
// the "Auto-build" cinematic in cinematic-panel.js.
// Loaded on demand the first time the panel is on screen, so the parts list never waits for three.js.
import * as THREE from 'three';
import { createViewer, isWebGL2Available, QUALITIES, QUALITY_LABEL } from '../scene/renderer.js?v=fe48996dc3';
import { setMaterialQuality } from '../scene/materials.js?v=fe48996dc3';
import { createStage } from '../scene/stage.js?v=fe48996dc3';
import { createBuildScene } from '../scene/build-scene.js?v=fe48996dc3';
import { THEMES, loadTheme, saveTheme } from '../scene/look.js?v=fe48996dc3';
import { createCameraRig, CAMERA_PRESETS } from '../scene/camera-rig.js?v=fe48996dc3';
import { createEffects, FAN_PROFILES, RGB_MODES } from '../scene/effects.js?v=fe48996dc3';
import { FOOT } from '../scene/layout.js?v=fe48996dc3';
import { getCategory } from '../categories.js?v=fe48996dc3';
import { CONFIG } from '../config.js?v=fe48996dc3';
import { assemblyProgress } from '../state.js?v=fe48996dc3';
import { html, render } from './dom.js?v=fe48996dc3';
import { mountHandPanel } from './hand-panel.js?v=fe48996dc3';
import { mountCinematicPanel } from './cinematic-panel.js?v=fe48996dc3';
import { mountPhotoPanel } from './photo-panel.js?v=fe48996dc3';

const DRAWN = 'Every part is drawn at the size in the data. Where the data has no size (PSU length, graphics card height, radiator thickness) a typical size is used; hover a part to see which.';

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
        <div class="viewer__readout">
          <p class="viewer__fps mono" data-ref="fps" title="Frame rate and render quality">-- FPS</p>
          <p class="viewer__power mono" data-ref="power" data-power="off" aria-live="polite">Off</p>
        </div>
      </div>
      <div class="viewer__msg" data-ref="msg" hidden></div>
      <div class="viewer__loading" data-ref="loading" role="status" aria-live="polite">
        <p class="label">Loading 3D view</p>
        <div class="loader__bar"><div class="loader__fill" data-ref="bar" style="width:15%"></div></div>
        <p class="viewer__loading-step mono" data-ref="step">Loading the 3D engine</p>
      </div>
      <div class="viewer__hover" data-ref="hover" aria-live="polite" hidden></div>
      <div class="photo" data-ref="photo" hidden></div>
    </div>
    <div class="viewer__tools viewer__tools--mode">
      <div class="vgroup vgroup--mode" role="group" aria-label="3D mode">
        <button class="vbtn" type="button" data-v="mode" data-mode="viewer" aria-pressed="true">Viewer</button>
        <button class="vbtn" type="button" data-v="mode" data-mode="hand" aria-pressed="false" aria-keyshortcuts="K">Build by hand</button>
        <button class="vbtn" type="button" data-v="mode" data-mode="auto" aria-pressed="false">Auto-build</button>
      </div>
      <span class="viewer__spacer"></span>
      <button class="vbtn viewer__opt viewer__adv" type="button" data-v="quality">Quality: High</button>
      <button class="vbtn viewer__opt" type="button" data-v="shot" aria-keyshortcuts="P">Screenshot</button>
      <button class="vbtn viewer__opt" type="button" data-v="photo" aria-keyshortcuts="F">Photo mode</button>
    </div>
    <div class="viewer__tools viewer__tools--view">
      <button class="vbtn" type="button" data-v="panel" aria-pressed="true" aria-keyshortcuts="G">Side panel</button>
      <button class="vbtn" type="button" data-v="theme" title="Draw parts in black or white where the real product is sold in that colour">Colour: As listed</button>
      <div class="vgroup" role="group" aria-label="Camera">
        ${CAMERA_PRESETS.map((p) => html`<button class="vbtn" type="button" data-v="cam" data-cam="${p.id}" aria-pressed="${String(p.id === 'angle')}">${p.label}</button>`)}
      </div>
    </div>
    <div class="viewer__tools viewer__tools--fx">
      <button class="vbtn vbtn--power" type="button" data-v="power" aria-pressed="false" aria-keyshortcuts="O">Power on</button>
      <div class="vgroup viewer__adv" role="group" aria-label="Fan speed">
        ${FAN_PROFILES.map((p) => html`<button class="vbtn" type="button" data-v="profile" data-profile="${p.id}" aria-pressed="false">${p.label}</button>`)}
      </div>
      <button class="vbtn" type="button" data-v="lighting" aria-expanded="false" aria-controls="viewer-lighting">Lighting</button>
      <span class="viewer__spacer"></span>
      <button class="vbtn vbtn--more" type="button" data-v="more" aria-expanded="false" aria-controls="viewer-more">More options</button>
      <label class="viewer__range viewer__adv">
        <span class="label">Explode</span>
        <input type="range" min="0" max="100" step="1" value="0" data-v="explode" aria-keyshortcuts="E">
        <output class="mono" data-ref="explode">0%</output>
      </label>
    </div>
    <div class="viewer__lighting" id="viewer-lighting" hidden>
      <label class="viewer__field"><span class="label">Part</span>
        <select data-v="light-target"></select>
      </label>
      <label class="viewer__field"><span class="label">Colour</span>
        <input type="color" data-v="light-color" value="#d8e4f2">
      </label>
      <div class="vgroup" role="group" aria-label="Lighting mode">
        ${RGB_MODES.map((m) => html`<button class="vbtn" type="button" data-v="light-mode" data-mode="${m.id}" aria-pressed="false">${m.label}</button>`)}
      </div>
      <p class="viewer__lighting-note muted" data-ref="light-note"></p>
    </div>
    <div class="hand" data-ref="hand" hidden></div>
    <div class="auto" data-ref="auto" hidden></div>
    <div class="viewer__notes viewer__adv" id="viewer-more">
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
  let photo = null;
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
      vignette: 0.32,
      onQualityChange: () => { applyQuality(); updateQualityUi(); photo?.refresh(); },
      onResize: () => { if (ready && rig.preset) rig.refresh({ animate: false }); },
    });
  } catch (err) {
    console.warn('Rigsmith: 3D view failed to start.', err);
    fail('The 3D renderer could not start on this device.');
    return null;
  }
  const stage = createStage(viewer.scene, { shadowMapSize: 2048, viewer });
  // Stage extras and glass follow the quality level (High: contact shadow; Ultra: floor reflection, real glass).
  function applyQuality() {
    setMaterialQuality(viewer.quality);
    stage.setQuality(viewer.quality);
  }
  applyQuality();
  rig = createCameraRig(viewer, { reducedMotion, onPresetChange: markPreset });

  bscene = createBuildScene({
    viewer,
    anisotropy: Math.min(8, viewer.maxAnisotropy),
    reducedMotion,
    theme: loadTheme(),
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
      // Re-label (or hide) the tooltip if the hovered part was swapped.
      if (lastTarget) showTarget(lastTarget, lastTarget.id ? app.catalog.get(lastTarget.id) : null, ref('hover').classList.contains('is-docked') === false);
      fx?.refresh();
      updateLighting();
      queuePartThumbs();
      hand?.onLayout();
      auto?.onLayout();
    },
  });

  // ---- small product shots of the chosen parts for the parts list (app.setPartThumb)
  // One shot per idle slot, so the page stays responsive (each shot is a full render).
  let thumbnailer = null;
  let thumbTimer = 0;
  const shot = new Set();
  const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 500 }) : setTimeout(fn, 60));
  function queuePartThumbs() {
    if (!app.setPartThumb) return;
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(async () => {
      const { createThumbnailer } = await import('../scene/thumbnails.js?v=fe48996dc3');
      thumbnailer ??= createThumbnailer(viewer, { width: 160, height: 160, background: '#DEE0E3' });
      const next = () => {
        // Wait while the scene is loading or a part is being dragged in by hand.
        if (bscene.busy || hand?.dragging) { thumbTimer = setTimeout(next, 400); return; }
        const m = bscene.models.find((x) => !shot.has(x.part.id));
        if (!m) { if (!running()) viewer.render(); return; }
        shot.add(m.part.id);
        const copy = m.model.clone(true);
        copy.position.set(0, 0, 0);
        copy.quaternion.identity();
        copy.visible = true;
        const url = thumbnailer.shoot(copy, m.category === 'case' ? [0.7, 0.35, 0.8] : [0.45, 0.4, 1]);
        if (url) app.setPartThumb(m.part.id, url);
        idle(next);
      };
      idle(next);
    }, 120);
  }
  const running = () => viewer.running;

  // ---- power, fans, lighting
  let fx = null;
  function showPower({ power, profile, rpm }) {
    const label = { off: 'Off', booting: 'Booting…', on: 'Running' }[power];
    ref('power').textContent = power === 'off' ? label : `${label}${rpm ? ` · fans ${rpm} rpm` : ''}`;
    ref('power').dataset.power = power;
    const b = el.querySelector('[data-v="power"]');
    b.setAttribute('aria-pressed', String(power !== 'off'));
    b.textContent = power === 'off' ? 'Power on' : 'Power off';
    for (const x of el.querySelectorAll('[data-v="profile"]')) x.setAttribute('aria-pressed', String(x.dataset.profile === profile));
  }
  fx = createEffects({ viewer, scene: bscene, reducedMotion, onStatus: showPower });

  // ---- mode: viewer, build by hand, or the auto-build cinematic (not kept across reloads)
  let hand = null;
  let auto = null;
  const modeNow = () => (auto?.active ? 'auto' : hand?.active ? 'hand' : 'viewer');
  function setMode(mode, { animate = true } = {}) {
    if (!hand || mode === modeNow()) return false;
    if (mode === 'auto' && !bscene.build?.case) {
      app.toast('Choose a case first: Auto-build installs the parts into it.', 'warn');
      return false;
    }
    if (hand.active) hand.leave();
    if (auto?.active) auto.leave();
    el.dataset.mode = mode;
    for (const b of el.querySelectorAll('[data-v="mode"]')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    assemblyProgress.setMode(mode === 'hand' ? 'hand' : 'viewer');
    if (mode === 'hand' || mode === 'auto') {
      setExplode(0);
      toggleLighting(false);
      showTarget(null);
      app.enter3D?.();
    }
    if (mode === 'hand') hand.enter({ animate });
    else if (mode === 'auto') {
      auto ??= mountCinematicPanel(ref('auto'), el.querySelector('.viewer__stage'), {
        app, viewer, bscene, rig, fx, hand, reducedMotion,
        isShown: () => el.getClientRects().length > 0,
        onExit: () => setMode('viewer'),
        onOpenHand: (finalState) => {
          setMode('hand');
          assemblyProgress.fill(finalState);
          app.toast('Opened in Build by hand with every part and cable in. Reset case starts it empty.');
        },
        onEditParts: () => {
          setMode('viewer');
          app.setCategory(app.ui.category, { focusBrowser: true });
        },
        onScreenshot: () => screenshot(),
      });
      const r = auto.enter();
      if (!r.ok) {
        app.toast(r.reason, 'warn');
        setMode('viewer');
        return false;
      }
      requestAnimationFrame(() => el.scrollIntoView({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' }));
    } else {
      setPanel(true);
      rig.goTo('angle');
    }
    return true;
  }
  const building = () => hand?.active === true || auto?.active === true;

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
    el.querySelector('[data-v="quality"]').textContent = `Quality: ${QUALITY_LABEL[viewer.quality]}`;
    el.dataset.quality = viewer.quality;
  }
  // Photo mode works on the finished build, so it leaves Build by hand / Auto-build first.
  function togglePhoto() {
    if (!photo) return;
    if (!photo.active && modeNow() !== 'viewer') setMode('viewer');
    if (!photo.active) { toggleLighting(false); showTarget(null); }
    photo.toggle();
  }
  function setPanel(on) {
    bscene.setSidePanel(on);
    el.querySelector('[data-v="panel"]').setAttribute('aria-pressed', String(on));
  }

  // ---- black / white build theme: parts sold in that colour are redrawn in it
  function updateThemeUi() {
    el.querySelector('[data-v="theme"]').textContent = `Colour: ${THEMES.find((t) => t.id === bscene.theme).label}`;
  }
  async function cycleTheme() {
    if (modeNow() !== 'viewer') { app.toast('Leave Build by hand or Auto-build to change the colour theme.'); return; }
    const next = THEMES[(THEMES.findIndex((t) => t.id === bscene.theme) + 1) % THEMES.length].id;
    bscene.setTheme(next);
    saveTheme(next);
    updateThemeUi();
    while (bscene.busy) await new Promise((r) => setTimeout(r, 16));
    fx.refresh();
    updateLighting();
  }

  // ---- lighting panel
  let lightTarget = 'all';
  function updateLighting() {
    if (!fx) return;
    const targets = fx.lightTargets();
    if (lightTarget !== 'all' && !targets.some((t) => t.id === lightTarget)) lightTarget = 'all';
    const sel = el.querySelector('[data-v="light-target"]');
    render(sel, html`<option value="all">All lighting</option>${targets.map((t) => html`<option value="${t.id}">${getCategory(t.category).short} · ${t.label}</option>`)}`);
    sel.value = lightTarget;
    const cur = fx.getRgb(lightTarget);
    el.querySelector('[data-v="light-color"]').value = cur.color;
    for (const b of el.querySelectorAll('[data-v="light-mode"]')) b.setAttribute('aria-pressed', String(b.dataset.mode === cur.mode));
    ref('light-note').textContent = targets.length
      ? `Lit parts follow the real products: fan rings, bars or blades, memory light bars, pump caps and screens, graphics card zones.${reducedMotion ? ' Breathe and rainbow stay still because reduced motion is on.' : ''}`
      : 'No part in this build has LEDs. RGB fans, RGB memory, an RGB AIO and the graphics card logo can be lit.';
  }
  function toggleLighting(open) {
    const b = el.querySelector('[data-v="lighting"]');
    const panel = el.querySelector('.viewer__lighting');
    const show = open ?? panel.hidden;
    panel.hidden = !show;
    b.setAttribute('aria-expanded', String(show));
  }

  // ---- exploded view
  function setExplode(pct) {
    const v = Math.round(Math.min(100, Math.max(0, pct)));
    bscene.setExplode(v / 100);
    el.querySelector('[data-v="explode"]').value = String(v);
    ref('explode').textContent = `${v}%`;
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
    if (v === 'mode') setMode(b.dataset.mode);
    if (v === 'panel') setPanel(!bscene.sidePanel);
    if (v === 'theme') cycleTheme();
    if (v === 'cam') rig.goTo(b.dataset.cam);
    if (v === 'quality') viewer.setQuality(QUALITIES[(QUALITIES.indexOf(viewer.quality) + 1) % QUALITIES.length], { manual: true });
    if (v === 'shot') screenshot();
    if (v === 'photo') togglePhoto();
    if (v === 'choose-case') app.setCategory('case', { focusBrowser: true });
    if (v === 'power') fx.togglePower();
    if (v === 'profile') fx.setProfile(b.dataset.profile);
    if (v === 'lighting') toggleLighting();
    if (v === 'more') {
      const on = el.dataset.more !== 'on';
      el.dataset.more = on ? 'on' : 'off';
      b.setAttribute('aria-expanded', String(on));
      b.textContent = on ? 'Fewer options' : 'More options';
    }
    if (v === 'light-mode') { fx.setRgb(lightTarget, { mode: b.dataset.mode }); updateLighting(); }
  });
  el.addEventListener('input', (e) => {
    const v = e.target.dataset?.v;
    if (v === 'explode') setExplode(Number(e.target.value));
    if (v === 'light-color') fx.setRgb(lightTarget, { color: e.target.value, ...(['off', 'aurora'].includes(fx.getRgb(lightTarget).mode) ? { mode: 'static' } : {}) });
  });
  el.addEventListener('change', (e) => {
    const v = e.target.dataset?.v;
    if (v === 'light-target') { lightTarget = e.target.value; updateLighting(); }
    if (v === 'light-color') updateLighting();
  });

  // ---- hover and click in 3D
  const ndc = new THREE.Vector2();
  let pointer = null;
  let pickQueued = false;
  let down = null;
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    pointer = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
    if (!pickQueued && e.pointerType === 'mouse' && !auto?.active && !photo?.active) {
      pickQueued = true;
      requestAnimationFrame(() => {
        pickQueued = false;
        if (pointer && !e.buttons) hoverFrom3D(pickAt(pointer), e);
      });
    }
  });
  canvas.addEventListener('pointerleave', () => { pointer = null; hoverFrom3D(null); });
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  canvas.addEventListener('pointerup', (e) => {
    if (hand?.cabling || auto?.active) return; // cable step: clicks pick ports; cinematic: no picking
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || performance.now() - down.t > 500) return;
    const r = canvas.getBoundingClientRect();
    const at = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
    if (photo?.active) { photo.focusAt(ndc.set(at.x, at.y)); return; } // photo mode: a click sets the focus
    const hit = pickAt(at);
    if (hit) app.openDetail(hit.part);
  });
  function pickAt(p) {
    ndc.set(p.x, p.y);
    return bscene.pick(ndc);
  }
  let hoverKey = '';
  function hoverFrom3D(hit, e) {
    const key = hit ? `${hit.category}:${hit.id}` : '';
    if (e && hit) moveTip(e);
    if (key === hoverKey) return;
    hoverKey = key;
    canvas.style.cursor = hit ? 'pointer' : '';
    showTarget(hit ? { category: hit.category, id: hit.id } : null, hit?.part, !!e);
    app.onViewerHover?.(hit ? { category: hit.category, id: hit.id } : null);
  }
  // Tooltip next to the pointer (3D hover) or docked bottom-left (hover from the list).
  function moveTip(e) {
    const tip = ref('hover');
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const flip = x > r.width * 0.6;
    tip.style.left = flip ? 'auto' : `${x + 14}px`;
    tip.style.right = flip ? `${r.width - x + 14}px` : 'auto';
    tip.style.top = `${Math.max(8, Math.min(r.height - 72, y + 14))}px`;
  }
  function showTarget(target, part, follow = false) {
    if (auto?.active) target = null; // nothing extra in the cinematic (or its video)
    lastTarget = target;
    const shown = bscene.highlight(target);
    const tip = ref('hover');
    if (!target || !shown) { tip.hidden = true; return; }
    const approx = bscene.approxFor(target.category, target.id);
    render(tip, html`<p class="viewer__hover-name"><span class="mono">${getCategory(target.category).short}</span> ${part?.name ?? getCategory(target.category).label}</p>
      ${approx.length ? html`<p class="viewer__hover-approx">Approximate: ${approx.join('; ')}</p>` : ''}`);
    tip.classList.toggle('is-docked', !follow);
    if (!follow) tip.removeAttribute('style');
    tip.hidden = false;
  }

  // ---- frame loop and FPS readout
  let fpsClock = 0;
  viewer.start((dt) => {
    // The cinematic's speed (and pause) applies to the camera, the side panel and the boot too.
    const k = auto?.timeScale ?? 1;
    rig.setAutoOrbit(ready && modeNow() === 'viewer' && !photo?.active);
    rig.update(dt * k);
    bscene.update(dt * k);
    fx.update(dt * k);
    hand?.update(dt);
    auto?.update(dt);
    fpsClock += dt;
    if (fpsClock >= 0.5) {
      fpsClock = 0;
      const fps = viewer.fps;
      ref('fps').textContent = `${fps ? Math.round(fps) : '--'} FPS · ${QUALITY_LABEL[viewer.quality]}${viewer.qualityAuto ? ' (auto)' : ''}`;
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
  updateThemeUi();
  fx.refresh();
  updateLighting();
  hand = mountHandPanel(ref('hand'), { app, viewer, bscene, rig, fx, reducedMotion, isShown: () => el.getClientRects().length > 0 });
  photo = mountPhotoPanel(ref('photo'), { root: el, app, viewer, stage, bscene, rig });
  if (assemblyProgress.mode === 'hand') setMode('hand', { animate: false });
  // ?debug3d exposes the viewer for checking draw calls and GPU memory in the console.
  if (new URLSearchParams(location.search).has('debug3d')) window.rigsmith3d = { THREE, viewer, scene: bscene, fx, hand, setMode, app, rig, stage, get photo() { return photo; }, get auto() { return auto; } };
  ref('loading').hidden = true;
  el.dataset.state = 'ready';

  return {
    sync: (build) => bscene.sync(build),
    /** Highlight from the parts list: {category, id?} or null. */
    highlight(target) {
      const part = target?.id ? app.catalog.get(target.id) : null;
      showTarget(target, part);
    },
    toggleSidePanel: () => { if (!building()) setPanel(!bscene.sidePanel); },
    togglePower: () => {
      if (auto?.active) return;
      if (building() && !hand.canPower()) app.toast('Connect the required cables first: the cable step lists what is missing.', 'warn');
      else fx.togglePower();
    },
    toggleExplode: () => { if (!building()) setExplode(bscene.explode > 0 ? 0 : 100); },
    toggleMode: () => { if (!auto?.active) setMode(building() ? 'viewer' : 'hand'); },
    nextCamera: () => { if (!auto?.active) rig.next(); },
    /** Play the Auto-build cinematic of the current build (once the scene has it). */
    async startAuto() {
      bscene.sync(app.store.build);
      while (bscene.busy) await new Promise((r) => requestAnimationFrame(r));
      if (auto?.active) { auto.test.player.replay(); return true; }
      return setMode('auto');
    },
    screenshot,
    togglePhoto,
  };
}
