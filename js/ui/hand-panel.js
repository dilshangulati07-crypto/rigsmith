// Build by hand, the UI: parts tray with thumbnails, install order with reasons, progress by
// step, undo/redo/reset, "Show me where", mute, and the drag from the tray into the 3D case.
// Once every part is in, the cable step (js/ui/cable-panel.js) takes over the panel.
// Rules come from js/scene/assembly.js (order) and js/compat.js (fit); progress lives in
// js/state.js (assemblyProgress); the 3D side is js/scene/hand-build.js.
import {
  planAssembly, canInstall, checkFit, freePieces, reconcile, progress as progressOf, currentStage,
} from '../scene/assembly.js?v=00a22f4faf';
import { createHandBuild } from '../scene/hand-build.js?v=00a22f4faf';
import { createSound } from '../scene/sound.js?v=00a22f4faf';
import { mountCablePanel } from './cable-panel.js?v=00a22f4faf';
import { ramSlotNames } from '../scene/layout-board.js?v=00a22f4faf';
import { assemblyProgress } from '../state.js?v=00a22f4faf';
import { getCategory } from '../categories.js?v=00a22f4faf';
import { html, render } from './dom.js?v=00a22f4faf';

const typing = (el) => el?.closest?.('input, select, textarea, [contenteditable="true"]');

function stageHint(stage, plan) {
  const L = plan.layout;
  switch (stage?.id) {
    case 'prep': return 'Drag the standoffs and I/O shield into the case. The shield clips into the rear cut-out.';
    case 'psu': return 'Drag the power supply into its mount.';
    case 'motherboard': return 'Lower the motherboard onto the standoffs, rear I/O first.';
    case 'cpu': return 'The socket lever is up. Drop the processor into the socket, then the lever closes.';
    case 'radiator': return 'Mount the radiator with its fans on the highlighted panel.';
    case 'cooler': return plan.groups.some((g) => g.stage === 'radiator') ? 'Seat the pump block on the processor.' : 'Seat the cooler on the processor.';
    case 'ram': {
      const names = ramSlotNames(L.board?.layout.ram.length ?? 4);
      const slots = L.ram.map((r) => names[r.slot]);
      return `Press the memory into ${slots.join(', ')} until the latches click.`;
    }
    case 'm2': return 'The M.2 cover is off. Slide the drive into the slot.';
    case 'sata': return 'Slide the SATA drive into its bay.';
    case 'gpu': return 'The slot covers are out. Push the card into the top x16 slot.';
    case 'fans': return 'Mount the case fans.';
    default: return '';
  }
}

/**
 * @param {HTMLElement} el container inside the viewer panel
 * @param {{app: object, viewer: object, bscene: object, rig: object, fx: object, reducedMotion: boolean, isShown: () => boolean}} ctx
 */
