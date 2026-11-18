// Auto-build, the UI: play/pause, speed, replay, skip, the clickable step timeline, the step
// caption over the 3D view, "Save as video" with its progress and download, and what to do
// once the PC is built. The sequence itself is js/scene/cinematic.js; recording is
// js/scene/recorder.js.
import { createCinematic, SPEEDS } from '../scene/cinematic.js?v=733eefba1e';
import { createRecorder, videoFormat } from '../scene/recorder.js?v=733eefba1e';
import { assemblyProgress } from '../state.js?v=733eefba1e';
import { priceBuild, formatTHB, PRICE_NOTE } from '../pricing.js?v=733eefba1e';
import { CONFIG } from '../config.js?v=733eefba1e';
import { html, render } from './dom.js?v=733eefba1e';

const typing = (el) => el?.closest?.('input, select, textarea, [contenteditable="true"]');
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'build';
const mb = (b) => `${(b / 1e6).toFixed(1)} MB`;
const clockText = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * @param {HTMLElement} el panel under the 3D view
 * @param {HTMLElement} stage the 3D view's stage (caption and crossfade layer go on top of the canvas)
 * @param {{app, viewer, bscene, rig, fx, hand, reducedMotion: boolean, isShown: () => boolean,
 *   onExit: () => void, onOpenHand: (finalState: object) => void, onEditParts: () => void, onScreenshot: () => void}} ctx
 */
