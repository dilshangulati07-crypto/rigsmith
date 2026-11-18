// Build by hand, the cable step: the checklist of connections from the part data, connecting
// by clicking a plug (PSU, case, fan) and then the glowing port, dragging waypoints,
// Auto-route, cable styles, the cable-management score, Power on, closing the case, and the
// final screenshot and share. The plan comes from js/scene/cable-plan.js, routes and the
// score from js/scene/cable-route.js, the 3D cables from js/scene/cables.js; the cables
// themselves live in js/state.js (assemblyProgress), so undo/redo and saving cover them.
import * as THREE from 'three';
import { planCables, CABLE_GROUPS, endsOf, powerReady } from '../scene/cable-plan.js?v=5b4c14becb';
import { routeContext, routeOf, autoRoute, checkCable, scoreCables, waypointsOf, clampToCase, routeEnds } from '../scene/cable-route.js?v=5b4c14becb';
import { createCables } from '../scene/cables.js?v=5b4c14becb';
import { CABLE_STYLES } from '../state.js?v=5b4c14becb';
import { CONFIG } from '../config.js?v=5b4c14becb';
import { html, render } from './dom.js?v=5b4c14becb';

const STYLE_LABEL = { black: 'Stock black', white: 'White', custom: 'Custom colour', sleeved: 'Sleeved' };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'build';

/**
 * @param {HTMLElement} el container inside the hand panel
 * @param {{app, viewer, bscene, rig, fx, sound, progress, reducedMotion, setMsg: (text, level, ms) => void, onChange: () => void}} ctx
 */