export function mountHandPanel(el, { app, viewer, bscene, rig, fx, reducedMotion, isShown }) {
  const progress = assemblyProgress;
  const sound = createSound();
  const hb = createHandBuild({ viewer, bscene, rig, reducedMotion, sound });
  let plan = null;
  let active = false;
  let busy = false;
  let selected = null;
  let lastStage = null;
  let msg = null; // { text, level }
  let msgTimer = 0;

  render(el, html`
    <div class="hand__bar">
      <div class="hand__progress" data-h="progress"></div>
      <div class="hand__tools">
        <button class="vbtn" type="button" data-h="undo" aria-keyshortcuts="Control+Z">Undo</button>
        <button class="vbtn" type="button" data-h="redo" aria-keyshortcuts="Control+Y">Redo</button>
        <button class="vbtn" type="button" data-h="where" aria-keyshortcuts="H">Show me where</button>
        <button class="vbtn" type="button" data-h="reset">Reset case</button>
        <button class="vbtn" type="button" data-h="mute" aria-pressed="true" aria-keyshortcuts="M" title="Click sound when a part seats">Sound</button>
      </div>
    </div>
    <p class="hand__msg" data-h="msg" role="status" aria-live="polite"></p>
    <div class="hand__done" data-h="done" hidden>
      <p><span class="label">Parts installed — cables next</span> Every part is in. Connect the cables below, or press Auto-route.</p>
    </div>
    <div class="cab" data-h="cables" hidden></div>
    <div class="tray" data-h="tray-wrap">
      <h3 class="label tray__title" id="tray-title">Parts tray</h3>
      <ul class="tray__list" data-h="tray" aria-labelledby="tray-title"></ul>
    </div>`);
  const $ = (k) => el.querySelector(`[data-h="${k}"]`);
  const cab = mountCablePanel($('cables'), {
    app, viewer, bscene, rig, fx, sound, progress, reducedMotion,
    setMsg: (text, level, ms) => setMsg(text, level, ms),
    onChange: () => { renderProgress(); refreshButtons(); },
  });

  // ---------------------------------------------------------------- state
  const installedSet = () => new Set(progress.installed);

  function replan() {
    const build = bscene.build;
    if (!build || !bscene.layout) return;
    plan = planAssembly(build, bscene.layout);
    cab.replan(plan);
    progress.sync(plan.caseId, (keys) => reconcile(plan, keys), (c) => cab.keepCables(c));
    refresh();
  }

  function setMsg(text, level = 'info', ms = 0) {
    msg = text ? { text, level } : null;
    clearTimeout(msgTimer);
    if (ms) msgTimer = setTimeout(() => { msg = null; refreshMsg(); }, ms);
    refreshMsg();
  }
  function refreshMsg() {
    const m = $('msg');
    const p = plan && progressOf(plan, installedSet());
    if (msg) {
      m.textContent = msg.text;
      m.dataset.level = msg.level;
    } else if (plan && !plan.ready) {
      m.textContent = plan.reason;
      m.dataset.level = 'info';
    } else if (p?.complete) {
      m.textContent = cab.hint();
      m.dataset.level = 'info';
    } else if (p) {
      m.textContent = p.current ? `Step ${p.stages.findIndex((s) => s.id === p.current.id) + 1} of ${p.stages.length} · ${p.current.label}. ${stageHint(p.current, plan)}` : 'Add parts to the build to install them.';
      m.dataset.level = 'info';
    }
  }

  function refresh() {
    if (!plan) return;
    const inst = installedSet();
    const p = progressOf(plan, inst);
    const stage = currentStage(plan, inst);
    hb.setState(plan, inst, stage?.id ?? null);

    renderProgress(p);

    // Tray.
    const items = plan.ready ? plan.groups.map((g) => {
      const free = freePieces(plan, inst, g.key).length;
      const order = canInstall(plan, inst, g.key);
      const state = free === 0 ? 'done' : order.ok ? 'ready' : 'locked';
      return { g, free, state, why: free === 0 ? 'Installed' : order.reason };
    }) : [];
    render($('tray'), html`
      ${!plan.ready ? html`<li class="tray__item tray__item--empty"><p>${plan.reason}</p><button class="btn btn--sm" type="button" data-h="choose-case">Choose a case</button></li>` : ''}
      ${plan.ready && !items.length ? html`<li class="tray__item tray__item--empty"><p>This build has no parts to install yet. Add parts in the catalogue, then come back.</p></li>` : ''}
      ${items.map(({ g, free, state, why }) => html`
        <li class="tray__item" data-state="${state}" data-selected="${String(selected === g.key)}">
          <button class="tray__part" type="button" data-group="${g.key}" data-focus-key="tray-${g.key}"
            aria-disabled="${String(state !== 'ready')}" aria-describedby="why-${g.key}"
            title="${state === 'ready' ? 'Drag into the case, or press Place' : why}">
            <span class="tray__thumb" data-thumb="${g.key}" aria-hidden="true">${hb.cachedThumb(g) ? html`<img alt="" src="${hb.cachedThumb(g)}">` : ''}</span>
            <span class="tray__text">
              <span class="tray__cat mono">${g.stage === 'prep' ? 'Case' : g.stage === 'radiator' ? 'Radiator' : getCategory(g.category).short}</span>
              <span class="tray__name">${g.label}</span>
              ${g.detail ? html`<span class="tray__detail">${g.detail}</span>` : ''}
            </span>
          </button>
          <p class="tray__why" id="why-${g.key}" data-state="${state}">${state === 'ready' ? `${g.pieces.length - free}/${g.pieces.length} in · ready` : why}</p>
          <div class="tray__actions">
            ${state === 'ready' ? html`<button class="linkbtn" type="button" data-h="place" data-g="${g.key}" data-focus-key="place-${g.key}">Place</button>` : ''}
            ${g.part ? html`<button class="linkbtn" type="button" data-h="swap" data-g="${g.key}" data-focus-key="swap-${g.key}">Swap</button>` : ''}
          </div>
        </li>`)}
      ${plan.skipped.map((s) => html`
        <li class="tray__item" data-state="skipped">
          <div class="tray__part" aria-disabled="true">
            <span class="tray__thumb" aria-hidden="true"></span>
            <span class="tray__text"><span class="tray__cat mono">${getCategory(s.category).short}</span><span class="tray__name">${s.part.name}</span></span>
          </div>
          <p class="tray__why">${s.reason}</p>
        </li>`)}`);
    fillThumbs();

    $('tray-wrap').hidden = p.complete && plan.ready;
    el.dataset.complete = String(p.complete);
    cab.setActive(active && p.complete && plan.ready);
    refreshButtons();
    refreshMsg();

    // Camera follows the work: a new step focuses its area.
    const sid = stage?.id ?? null;
    if (active && sid !== lastStage) {
      lastStage = sid;
      if (sid) hb.focusStage(sid);
    }
  }

  // Progress by step, with the cable step at the end once there is a cable plan.
  function renderProgress(p = plan && progressOf(plan, installedSet())) {
    if (!p) return;
    const c = cab.summary();
    const cableState = !p.complete ? 'todo' : c.done >= c.total ? 'done' : 'current';
    const total = p.total + c.total;
    const done = p.done + c.done;
    render($('progress'), html`
      <div class="hsteps" role="progressbar" aria-label="Build progress" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}" aria-valuetext="${p.done} of ${p.total} parts installed${c.total ? `, ${c.done} of ${c.total} cables connected` : ''}${p.current ? `, now: ${p.current.label}` : ''}">
        ${p.stages.map((s) => html`<span class="hsteps__seg" data-state="${s.state}" title="${s.label}: ${s.done} of ${s.total}"><span class="hsteps__fill" style="width:${Math.round((s.done / s.total) * 100)}%"></span><span class="hsteps__label">${s.short}</span></span>`)}
        ${c.total ? html`<span class="hsteps__seg" data-state="${cableState}" title="Cables: ${c.done} of ${c.total}"><span class="hsteps__fill" style="width:${Math.round((c.done / c.total) * 100)}%"></span><span class="hsteps__label">Cables</span></span>` : ''}
      </div>
      <p class="hsteps__count mono">${done}/${total}</p>`);
  }
  function refreshButtons() {
    const p = plan && progressOf(plan, installedSet());
    $('undo').disabled = !progress.canUndo || busy;
    $('redo').disabled = !progress.canRedo || busy;
    $('reset').disabled = (!progress.installed.length && !Object.keys(progress.cables).length) || busy;
    $('where').disabled = !p?.current && !cab.active;
    $('mute').setAttribute('aria-pressed', String(!sound.muted));
    $('mute').textContent = sound.muted ? 'Muted' : 'Sound';
    // The "cables next" banner only until the first cable is in.
    $('done').hidden = !p?.complete || !plan.ready || Object.keys(progress.cables).length > 0;
  }

  // Thumbnails render from the 3D models; models build asynchronously, so retry when missing.
  let thumbFrame = 0;
  function fillThumbs() {
    if (thumbFrame || !plan) return;
    thumbFrame = requestAnimationFrame(() => {
      thumbFrame = 0;
      if (!active || !plan?.ready) return;
      let drew = false;
      for (const span of el.querySelectorAll('[data-thumb]')) {
        if (span.firstChild) continue;
        const g = plan.groups.find((x) => x.key === span.dataset.thumb);
        const url = g && hb.thumbnail(g);
        if (!url) continue;
        drew = true;
        const img = new Image();
        img.alt = '';
        img.src = url;
        span.append(img);
      }
      if (drew) viewer.render();
    });
  }

  // ---------------------------------------------------------------- actions
  const groupOf = (key) => plan?.groups.find((g) => g.key === key);

  async function install(groupKey, { viaDrag = false } = {}) {
    const inst = installedSet();
    const order = canInstall(plan, inst, groupKey);
    if (!order.ok) {
      if (viaDrag) await hb.discard();
      setMsg(order.reason, 'warn', 5000);
      return false;
    }
    const fit = checkFit(bscene.build, plan, inst, groupKey);
    if (!fit.ok) {
      if (viaDrag) await hb.discard();
      setMsg(`That part doesn't fit here: ${fit.reason}${fit.fix ? ` ${fit.fix}` : ''}`, 'warn', 9000);
      return false;
    }
    return true;
  }

  async function seat(groupKey, pieceKey) {
    busy = true;
    refresh();
    const g = groupOf(groupKey);
    try {
      await hb.seat(pieceKey, { onSeated: (k) => progress.install(k) });
      setMsg(`${g.stage === 'prep' ? 'Standoffs and I/O shield' : g.label} installed.`, 'ok', 2600);
    } finally {
      busy = false;
      refresh();
    }
  }

  async function place(groupKey) {
    if (busy || hb.dragging) return;
    const free = freePieces(plan, installedSet(), groupKey);
    if (!free.length || !(await install(groupKey))) return;
    await seat(groupKey, free[0]);
  }

  function showWhere(groupKey) {
    if (cab.active) { cab.showNext(); return; }
    const key = groupKey ?? firstReady();
    if (!key) return;
    const order = canInstall(plan, installedSet(), key);
    if (!order.ok && order.reason !== 'Already installed.') setMsg(order.reason, 'warn', 5000);
    else hb.showWhere(key);
  }
  const firstReady = () => plan?.groups.find((g) => canInstall(plan, installedSet(), g.key).ok)?.key ?? null;

  function select(groupKey) {
    selected = groupKey;
    for (const li of el.querySelectorAll('.tray__item')) li.dataset.selected = String(li.querySelector('[data-group]')?.dataset.group === groupKey);
    showWhere(groupKey);
  }

  function undo() {
    if (busy || hb.dragging || cab.dragging) return;
    if (progress.undo()) setMsg('Undone.', 'info', 1800);
  }
  function redo() {
    if (busy || hb.dragging || cab.dragging) return;
    if (progress.redo()) setMsg('Redone.', 'info', 1800);
  }
  function reset() {
    if (busy || hb.dragging || cab.dragging) return;
    if (progress.reset()) setMsg('Case reset. Undo puts the parts and cables back.', 'info', 4000);
  }

  // ---------------------------------------------------------------- drag from the tray
  const canvas = viewer.renderer.domElement;
  let press = null; // { id, x, y, group, started, blocked (refusal text or false) }
  let suppressClick = false;
  function ndc(e) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
  }
  const tray = $('tray');
  tray.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-group]');
    if (!b || e.button !== 0 || busy) return;
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, group: b.dataset.group, started: false, blocked: false, el: b };
    b.setPointerCapture(e.pointerId);
  });
  tray.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    if (!press.started && !press.blocked) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < 6) return;
      suppressClick = true;
      const order = canInstall(plan, installedSet(), press.group);
      if (!order.ok) {
        // Stays up while the locked item is held; fades 5 s after release.
        press.blocked = order.reason;
        setMsg(order.reason, 'warn');
        return;
      }
      press.started = hb.beginDrag(press.group, ndc(e));
      if (press.started) {
        el.dataset.dragging = 'true';
        hb.clearHint();
      }
    }
    if (press.started) {
      const r = hb.moveDrag(ndc(e));
      if (r?.snap === 'bad') setMsg(r.reason, 'warn');
      else if (r?.snap === 'ok') setMsg('Release to install.', 'ok');
      else setMsg(null);
    }
  });
  async function release(e, cancelled) {
    if (!press || e.pointerId !== press.id) return;
    const p = press;
    press = null;
    el.dataset.dragging = 'false';
    if (p.el.hasPointerCapture?.(e.pointerId)) p.el.releasePointerCapture(e.pointerId);
    if (p.blocked) setMsg(p.blocked, 'warn', 5000);
    if (!p.started) return;
    if (cancelled) { hb.cancelDrag(); setMsg(null); return; }
    const r = hb.endDrag();
    if (r.kind === 'ok') {
      if (await install(p.group, { viaDrag: true })) await seat(p.group, r.pieceKey);
    } else if (r.kind === 'bad') {
      setMsg(r.reason, 'warn', 6000);
      await hb.discard();
    } else {
      setMsg('Release it over the highlighted spot to install it.', 'info', 3500);
      await hb.discard();
    }
  }
  tray.addEventListener('pointerup', (e) => release(e, false));
  tray.addEventListener('pointercancel', (e) => release(e, true));
  tray.addEventListener('lostpointercapture', (e) => { if (press?.started && e.pointerId === press.id) release(e, false); });

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-h], [data-group]');
    if (!b) return;
    if (b.dataset.group) {
      if (suppressClick) { suppressClick = false; return; }
      const g = b.dataset.group;
      if (b.getAttribute('aria-disabled') === 'true') {
        const order = canInstall(plan, installedSet(), g);
        setMsg(order.reason === 'Already installed.' ? `${groupOf(g)?.label ?? 'That part'} is installed.` : order.reason, 'warn', 4000);
      } else select(g);
      return;
    }
    const h = b.dataset.h;
    if (h === 'place') place(b.dataset.g);
    if (h === 'swap') {
      const g = groupOf(b.dataset.g);
      if (!g?.part) return;
      app.ui.returnTo3D = true;
      app.startSwap(g.category, g.part.id);
      app.toast(`Pick a ${getCategory(g.category).label.toLowerCase()} to swap for ${g.part.name}. You'll come back to the 3D build.`);
    }
    if (h === 'choose-case') {
      app.ui.returnTo3D = true;
      app.setCategory('case', { focusBrowser: true });
    }
    if (h === 'undo') undo();
    if (h === 'redo') redo();
    if (h === 'reset') reset();
    if (h === 'where') showWhere(selected && canInstall(plan, installedSet(), selected).ok ? selected : null);
    if (h === 'mute') { sound.setMuted(!sound.muted); refresh(); }
  });

  function onKey(e) {
    if (!active || !isShown() || typing(e.target) || document.querySelector('dialog[open]')) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); } else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (k === 'h') showWhere(selected && canInstall(plan, installedSet(), selected).ok ? selected : null);
    else if (k === 'm') { sound.setMuted(!sound.muted); refresh(); setMsg(sound.muted ? 'Sound off.' : 'Sound on.', 'info', 1500); }
    else if (e.key === 'Escape' && hb.dragging) { hb.cancelDrag(); press = null; el.dataset.dragging = 'false'; setMsg(null); } else if (e.key === 'Escape') cab.escape();
    else if ((e.key === 'Delete' || e.key === 'Backspace') && cab.active) { e.preventDefault(); cab.removeSelected(); }
  }
  document.addEventListener('keydown', onKey);
  const onProgress = (e) => {
    if (e.detail.action === 'mode') return;
    if (e.detail.action === 'style') { cab.refresh(); return; }
    // History from before a part swap can name parts that are gone: fit it to this build.
    if ((e.detail.action === 'undo' || e.detail.action === 'redo') && plan) progress.sync(plan.caseId, (keys) => reconcile(plan, keys));
    refresh();
  };
  progress.addEventListener('change', onProgress);

  return {
    hb,
    /** Click sound (shared with the Auto-build cinematic, so one mute covers both). */
    sound,
    /** @param {{animate?: boolean}} opts animate = false when restoring after a reload */
    enter({ animate = true } = {}) {
      if (active) return;
      active = true;
      lastStage = undefined;
      fx.setPower(false);
      hb.enter({ animate });
      el.hidden = false;
      replan();
      // Case above, tray below: bring both on screen.
      requestAnimationFrame(() => el.closest('.viewer')?.scrollIntoView({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' }));
    },
    leave() {
      if (!active) return;
      active = false;
      press = null;
      cab.leave();
      hb.leave();
      el.hidden = true;
      setMsg(null);
    },
    get active() { return active; },
    /** Call when the build scene has applied a new build (parts swapped, case changed). */
    onLayout() { if (active) replan(); },
    update(dt) { if (active) { hb.update(dt); cab.update3d(dt); } },
    /** True when every required cable is in (the PC may power on). */
    canPower: () => active && cab.canPower(),
    get cabling() { return active && cab.active; },
    /** True while a part or a cable is being dragged or animated in. */
    get dragging() { return active && (busy || hb.animating || hb.dragging || cab.dragging); },
    // For tools/test-browser.mjs (exposed with ?debug3d).
    test: {
      get plan() { return plan; },
      place,
      select,
      undo,
      redo,
      reset,
      get busy() { return busy || hb.animating || hb.dragging || rig.moving || cab.dragging; },
      cables: cab.test,
      get message() { return $('msg').textContent; },
      screenPoint: (groupKey, opts) => hb.screenPoint(groupKey, opts),
    },
    dispose() {
      this.leave();
      document.removeEventListener('keydown', onKey);
      progress.removeEventListener('change', onProgress);
      cab.dispose();
      hb.dispose();
      sound.dispose();
    },
  };
}