export function mountCinematicPanel(el, stage, ctx) {
  const { app, viewer, bscene, rig, fx, hand, reducedMotion, isShown } = ctx;
  const format = videoFormat();

  const overlay = document.createElement('div');
  overlay.className = 'auto-ov';
  overlay.hidden = true;
  render(overlay, html`
    <canvas class="auto-ov__fade" aria-hidden="true"></canvas>
    <p class="auto-ov__rec mono" data-a="rec" hidden>Rec</p>
    <div class="auto-ov__cap"><p class="auto-ov__step mono" data-a="stepno"></p><p class="auto-ov__label" data-a="label"></p></div>`);
  stage.append(overlay);

  render(el, html`
    <div class="auto__bar">
      <div class="auto__ctrl">
        <button class="vbtn vbtn--accent auto__play" type="button" data-a="play" aria-keyshortcuts="Space">Pause</button>
        <div class="vgroup" role="group" aria-label="Playback speed">
          ${SPEEDS.map((k) => html`<button class="vbtn" type="button" data-a="speed" data-k="${k}" aria-pressed="${String(k === 1)}">${k}×</button>`)}
        </div>
        <button class="vbtn" type="button" data-a="replay" aria-keyshortcuts="Home">Replay</button>
        <button class="vbtn" type="button" data-a="skip" aria-keyshortcuts="End">Skip to end</button>
      </div>
      <span class="viewer__spacer"></span>
      <div class="auto__ctrl">
        <button class="vbtn" type="button" data-a="record" ${format ? '' : 'disabled'}>Save as video</button>
        <button class="vbtn" type="button" data-a="mute" aria-pressed="true" title="Click sound as parts seat and cables plug in">Sound</button>
        <button class="vbtn" type="button" data-a="exit" aria-keyshortcuts="Escape">Exit</button>
      </div>
    </div>
    <ol class="tl" data-a="timeline" aria-label="Auto-build steps: pick one to jump to it"></ol>
    <div class="auto__rec" data-a="recrow" hidden></div>
    <div class="auto__done" data-a="done" hidden></div>
    <p class="auto__note muted" data-a="note"></p>
    <p class="visually-hidden" role="status" aria-live="polite" data-a="status"></p>`);
  const $ = (k) => el.querySelector(`[data-a="${k}"]`);
  const $o = (k) => overlay.querySelector(`[data-a="${k}"]`);

  const player = createCinematic({
    viewer, bscene, rig, fx, hb: hand.hb, sound: hand.sound, reducedMotion,
    fadeCanvas: overlay.querySelector('.auto-ov__fade'),
    cableStyle: () => assemblyProgress.cableStyle,
    onStep: () => paintStep(),
    onState: (s) => onState(s),
  });

  let rec = null;        // recorder while recording
  let video = null;      // { url, size, ext, seconds, name }
  let shownIndex = -2;
  let textClock = 0;

  // ---------------------------------------------------------------- build facts
  function buildName() {
    const b = bscene.build;
    if (app.ui.current?.name) return app.ui.current.name;
    const named = [b.cpu, b.gpu].filter(Boolean).map((p) => p.name);
    return named.length ? named.join(' + ') : b.case?.name ?? 'Untitled build';
  }
  const priceText = () => formatTHB(priceBuild(bscene.build).total);

  // ---------------------------------------------------------------- video overlay
  // Same look as the page: Barlow Condensed wordmark with its mark, Plex Sans name, Plex Mono price.
  function drawOverlay(c, w, h) {
    const f = player.fade;
    if (f.alpha > 0) {
      c.globalAlpha = f.alpha;
      c.drawImage(f.canvas, 0, 0, w, h);
      c.globalAlpha = 1;
    }
    const s = h / 720;
    const pad = Math.round(30 * s);
    const g = c.createLinearGradient(0, h * 0.7, 0, h);
    g.addColorStop(0, 'rgba(11,13,16,0)');
    g.addColorStop(1, 'rgba(11,13,16,0.8)');
    c.fillStyle = g;
    c.fillRect(0, h * 0.7, w, h * 0.3);

    const m = 15 * s;
    c.lineWidth = 2 * s;
    c.strokeStyle = '#E7EAEE';
    c.strokeRect(pad + s, pad + s, m - 2 * s, m - 2 * s);
    c.fillStyle = '#FF5A1F';
    c.fillRect(pad + m - 4 * s, pad + m - 4 * s, 6 * s, 6 * s);
    c.fillStyle = '#E7EAEE';
    c.textBaseline = 'middle';
    c.font = `700 ${Math.round(23 * s)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    if ('letterSpacing' in c) c.letterSpacing = `${(0.16 * 23 * s).toFixed(1)}px`;
    c.fillText(CONFIG.appName.toUpperCase(), pad + m + 11 * s, pad + m / 2 + s);
    if ('letterSpacing' in c) c.letterSpacing = '0px';

    c.textBaseline = 'alphabetic';
    const maxW = w - pad * 2;
    c.font = `600 ${Math.round(27 * s)}px "IBM Plex Sans", system-ui, sans-serif`;
    let name = buildName();
    while (name.length > 4 && c.measureText(name).width > maxW) name = `${name.slice(0, -2).trimEnd()}…`;
    c.fillText(name, pad, h - pad - 30 * s);
    c.font = `500 ${Math.round(19 * s)}px "IBM Plex Mono", ui-monospace, monospace`;
    const price = priceText();
    c.fillText(price, pad, h - pad);
    c.fillStyle = '#8A93A0';
    c.fillText(` · ${PRICE_NOTE.toLowerCase()}`, pad + c.measureText(price).width, h - pad);
  }

  // ---------------------------------------------------------------- recording
  async function startRecording() {
    if (!format || rec) return;
    clearVideo();
    try {
      await Promise.all(['700 24px "Barlow Condensed"', '600 24px "IBM Plex Sans"', '500 24px "IBM Plex Mono"'].map((f) => document.fonts.load(f)));
    } catch { /* system fonts stand in */ }
    try {
      rec = createRecorder(viewer.renderer.domElement, { draw: drawOverlay });
    } catch (err) {
      console.warn('Rigsmith: recording could not start.', err);
      setNote('This browser could not start recording the 3D view.');
      return;
    }
    rec.name = buildName();
    player.seek(0, { play: true });
    refresh();
  }
  async function finishRecording() {
    const r = rec;
    if (!r) return;
    rec = null;
    // A moment of the finished PC at the end.
    await new Promise((res) => setTimeout(res, 500));
    try {
      const blob = await r.stop();
      video = { url: URL.createObjectURL(blob), size: blob.size, ext: r.format.ext, seconds: r.seconds, w: r.width, h: r.height, name: r.name };
      $('status').textContent = `Video ready: ${r.format.ext.toUpperCase()}, ${mb(blob.size)}.`;
    } catch (err) {
      console.warn('Rigsmith: recording failed.', err);
      setNote('The recording failed. Try again, or lower the quality first.');
    }
    refresh();
  }
  function cancelRecording() {
    if (!rec) return;
    rec.cancel();
    rec = null;
    player.pause();
    refresh();
  }
  function clearVideo() {
    if (video) URL.revokeObjectURL(video.url);
    video = null;
  }
  const videoFile = () => `${slug(CONFIG.appName)}-${slug(video?.name ?? buildName())}-auto-build-${new Date().toISOString().slice(0, 10)}.${video?.ext ?? 'webm'}`;

  // ---------------------------------------------------------------- DOM
  function setNote(text) { $('note').textContent = text; }
  function defaultNote() {
    const parts = [];
    if (reducedMotion) parts.push('Reduced motion is on: each step fades in instead of moving, and the camera cuts.');
    parts.push(format ? `Save as video records the 3D view as ${format.ext.toUpperCase()} at the current quality, with the build name and price on it.` : 'This browser cannot record video from the page; screenshots still work.');
    return parts.join(' ');
  }

  function renderTimeline() {
    const steps = player.steps;
    render($('timeline'), html`${steps.map((s, i) => html`
      <li class="tl__item">
        <button class="tl__seg" type="button" data-a="step" data-i="${i}" data-focus-key="tl-${i}" title="${s.label}" aria-label="Step ${i + 1} of ${steps.length}: ${s.label}">
          <span class="tl__fill"></span><span class="tl__label">${s.short}</span>
        </button>
      </li>`)}`);
    shownIndex = -2;
  }

  // On every step (or cable) change: the caption, and the timeline states once per step.
  function paintStep() {
    const i = player.index;
    const steps = player.steps;
    const done = player.state === 'done' || i >= steps.length;
    $o('stepno').textContent = done ? `${steps.length}/${steps.length} · ${priceText()}` : i >= 0 ? `Step ${i + 1}/${steps.length}` : '';
    $o('label').textContent = done ? buildName() : player.label;
    if (i === shownIndex) return;
    shownIndex = i;
    $('status').textContent = done ? `Finished: ${buildName()}.` : steps[i] ? `Step ${i + 1} of ${steps.length}: ${steps[i].label}` : '';
    el.querySelectorAll('.tl__seg').forEach((b, k) => {
      b.dataset.state = k < i ? 'done' : k === i ? 'current' : 'todo';
      if (k === i) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
      b.firstElementChild.style.width = k < i ? '100%' : '0%';
    });
  }

  // Per frame: the current segment's fill and the recording readout.
  function tick(dt) {
    const i = player.index;
    const cur = el.querySelectorAll('.tl__seg')[i];
    if (cur) cur.firstElementChild.style.width = `${Math.round(player.stepProgress * 100)}%`;
    textClock += dt;
    if (rec && textClock > 0.25) {
      textClock = 0;
      const pct = Math.round(player.progress * 100);
      $('recrow').querySelector('.auto__recbar span').style.width = `${pct}%`;
      $('recrow').querySelector('[data-a="rectext"]').textContent = `Recording · ${pct}% · ${clockText(rec.seconds)} · ${mb(rec.bytes)}`;
      $o('rec').textContent = `Rec ${clockText(rec.seconds)}`;
    }
  }

  function refresh() {
    const s = player.state;
    const recording = !!rec;
    el.dataset.state = s;
    el.dataset.recording = String(recording);
    const play = $('play');
    play.textContent = s === 'playing' ? 'Pause' : 'Play'; // finished: Play starts again
    play.setAttribute('aria-pressed', String(s === 'playing'));
    for (const b of el.querySelectorAll('[data-a="speed"]')) b.setAttribute('aria-pressed', String(Number(b.dataset.k) === player.speed));
    for (const b of el.querySelectorAll('[data-a="play"], [data-a="speed"], [data-a="replay"], [data-a="skip"], [data-a="step"]')) b.disabled = recording;
    $('skip').disabled ||= s === 'done';
    $('record').disabled = !format || recording;
    $('mute').setAttribute('aria-pressed', String(!hand.sound.muted));
    $('mute').textContent = hand.sound.muted ? 'Muted' : 'Sound';
    $o('rec').hidden = !recording;
    overlay.dataset.recording = String(recording);

    const row = $('recrow');
    row.hidden = !recording && !video;
    if (recording) {
      render(row, html`
        <div class="auto__recbar" aria-hidden="true"><span style="width:${Math.round(player.progress * 100)}%"></span></div>
        <p class="auto__rectext mono" data-a="rectext">Recording · starting</p>
        <button class="vbtn" type="button" data-a="cancel">Cancel recording</button>`);
    } else if (video) {
      render(row, html`
        <p class="auto__rectext mono">Video ready · ${video.ext.toUpperCase()} · ${video.w}×${video.h} · ${clockText(video.seconds)} · ${mb(video.size)}</p>
        <a class="btn btn--primary btn--sm" data-a="download" data-focus-key="download" href="${video.url}" download="${videoFile()}">Download video</a>
        <button class="linkbtn" type="button" data-a="discard">Discard</button>`);
    }

    const done = $('done');
    done.hidden = s !== 'done' || recording;
    if (!done.hidden) {
      render(done, html`
        <p class="auto__done-text"><span class="label">Built</span> <span>${buildName()}</span> <span class="mono">${priceText()}</span> <span class="muted">${PRICE_NOTE.toLowerCase()}</span></p>
        <div class="auto__done-actions">
          <button class="btn btn--primary btn--sm" type="button" data-a="hand" data-focus-key="ab-hand">Open in Build by hand</button>
          <button class="btn btn--sm" type="button" data-a="edit" data-focus-key="ab-edit">Edit parts</button>
          <button class="btn btn--sm" type="button" data-a="shot" data-focus-key="ab-shot">Take screenshot</button>
        </div>`);
    }
    paintStep();
  }

  function onState(s) {
    if (s === 'done' && rec) finishRecording();
    refresh();
  }

  // ---------------------------------------------------------------- input
  function stepBy(d) {
    const i = player.state === 'done' ? player.steps.length : player.index;
    player.seek(i + d);
  }
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (!b || b.disabled) return;
    const a = b.dataset.a;
    if (a === 'play') player.toggle();
    if (a === 'speed') player.setSpeed(Number(b.dataset.k));
    if (a === 'replay') player.replay();
    if (a === 'skip') player.skip();
    if (a === 'step') player.seek(Number(b.dataset.i));
    if (a === 'record') startRecording();
    if (a === 'cancel') cancelRecording();
    if (a === 'discard') { clearVideo(); refresh(); }
    if (a === 'mute') hand.sound.setMuted(!hand.sound.muted);
    if (a === 'exit') ctx.onExit();
    if (a === 'hand') ctx.onOpenHand(player.finalState());
    if (a === 'edit') ctx.onEditParts();
    if (a === 'shot') ctx.onScreenshot();
    if (a !== 'download') refresh();
  });

  function onKey(e) {
    if (!player.active || !isShown() || typing(e.target) || document.querySelector('dialog[open]')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const onButton = e.target.closest?.('button, a');
    if (e.key === 'Escape') { e.preventDefault(); ctx.onExit(); return; }
    if (rec) return;
    if (e.key === ' ' && !onButton) player.toggle();
    else if (e.key === 'ArrowRight') stepBy(1);
    else if (e.key === 'ArrowLeft') stepBy(-1);
    else if (e.key === 'Home') player.replay();
    else if (e.key === 'End') player.skip();
    else return;
    e.preventDefault();
    refresh();
  }
  document.addEventListener('keydown', onKey);

  return {
    /** Start from the top for the build in the scene. Returns { ok, reason }. */
    enter() {
      overlay.hidden = false;
      el.hidden = false;
      setNote(defaultNote());
      viewer.setAfterRender(() => {
        player.afterRender();
        rec?.frame();
      });
      const r = player.enter();
      if (!r.ok) {
        this.leave();
        return r;
      }
      renderTimeline();
      refresh();
      return r;
    },
    leave() {
      cancelRecording();
      clearVideo();
      player.exit();
      viewer.setAfterRender(null);
      overlay.hidden = true;
      el.hidden = true;
    },
    /** The build in the scene changed. */
    onLayout() {
      const r = player.onLayout();
      if (!r) return;
      cancelRecording();
      if (!r.ok) { ctx.onExit(); app.toast(r.reason, 'warn'); return; }
      renderTimeline();
      refresh();
    },
    update(dt) {
      if (!player.active) return;
      player.update(dt);
      tick(dt);
    },
    get timeScale() { return player.timeScale; },
    get active() { return player.active; },
    // For tools/test-browser.mjs (exposed with ?debug3d).
    test: {
      player,
      get recording() { return !!rec; },
      get video() { return video; },
      get caption() { return `${$o('stepno').textContent} ${$o('label').textContent}`.trim(); },
      get format() { return format; },
    },
    dispose() {
      this.leave();
      document.removeEventListener('keydown', onKey);
      player.dispose();
      overlay.remove();
    },
  };
}