export function mountCablePanel(el, { app, viewer, bscene, rig, fx, sound, progress, reducedMotion, setMsg, onChange }) {
  const cables3d = createCables({ viewer, root: bscene.root });
  let aplan = null;
  let cplan = null;
  let rctx = null;
  let active = false;
  let src = null;        // selected source port id
  let selCable = null;   // selected cable id (shows its waypoint handles)
  let drag = null;       // { id, index, pts, plane }
  let behind = false;    // "Behind the tray" view
  let lastScore = null;
  let lastActive = false;
  const routeCache = new Map();

  render(el, html`
    <div class="cab__head">
      <h3 class="label">Cables</h3>
      <p class="cab__count mono" data-c="count"></p>
    </div>
    <div class="cab__tools">
      <button class="vbtn vbtn--accent" type="button" data-c="auto">Auto-route</button>
      <label class="cab__field"><span class="label">Style</span>
        <select data-c="style">${CABLE_STYLES.map((k) => html`<option value="${k}">${STYLE_LABEL[k]}</option>`)}</select>
      </label>
      <label class="cab__field" data-c="color-wrap"><span class="label">Colour</span><input type="color" data-c="color" value="#ff5a1f"></label>
      <button class="vbtn" type="button" data-c="behind" aria-pressed="false">Behind the tray</button>
      <span class="cab__sel" data-c="sel"></span>
    </div>
    <div class="cab__body">
      <div class="cab__list" data-c="list"></div>
      <div class="cab__side">
        <div class="cab__score" data-c="score"></div>
        <div class="cab__finish" data-c="finish"></div>
      </div>
    </div>`);
  const $ = (k) => el.querySelector(`[data-c="${k}"]`);

  // ---------------------------------------------------------------- model
  const cablesNow = () => progress.cables;
  const item = (id) => cplan?.items.find((i) => i.id === id) ?? null;
  const port = (id) => cplan?.ports.get(id) ?? null;
  const available = () => (cplan?.ready ? cplan.items.filter((i) => !i.unavailable) : []);

  /** Ports in use by connected cables (multi ports never fill up). */
  function occupied(cables = cablesNow()) {
    const s = new Set();
    for (const [id, st] of Object.entries(cables)) {
      const it = item(id);
      if (!it) continue;
      const e = endsOf(it, st);
      for (const p of [e.from, e.to]) if (!port(p)?.multi) s.add(p);
    }
    return s;
  }
  // Items a plug at port P can serve: same kind and same kind of place (PSU sockets swap freely).
  function candidates(P, cables = cablesNow()) {
    const used = occupied(cables);
    return available().filter((it) => {
      if (cables[it.id] || it.fromKind !== P.kind) return false;
      const F = port(it.from);
      return it.from === P.id || (F && F.at === P.at && !used.has(P.id));
    });
  }
  function validTargets(P) {
    const used = occupied();
    const out = new Set();
    for (const it of candidates(P)) {
      if (!used.has(it.to)) out.add(it.to);
      for (const q of cplan.ports.values()) if (q.kind === it.toKind && q.at === port(it.to)?.at && !used.has(q.id)) out.add(q.id);
    }
    return out;
  }

  function routeFor(it, st) {
    const key = `${it.id}|${st?.src}|${st?.dst}|${JSON.stringify(st?.pts ?? null)}`;
    if (routeCache.has(key)) return routeCache.get(key);
    const route = routeOf(it, cplan, rctx, st);
    const e = endsOf(it, st);
    const A = port(e.from); const B = port(e.to);
    const check = checkCable(it, route, rctx, A, B);
    const autoKey = `${it.id}|${st?.src}|${st?.dst}|null`;
    let auto = check;
    if (st?.pts) auto = routeCache.get(autoKey)?.check ?? checkCable(it, autoRoute(it, cplan, rctx, st), rctx, A, B);
    const r = { route, check, auto, A, B };
    routeCache.set(key, r);
    return r;
  }
  function connectedList(cables = cablesNow()) {
    const list = [];
    for (const [id, st] of Object.entries(cables)) {
      const it = item(id);
      if (!it) continue;
      const r = routeFor(it, st);
      if (r.route) list.push({ item: it, state: st, ...r });
    }
    return list;
  }

  // ---------------------------------------------------------------- 3D
  function sync3d(list = connectedList()) {
    if (!active) { cables3d.clear(); return; }
    const shown = list.map((c) => ({ id: c.item.id, cable: c.item.cable, samples: c.check.samples, A: c.A, B: c.B }));
    if (drag) {
      const it = item(drag.id);
      const st = { ...cablesNow()[drag.id], pts: drag.pts };
      const e = routeEnds(it, cplan, st, rctx);
      const r = checkCable(it, { pts: [e.a0, e.a1, ...drag.pts, e.b1, e.b0] }, rctx, e.A, e.B);
      const k = shown.findIndex((c) => c.id === drag.id);
      if (k >= 0) shown[k] = { ...shown[k], samples: r.samples };
    }
    cables3d.sync(shown);
    cables3d.select(selCable);
    refreshMarkers();
    if (selCable && progress.cables[selCable]) {
      const c = list.find((x) => x.item.id === selCable);
      cables3d.setHandles(drag ? drag.pts : c ? waypointsOf(c.route) : [], drag ? drag.index : -1);
    } else cables3d.setHandles([]);
  }

  function refreshMarkers() {
    if (!active || progress.closed) { cables3d.setMarkers([]); return; }
    const cables = cablesNow();
    const used = occupied(cables);
    const list = [];
    const seen = new Set();
    const push = (id, state) => {
      const p = port(id);
      if (!p || seen.has(id)) return;
      seen.add(id);
      list.push({ id, p: p.p, dir: p.dir, state });
    };
    if (src) {
      push(src, 'selected');
      for (const t of validTargets(port(src))) push(t, 'valid');
    }
    for (const it of available()) {
      if (cables[it.id]) continue;
      if (!used.has(it.from) || port(it.from)?.multi) push(it.from, 'source');
    }
    for (const it of available()) if (!cables[it.id] && !used.has(it.to)) push(it.to, 'target');
    cables3d.setMarkers(list);
  }

  // ---------------------------------------------------------------- actions
  function connect(P, T) {
    const cands = candidates(P);
    const it = cands.find((c) => c.to === T.id) ?? cands.find((c) => port(c.to)?.kind === T.kind);
    if (!it) return false;
    const srcO = P.id !== it.from ? P.id : null;
    const dstO = T.id !== it.to ? T.id : null;
    progress.connect(it.id, { src: srcO, dst: dstO });
    sound.play('click');
    setMsg(`${it.name} connected to ${T.label}.`, 'ok', 2600);
    return true;
  }
  // Keyboard / checklist: connect an item on free ends (its own, or a free one of the same kind).
  function connectItem(id) {
    const it = item(id);
    if (!it || it.unavailable || cablesNow()[id] || progress.closed) return;
    const used = occupied();
    const free = (pid, kind) => {
      if (!used.has(pid) || port(pid)?.multi) return pid;
      const at = port(pid)?.at;
      return [...cplan.ports.values()].find((q) => q.kind === kind && q.at === at && !used.has(q.id))?.id ?? null;
    };
    const f = free(it.from, it.fromKind);
    const t = free(it.to, it.toKind);
    if (!f || !t) { setMsg('No free socket left for that cable.', 'warn', 4000); return; }
    progress.connect(id, { src: f !== it.from ? f : null, dst: t !== it.to ? t : null });
    sound.play('click');
    setMsg(`${it.name} connected to ${port(t).label}.`, 'ok', 2600);
  }
  function autoRouteAll() {
    if (progress.closed) return;
    const ends = {};
    for (const it of available()) ends[it.id] = { src: null, dst: null };
    selCable = null;
    src = null;
    if (progress.connectAll(ends)) {
      sound.play('click');
      setMsg('Every cable connected and routed behind the tray.', 'ok', 3500);
    } else setMsg('Every cable is already on its tidy route.', 'info', 2500);
  }
  function removeCable(id) {
    if (!id || progress.closed) return;
    const it = item(id);
    if (progress.disconnect(id)) setMsg(`${it?.name ?? 'Cable'} removed.`, 'info', 2500);
    if (selCable === id) selCable = null;
  }
  function tidyCable(id) {
    if (progress.cables[id]?.pts) progress.setRoute(id, null);
  }
  function selectCableId(id) {
    selCable = id;
    src = null;
    const it = item(id);
    if (it) setMsg(`${it.name}: drag the white handles to move the cable. Delete removes it.`, 'info');
    update();
  }

  function pickSource(P) {
    if (!candidates(P).length) {
      const conn = Object.entries(cablesNow()).find(([id, st]) => endsOf(item(id) ?? {}, st).from === P.id);
      if (conn) selectCableId(conn[0]);
      return;
    }
    src = P.id;
    selCable = null;
    const it = candidates(P)[0];
    setMsg(`${P.label}: ${it.name}. Click the glowing ${port(it.to)?.label ?? 'port'} to plug it in.`, 'info');
    update();
  }
  function pickTarget(T) {
    const P = port(src);
    if (validTargets(P).has(T.id)) {
      connect(P, T);
      src = null;
      return;
    }
    const it = candidates(P)[0];
    setMsg(`That's ${T.label}. The ${it?.name ?? 'cable'} goes to ${port(it?.to)?.label ?? 'its own socket'}.`, 'warn', 5000);
  }

  // "Show me where": the next missing connection, required first.
  function showNext() {
    const cables = cablesNow();
    const next = available().find((i) => i.required && !cables[i.id]) ?? available().find((i) => !cables[i.id]);
    if (!next) { setMsg('Every cable is connected.', 'ok', 2500); return; }
    const P = port(next.from);
    src = P.id;
    selCable = null;
    focusPorts([P.p, port(next.to).p]);
    setMsg(`Next: ${next.name}. From ${P.label} to ${port(next.to).label}.`, 'info');
    update();
  }
  function focusPorts(points) {
    const b = new THREE.Box3();
    for (const p of points) b.expandByPoint(bscene.root.localToWorld(new THREE.Vector3(...p)));
    const s = b.getBoundingSphere(new THREE.Sphere());
    rig.focus(s.center, Math.max(14, s.radius * 1.5), behind ? [0.25, 0.2, -1] : [0.3, 0.22, 1]);
  }
  function focusCase() {
    const c = bscene.modelOf('case');
    if (!c) return;
    const s = new THREE.Box3().setFromObject(c).getBoundingSphere(new THREE.Sphere());
    rig.focus(s.center, s.radius * 0.85, behind ? [0.3, 0.22, -1] : [0.32, 0.25, 1]);
  }
  function setBehind(on) {
    behind = on;
    const back = bscene.modelOf('case')?.userData.backSide;
    if (back) back.visible = !on;
    viewer.invalidateShadows();
    $('behind').setAttribute('aria-pressed', String(on));
    if (active) focusCase();
  }

  // ---------------------------------------------------------------- finish: power, close, share
  const ready = () => (cplan ? powerReady(cplan, cablesNow()) : { ok: false, missing: [] });
  function power() {
    const r = ready();
    if (!r.ok) { setMsg(`Connect first: ${r.missing.map((m) => m.name).join(', ')}.`, 'warn', 6000); return; }
    fx.togglePower();
    update();
  }
  function closeCase(close) {
    if (close && !ready().ok) return;
    if (close) { src = null; selCable = null; if (behind) setBehind(false); }
    progress.setClosed(close);
    if (close) rig.goTo('angle');
  }
  async function capture() {
    cables3d.setMarkers([]);
    cables3d.setHandles([]);
    bscene.setHelpersVisible(false);
    const blob = await viewer.capture();
    bscene.setHelpersVisible(true);
    refreshMarkers();
    return blob;
  }
  const fileName = () => `${slug(CONFIG.appName)}-${slug(app.ui.current?.name ?? 'build')}-${new Date().toISOString().slice(0, 10)}.png`;
  function download(blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName();
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function summary() {
    const b = bscene.build;
    const parts = ['cpu', 'motherboard', 'gpu', 'ram', 'storage', 'cooler', 'psu', 'case', 'fans']
      .flatMap((k) => (Array.isArray(b[k]) ? b[k] : b[k] ? [b[k]] : []).map((p) => `- ${p.name}`));
    return `My ${CONFIG.appName} build, built by hand and cabled (cable management ${lastScore?.score ?? 0}/100):\n${parts.join('\n')}`;
  }
  async function screenshot() {
    const blob = await capture();
    if (!blob) { app.toast('Could not create the screenshot.', 'error'); return; }
    download(blob);
    app.toast('Screenshot saved as PNG.');
  }
  async function share() {
    const blob = await capture();
    const text = summary();
    const file = blob ? new File([blob], fileName(), { type: 'image/png' }) : null;
    try {
      if (file && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `${CONFIG.appName} build`, text });
        return;
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
    if (blob) download(blob);
    try {
      await navigator.clipboard.writeText(text);
      app.toast('Screenshot saved and the parts list copied, ready to paste.');
    } catch {
      app.toast('Screenshot saved. Copying the parts list was blocked by the browser.', 'warn');
    }
  }

  // ---------------------------------------------------------------- DOM
  function renderDom(list) {
    const cables = cablesNow();
    const items = cplan?.ready ? cplan.items : [];
    const avail = available();
    const done = avail.filter((i) => cables[i.id]).length;
    const r = ready();
    const closed = progress.closed;
    const score = list.length ? scoreCables(list) : null;
    lastScore = score;
    $('count').textContent = cplan?.ready ? `${done}/${avail.length} connected${r.missing.length ? ` · ${r.missing.length} required left` : ' · required done'}` : '';
    const style = progress.cableStyle;
    $('style').value = style.kind;
    $('color').value = style.color;
    $('color-wrap').hidden = style.kind !== 'custom' && style.kind !== 'sleeved';
    $('auto').disabled = closed || !avail.length;
    $('behind').disabled = closed;
    $('style').disabled = false;
    const sel = selCable && cables[selCable] ? item(selCable) : null;
    render($('sel'), sel ? html`<span class="mono">${sel.name}</span>
      ${cables[selCable].pts ? html`<button class="linkbtn" type="button" data-c="tidy" data-id="${sel.id}">Tidy route</button>` : ''}
      <button class="linkbtn" type="button" data-c="remove" data-id="${sel.id}" aria-keyshortcuts="Delete">Remove</button>` : '');

    const warnBy = new Map();
    for (const w of score?.warnings ?? []) warnBy.set(w.id, [...(warnBy.get(w.id) ?? []), w.label]);
    render($('list'), html`${!cplan?.ready ? html`<p>${cplan?.reason ?? ''}</p>` : ''}
      ${CABLE_GROUPS.map((g) => {
        const its = items.filter((i) => i.group === g.id);
        if (!its.length) return '';
        return html`<section class="cab__group"><h4 class="label">${g.label}</h4><ul class="cab__items">
          ${its.map((it) => {
            const on = !!cables[it.id];
            const state = it.unavailable ? 'off' : on ? (warnBy.has(it.id) ? 'warn' : 'on') : it.required ? 'need' : 'opt';
            const to = on ? port(endsOf(it, cables[it.id]).to)?.label ?? it.target : it.target;
            return html`<li class="cab__item" data-state="${state}" data-selected="${String(selCable === it.id)}">
              <span class="cab__dot" aria-hidden="true"></span>
              <div class="cab__text">
                <p class="cab__name">${it.name} <span class="cab__to mono">→ ${to}</span></p>
                <p class="cab__meta"><span class="cab__tag">${it.unavailable ? 'Not possible' : it.required ? 'Required' : 'Recommended'}</span>${on ? ' · connected' : ''}${it.note ? ` · ${it.note}` : ''}</p>
                ${warnBy.has(it.id) ? html`<p class="cab__warn">Crosses ${warnBy.get(it.id).join(' and ')}.</p>` : ''}
              </div>
              <div class="cab__act">
                ${!it.unavailable && !on && !closed ? html`<button class="linkbtn" type="button" data-c="connect" data-id="${it.id}" data-focus-key="cc-${it.id}">Connect</button>` : ''}
                ${on && !closed ? html`<button class="linkbtn" type="button" data-c="adjust" data-id="${it.id}" data-focus-key="ca-${it.id}">Adjust</button><button class="linkbtn" type="button" data-c="remove" data-id="${it.id}" data-focus-key="cr-${it.id}">Remove</button>` : ''}
              </div>
            </li>`;
          })}</ul></section>`;
      })}
      ${cplan?.notes.length ? html`<p class="cab__notes muted">${cplan.notes.join(' ')}</p>` : ''}`);

    render($('score'), score ? html`
      <div class="cab__gauge">
        <p class="cab__num mono" aria-label="Cable management score ${score.score} out of 100"><span>${score.score}</span>/100</p>
        <p class="label">Cable management</p>
      </div>
      <div class="cab__bar" aria-hidden="true"><span style="width:${score.score}%"></span></div>
      <ul class="cab__reasons">${score.reasons.map((x) => html`<li data-level="${x.level}"><span class="mono">${Math.round(x.points)}/${x.max}</span> ${x.text}</li>`)}</ul>`
      : html`<p class="cab__empty muted">Connect a cable to see the cable-management score: hidden length, crossings, airflow and grommet use.</p>`);

    const on = fx.power !== 'off';
    render($('finish'), html`
      <div class="cab__power">
        <button class="vbtn vbtn--power" type="button" data-c="power" ${r.ok ? '' : 'disabled'} aria-pressed="${String(on)}" aria-describedby="cab-power-why">${on ? 'Power off' : 'Power on'}</button>
        <p class="hand__why mono" id="cab-power-why">${r.ok ? (on ? 'Running.' : 'Ready to power on.') : `Missing: ${r.missing.map((m) => m.name).join(', ')}`}</p>
      </div>
      <div class="cab__close">
        ${closed
          ? html`<button class="vbtn" type="button" data-c="open">Open the case</button>
                 <button class="vbtn" type="button" data-c="shot">Final screenshot</button>
                 <button class="vbtn vbtn--accent" type="button" data-c="share">Share</button>`
          : html`<button class="vbtn" type="button" data-c="close" ${r.ok ? '' : 'disabled'}>Close the case</button>`}
      </div>`);
  }

  // ---------------------------------------------------------------- update
  function update() {
    if (!active || !cplan) { cables3d.clear(); return; }
    const list = connectedList();
    // Power needs the required cables: a removed one switches the PC off.
    if (fx.power !== 'off' && !ready().ok) fx.setPower(false);
    if (selCable && !cablesNow()[selCable]) selCable = null;
    if (src && !candidates(port(src) ?? {}).length) src = null;
    bscene.setSidePanel(progress.closed, { animate: !reducedMotion });
    sync3d(list);
    renderDom(list);
    onChange?.();
  }

  // ---------------------------------------------------------------- pointer: markers, handles, cables
  const canvas = viewer.renderer.domElement;
  const stage = canvas.parentElement;
  const ndcOf = (e) => {
    const r = canvas.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  };
  let down = null;
  const raycaster = new THREE.Raycaster();
  function onDown(e) {
    if (!active || progress.closed || e.button !== 0) return;
    // Waypoint handle of the selected cable: drag it.
    if (selCable && cablesNow()[selCable]) {
      const i = cables3d.handleAt(e.clientX, e.clientY);
      if (i >= 0) {
        const c = connectedList().find((x) => x.item.id === selCable);
        const pts = waypointsOf(c.route).map((p) => [...p]);
        const w = bscene.root.localToWorld(new THREE.Vector3(...pts[i]));
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(viewer.camera.getWorldDirection(new THREE.Vector3()).negate(), w);
        drag = { id: selCable, index: i, pts, plane, pointer: e.pointerId };
        canvas.setPointerCapture(e.pointerId);
        e.stopPropagation();
        e.preventDefault();
        sync3d();
        return;
      }
    }
    const m = cables3d.markerAt(e.clientX, e.clientY);
    if (m) {
      e.stopPropagation();
      e.preventDefault();
      const P = port(m.id);
      if (m.state === 'source' || m.state === 'selected') {
        if (m.state === 'selected') { src = null; setMsg(null); update(); } else pickSource(P);
      } else if (src) pickTarget(P);
      else setMsg(`That's ${P.label}. Click a glowing plug first: on the PSU, the case's front-panel leads or a fan.`, 'info', 4500);
      return;
    }
    down = { x: e.clientX, y: e.clientY };
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.pointer) return;
    raycaster.setFromCamera(ndcOf(e), viewer.camera);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(drag.plane, hit)) return;
    const local = bscene.root.worldToLocal(hit);
    drag.pts[drag.index] = clampToCase([local.x, local.y, local.z], rctx);
    sync3d();
    e.stopPropagation();
  }
  function onUp(e) {
    if (drag && e.pointerId === drag.pointer) {
      const d = drag;
      drag = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      progress.setRoute(d.id, d.pts);
      e.stopPropagation();
      return;
    }
    if (!active || !down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 5 || progress.closed) return;
    const id = cables3d.cableAt(ndcOf(e));
    if (id) selectCableId(id);
    else if (src || selCable) { src = null; selCable = null; setMsg(null); update(); }
  }
  stage.addEventListener('pointerdown', onDown, true);
  stage.addEventListener('pointermove', onMove, true);
  stage.addEventListener('pointerup', onUp, true);

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]');
    if (!b || b.disabled) return;
    const c = b.dataset.c;
    if (c === 'auto') autoRouteAll();
    if (c === 'behind') setBehind(!behind);
    if (c === 'connect') connectItem(b.dataset.id);
    if (c === 'adjust') { selectCableId(b.dataset.id); const it = item(b.dataset.id); if (it) focusPorts([port(it.from).p, port(it.to).p]); }
    if (c === 'remove') removeCable(b.dataset.id);
    if (c === 'tidy') tidyCable(b.dataset.id);
    if (c === 'power') power();
    if (c === 'close') closeCase(true);
    if (c === 'open') closeCase(false);
    if (c === 'shot') screenshot();
    if (c === 'share') share();
  });
  el.addEventListener('change', (e) => {
    const c = e.target.dataset?.c;
    if (c === 'style') progress.setCableStyle({ kind: e.target.value });
    if (c === 'color') progress.setCableStyle({ color: e.target.value });
  });
  el.addEventListener('input', (e) => {
    if (e.target.dataset?.c === 'color') cables3d.setStyle({ ...progress.cableStyle, color: e.target.value });
  });

  return {
    /** New assembly plan (the build or its layout changed). */
    replan(nextPlan) {
      aplan = nextPlan;
      cplan = aplan?.ready ? planCables(bscene.build, aplan) : null;
      rctx = cplan?.ready ? routeContext(aplan) : null;
      routeCache.clear();
      src = null;
      selCable = null;
    },
    /** Cables that still apply to this build (for assemblyProgress.sync). */
    keepCables(cables) {
      if (!cplan?.ready) return cables;
      const out = {};
      for (const [id, st] of Object.entries(cables)) {
        const it = item(id);
        if (!it || it.unavailable) continue;
        const e = endsOf(it, st);
        if (port(e.from) && port(e.to)) out[id] = st;
      }
      return out;
    },
    /** Show the cable step (all parts in) or hide it. */
    setActive(on) {
      active = on && !!cplan?.ready;
      el.hidden = !active;
      if (!active) {
        if (behind) setBehind(false);
        drag = null;
        cables3d.clear();
        if (lastActive) bscene.setSidePanel(false, { animate: false });
        lastActive = false;
        return;
      }
      if (!lastActive) focusCase();
      lastActive = true;
      cables3d.setStyle(progress.cableStyle);
      update();
    },
    refresh() { if (active) { cables3d.setStyle(progress.cableStyle); update(); } },
    get active() { return active; },
    /** Progress for the step bar: { done, total }. */
    summary() {
      const avail = available();
      const cables = cablesNow();
      return { done: avail.filter((i) => cables[i.id]).length, total: avail.length };
    },
    canPower: () => active && ready().ok,
    hint() {
      if (!active) return '';
      if (progress.closed) return 'Case closed. Take the final screenshot, share it, or power the PC on.';
      const r = ready();
      if (!r.ok) return `Cables: click a glowing plug on the PSU (or the case's front-panel leads), then the glowing port it goes to. Auto-route connects everything. ${r.missing.length} required left.`;
      return 'Required cables are in. Power on, tidy the routes, or close the case.';
    },
    showNext,
    removeSelected() { if (selCable) removeCable(selCable); },
    escape() {
      if (drag) { drag = null; sync3d(); return true; }
      if (src || selCable) { src = null; selCable = null; setMsg(null); update(); return true; }
      return false;
    },
    get dragging() { return !!drag; },
    update3d(dt) { if (active) cables3d.update(dt); },
    // For tools/test-browser.mjs.
    test: {
      get plan() { return cplan; },
      get score() { return lastScore; },
      markerPoint(id) { const p = port(id); return p && cables3d.toScreen(p.p.map((v, i) => v + p.dir[i] * 0.6)); },
      handlePoints() {
        const c = selCable && connectedList().find((x) => x.item.id === selCable);
        return c ? waypointsOf(c.route).map((p) => cables3d.toScreen(p)) : [];
      },
      /** Waypoints of the selected cable in build space (cm). */
      waypoints() {
        const c = selCable && connectedList().find((x) => x.item.id === selCable);
        return c ? waypointsOf(c.route).map((p) => [...p]) : [];
      },
      worldToScreen: (p) => cables3d.toScreen(p),
      selectCable: selectCableId,
      autoRoute: autoRouteAll,
      connectItem,
      get count3d() { return cables3d.count; },
      get context() { return rctx; },
    },
    leave() {
      if (behind) setBehind(false);
      this.setActive(false);
    },
    dispose() {
      this.leave();
      stage.removeEventListener('pointerdown', onDown, true);
      stage.removeEventListener('pointermove', onMove, true);
      stage.removeEventListener('pointerup', onUp, true);
      cables3d.dispose();
    },
  };
}
