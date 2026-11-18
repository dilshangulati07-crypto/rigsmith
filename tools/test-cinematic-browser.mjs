#!/usr/bin/env node
// Browser scenario for the Auto-build cinematic, in headless Chrome (tools/browser-harness.mjs).
// Plays the ATX build at 1x, the mATX at 2x, the ITX and the dual-chamber at 4x from the
// "Auto-build" button: empty case fading in, every step's caption in the real order, parts
// flying in, the socket lever, cables drawing one by one, the panel closing, boot, the orbit,
// and the finished state (same parts as the viewer, every cable, panel on, PC running). On the
// ATX run: pause (time stops), Space, a timeline jump, arrow keys, skip, replay, Esc, "Open in
// Build by hand", "Edit parts", "Take screenshot". Then 5 replays with GPU and JS memory flat,
// "Save as video" (cancel, then a full recording that plays back with the overlay on it), the
// reduced-motion crossfade version, the landing "Auto-build a PC" and Auto-fill "Watch it build"
// path, and the 380 px layout. Any console error fails the run.
// Usage: node tools/test-cinematic-browser.mjs [--shots <dir>] [-v]
import { BUILDS } from './test-builds.mjs';
import {
  ok, fail, finish, sleep, page, evaluate, waitFor, viewport, reducedMotion, shot, consoleErrors, open, setBuild, BASE, HELPERS,
} from './browser-harness.mjs';

const AUTO = `
  window.__a = {
    ui: () => __t.r().auto,
    p: () => __t.r().auto.test.player,
    cap: () => __t.r().auto.test.caption,
    btn: (a) => document.querySelector('.auto [data-a="' + a + '"]'),
    start() { document.querySelector('[data-v="mode"][data-mode="auto"]').click(); },
    seg: (i) => document.querySelectorAll('.auto .tl__seg')[i],
  };`;
async function openAuto(url) {
  await open(url);
  await evaluate(AUTO);
}
async function press(k, code = k, keyCode = 0) {
  await page('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: keyCode });
  if (k === ' ') await page('Input.dispatchKeyEvent', { type: 'char', text: ' ', key: k, code });
  await page('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: keyCode });
  await sleep(60);
}
const SPACE = () => press(' ', 'Space', 32);
const ESC = () => press('Escape', 'Escape', 27);

/** Play to the end, collecting each caption seen. Returns { labels, wall }. */
async function playToEnd(timeout) {
  const labels = [];
  const t0 = Date.now();
  for (;;) {
    const s = await evaluate(`({ state: __a.p().state, cap: __a.cap(), anim: __t.r().hand.hb.animating, lever: (() => { try { return __t.lever(); } catch { return 0; } })(), exp: __t.r().viewer.renderer.toneMappingExposure / __t.r().viewer.exposure })`);
    if (labels[labels.length - 1]?.cap !== s.cap) labels.push(s);
    else Object.assign(labels[labels.length - 1], { anim: labels[labels.length - 1].anim || s.anim, lever: Math.max(labels[labels.length - 1].lever, s.lever) });
    if (s.state === 'done') break;
    if (Date.now() - t0 > timeout) throw new Error(`Timed out playing the cinematic (last: ${s.cap})`);
    await sleep(120);
  }
  return { labels, wall: (Date.now() - t0) / 1000 };
}

async function finishedChecks(id) {
  const st = await evaluate(`({
    shown: __t.visiblePieces(), placed: __t.placedPieces(), cables: __a.p().cablesShown, want: __a.p().cableCount,
    panel: __t.r().scene.sidePanel, power: __t.r().fx.power, exp: __t.r().viewer.renderer.toneMappingExposure / __t.r().viewer.exposure,
    done: !document.querySelector('.auto__done').hidden,
    btns: [...document.querySelectorAll('.auto__done button')].map((b) => b.textContent.trim()),
    tl: [...document.querySelectorAll('.auto .tl__seg')].every((b) => b.dataset.state === 'done'),
  })`);
  ok(st.shown === st.placed && st.placed > 5, `${id}: every part in, same as the viewer (${st.shown}/${st.placed})`);
  ok(st.cables === st.want && st.want > 3, `${id}: every cable drawn (${st.cables}/${st.want})`);
  ok(st.panel && ['on', 'booting'].includes(st.power) && Math.abs(st.exp - 1) < 1e-9, `${id}: glass panel closed and the PC running (${st.power})`);
  ok(st.done && st.btns.join('|') === 'Open in Build by hand|Edit parts|Take screenshot', `${id}: finished with ${st.btns.join(', ')}`);
  ok(st.tl, `${id}: every timeline step marked done`);
}

try {
  // SwiftShader is slow: the full-length 1x run and the replay loop use low quality (no
  // shadows or bloom); the 2x and 4x runs and the recording use high quality.
  await viewport(1280, 900);
  await openAuto('/builder.html?debug3d&quality=low');
  await evaluate('localStorage.clear()');
  await openAuto('/builder.html?debug3d&quality=low');

  const SPEED = [1, 2, 4, 4];
  for (const [n, { id, name, build }] of BUILDS.entries()) {
    const speed = SPEED[n];
    console.log(`${name} at ${speed}x`);
    if (n === 1) await openAuto('/builder.html?debug3d');
    await setBuild(build);
    await evaluate('__a.start()');
    await waitFor('__a.ui()?.active && __a.p().state === "playing" && __a.cap().startsWith("Step 1/")', 'Auto-build to start');
    if (speed !== 1) await evaluate(`__a.btn('speed') && document.querySelector('.auto [data-a="speed"][data-k="${speed}"]').click()`);
    const first = await evaluate(`({ cap: __a.cap(), mode: document.getElementById('view-3d').dataset.mode, tools: getComputedStyle(document.querySelector('.viewer__tools--fx')).display, exp: __t.r().viewer.renderer.toneMappingExposure / __t.r().viewer.exposure, shown: __t.visiblePieces(), panel: __t.r().scene.sidePanel, steps: __a.p().steps.length, ts: __a.p().timeScale })`);
    ok(first.mode === 'auto' && first.tools === 'none', `${id}: Auto-build mode with the viewer tools hidden`);
    ok(new RegExp(`^Step 1/${first.steps} Empty case — ${build.case.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(first.cap), `${id}: caption "${first.cap}"`);
    ok(first.exp < 1 && first.shown === 0 && !first.panel, `${id}: empty case fading in with the side panel off (exposure ${first.exp.toFixed(2)})`);
    ok(first.ts === speed, `${id}: playing at ${speed}x`);
    if (n === 0) await shot(`auto-${id}-1-intro`);

    if (n === 0) {
      // Pause stops time; Space resumes.
      await waitFor('/Installing power supply/.test(__a.cap())', 'the PSU step', 60000);
      await evaluate(`__a.btn('play').click()`);
      const p0 = await evaluate('__a.p().progress');
      await sleep(700);
      const p1 = await evaluate('__a.p().progress');
      ok(await evaluate('__a.p().state') === 'paused' && p1 === p0 && await evaluate('__a.p().timeScale') === 0, `pause holds the sequence (${(p0 * 100).toFixed(1)}%)`);
      ok(await evaluate(`__a.btn('play').textContent`) === 'Play', 'the button says Play while paused');
      await evaluate('document.activeElement?.blur()');
      await SPACE();
      ok(await evaluate('__a.p().state') === 'playing', 'Space resumes');
      await shot(`auto-${id}-2-psu`);

      // Jump to the graphics card step from the timeline.
      const gpuStep = await evaluate(`__a.p().steps.findIndex((s) => s.stage === 'gpu')`);
      await evaluate(`__a.seg(${gpuStep}).click()`);
      const j = await evaluate(`({ cap: __a.cap(), gpuIn: __t.r().hand.hb && __t.shown(__t.r().scene.pieceObject(__a.p().steps[${gpuStep}].pieces[0])), board: !!__t.board() && __t.board().visible, cables: __a.p().cablesShown, cur: __a.seg(${gpuStep}).dataset.state })`);
      ok(/^Step \d+\/\d+ Installing graphics card — /.test(j.cap) && !j.gpuIn && j.board && j.cables === 0 && j.cur === 'current', `timeline jump to the graphics card: "${j.cap}"`);
      await waitFor(`__t.shown(__t.r().scene.pieceObject(__a.p().steps[${gpuStep}].pieces[0]))`, 'the card seated', 30000);
      ok(true, 'the card flies in and seats after the jump');
      const before = await evaluate('__a.p().index');
      await press('ArrowLeft', 'ArrowLeft', 37);
      ok(await evaluate('__a.p().index') === before - 1, `← goes back a step ("${await evaluate('__a.cap()')}")`);
      await press('End', 'End', 35);
      await waitFor('__a.p().state === "done"', 'skip to end');
      await finishedChecks(`${id} (skip)`);
      await press('Home', 'Home', 36);
      await sleep(100);
      ok(await evaluate('__a.p().index') === 0 && await evaluate('__t.visiblePieces()') === 0 && await evaluate('__a.p().cablesShown') === 0, 'Home replays from the empty case');
    }

    const total = await evaluate('__a.p().total');
    const run = await playToEnd(Math.max(120000, (total / speed) * 12000));
    const caps = run.labels.map((l) => l.cap);
    const order = ['Fitting standoffs and I/O shield', 'Installing power supply', 'Installing motherboard', 'Installing processor', 'Installing memory', 'Installing graphics card', 'Connecting 24-pin ATX power — ', 'Closing the glass side panel', 'Power on', 'Finished'];
    const at = order.map((o) => caps.findIndex((c) => c.includes(o)));
    ok(at.every((v, i) => v >= 0 && (!i || v > at[i - 1])), `${id}: captions in the real order (${caps.length} seen${at.includes(-1) ? `, missing "${order[at.indexOf(-1)]}"` : ''})`);
    const cooler = caps.find((c) => /Installing (CPU cooler|pump block) — /.test(c));
    ok(!!cooler && cooler.includes(build.cooler.name), `${id}: "${cooler?.replace(/^Step \S+ /, '')}"`);
    ok(run.labels.some((l) => /Installing processor/.test(l.cap) && l.lever > 1.2), `${id}: the socket lever opens for the CPU`);
    ok(run.labels.filter((l) => /Installing|Fitting|Mounting/.test(l.cap)).every((l) => l.anim), `${id}: every part flies in from the tray`);
    const cableCaps = caps.filter((c) => /Connecting .+ — /.test(c)).length;
    ok(cableCaps === await evaluate('__a.p().cableCount'), `${id}: cables draw one by one, each with its own caption (${cableCaps})`);
    console.log(`  ${total.toFixed(0)} s of sequence at ${speed}x took ${run.wall.toFixed(0)} s of wall time here (SwiftShader, ${await evaluate('__t.r().viewer.quality')} quality)`);
    await finishedChecks(id);
    if (n === 0) await shot(`auto-${id}-3-done`);
    if (n === 3) await shot(`auto-${id}-3-done`);

    if (n === 0) {
      // Finished: screenshot, Open in Build by hand, Edit parts.
      await evaluate(`document.querySelector('.auto [data-a="shot"]').click()`);
      await waitFor(`/Screenshot saved/.test(document.getElementById('toast').textContent)`, 'screenshot toast', 8000).catch(() => {});
      ok(/Screenshot saved/.test(await evaluate(`document.getElementById('toast').textContent`)), 'Take screenshot saves a PNG');
      const want = await evaluate('({ pieces: __t.placedPieces(), cables: __a.p().cableCount })');
      await evaluate(`document.querySelector('.auto [data-a="hand"]').click()`);
      await waitFor('__t.r().hand.active && __t.idle()', 'Build by hand');
      const h = await evaluate(`({ installed: __t.installed().length, total: __t.t().plan.pieces.size, cables: Object.keys(__t.cables()).length, closed: __t.saved().closed, shown3d: __t.c().count3d, auto: __a.ui().active })`);
      ok(!h.auto && h.installed === h.total && h.cables === want.cables && h.closed && h.shown3d === want.cables, `Open in Build by hand: ${h.installed}/${h.total} parts, ${h.cables} cables, case closed`);
      await evaluate('__t.t().undo()');
      await waitFor('__t.idle()', 'undo');
      ok((await evaluate('__t.installed()')).length === 0, '... as one step that Undo takes back');
      await evaluate('__t.r().setMode("viewer")');
      await evaluate('__a.start()');
      await waitFor('__a.ui()?.active', 'Auto-build again');
      await evaluate(`__a.btn('skip').click()`);
      await evaluate(`document.querySelector('.auto [data-a="edit"]').click()`);
      ok(!(await evaluate('__a.ui().active')) && await evaluate(`document.getElementById('col-parts').dataset.view`) === 'parts', 'Edit parts leaves Auto-build for the catalogue');
      await evaluate(`document.querySelector('[data-view="3d"]').click()`);
      await evaluate('__a.start()');
      await waitFor('__a.ui()?.active', 'Auto-build again');
      await evaluate('document.activeElement?.blur()');
      await ESC();
      ok(!(await evaluate('__a.ui().active')) && await evaluate(`document.getElementById('view-3d').dataset.mode`) === 'viewer' && await evaluate('__t.visiblePieces() === __t.placedPieces()'), 'Esc exits to the viewer with the whole build');
      continue;
    }
    await ESC();
  }

  // ---- memory: 5 replays
  console.log('Memory across 5 replays');
  await openAuto('/builder.html?debug3d&quality=low');
  await setBuild(BUILDS[2].build);
  await evaluate('__a.start()');
  await waitFor('__a.ui()?.active', 'Auto-build');
  await evaluate(`document.querySelector('.auto [data-a="speed"][data-k="4"]').click()`);
  await evaluate(`import('three').then((T) => { window.__T = T; })`);
  async function liveCount(expr) {
    const { result } = await page('Runtime.evaluate', { expression: expr });
    const q = await page('Runtime.queryObjects', { prototypeObjectId: result.objectId, objectGroup: 'leak' });
    const r = await page('Runtime.callFunctionOn', { objectId: q.objects.objectId, functionDeclaration: 'function () { return this.length; }', returnByValue: true });
    await page('Runtime.releaseObjectGroup', { objectGroup: 'leak' });
    return r.result.value;
  }
  const LIVE = ['__T.Object3D', '__T.Material', '__T.BufferGeometry', '__T.Texture', 'Array', 'Object'];
  const samples = [];
  for (let round = 0; round < 5; round++) {
    await evaluate(`__a.btn('replay').click()`);
    await playToEnd(240000);
    await page('HeapProfiler.collectGarbage');
    await sleep(200);
    await page('HeapProfiler.collectGarbage');
    const heap = (await page('Runtime.getHeapUsage')).usedSize;
    const live = {};
    for (const k of LIVE) live[k.replace('__T.', '')] = await liveCount(`${k}.prototype`);
    samples.push({ ...(await evaluate('__t.mem()')), heapMB: Math.round(heap / 1e5) / 10, live });
  }
  console.log(`  ${samples.map((s) => `geo ${s.geometries} tex ${s.textures} prog ${s.programs} heap ${s.heapMB} MB obj3d ${s.live.Object3D}`).join('\n  ')}`);
  const [, a, , , e] = samples;
  ok(a.geometries === e.geometries && a.textures === e.textures, `GPU geometries and textures flat across replays (${e.geometries}, ${e.textures})`);
  ok(a.programs === e.programs, 'shader programs flat across replays');
  ok(e.heapMB - a.heapMB < 1.5, `JS heap flat across replays (+${(e.heapMB - a.heapMB).toFixed(1)} MB)`);
  const grew = Object.keys(e.live).filter((k) => e.live[k] > a.live[k] && !(k === 'Array' || k === 'Object') || e.live[k] > a.live[k] * 1.02 + 50);
  ok(!grew.length, `live object counts flat across replays${grew.length ? `: ${grew.map((k) => `${k} ${a.live[k]} -> ${e.live[k]}`).join(', ')}` : ` (${e.live.Object3D} Object3D, ${e.live.BufferGeometry} geometries)`}`);

  // ---- Save as video
  console.log('Save as video');
  await ESC();
  await openAuto('/builder.html?debug3d');
  await setBuild(BUILDS[2].build);
  await evaluate('__a.start()');
  await waitFor('__a.ui()?.active', 'Auto-build');
  await evaluate(`document.querySelector('.auto [data-a="speed"][data-k="4"]').click()`);
  const fmt = await evaluate('__a.ui().test.format');
  ok(!!fmt, `this browser records ${fmt?.mime}`);
  if (fmt) {
    await evaluate(`__a.btn('record').click()`);
    await waitFor('__a.ui().test.recording', 'recording to start');
    ok(await evaluate('__a.p().index') <= 1 && !(await evaluate(`__a.btn('play').disabled === false`)), 'recording starts from the top with the playback controls locked');
    await sleep(500);
    await evaluate(`__a.btn('cancel').click()`);
    ok(!(await evaluate('__a.ui().test.recording')) && !(await evaluate('__a.ui().test.video')), 'Cancel recording stops it, no video');
    await evaluate(`__a.btn('record').click()`);
    await waitFor('__a.ui().test.recording', 'recording');
    // The first chunk can take a while under SwiftShader; wait for it rather than a fixed time.
    await waitFor(`/MB$/.test(document.querySelector('.auto [data-a="rectext"]')?.textContent ?? '')`, 'recording progress', 10000).catch(() => {});
    const prog = await evaluate(`document.querySelector('.auto [data-a="rectext"]')?.textContent ?? ''`);
    ok(/^Recording · \d+% · 0:\d\d · \d+\.\d MB$/.test(prog) && await evaluate(`!document.querySelector('.auto-ov__rec').hidden`), `recording progress: "${prog}"`);
    await waitFor('!!__a.ui().test.video', 'the finished video', 400000);
    const v = await evaluate('__a.ui().test.video');
    const link = await evaluate(`(() => { const a = document.querySelector('.auto [data-a="download"]'); return a && { href: a.href, file: a.download, text: a.textContent }; })()`);
    ok(!!link && link.href === v.url && new RegExp(`^rigsmith-.+-auto-build-\\d{4}-\\d\\d-\\d\\d\\.${v.ext}$`).test(link.file), `Download video: ${link?.file} (${(v.size / 1e6).toFixed(1)} MB, ${v.w}×${v.h})`);
    const play = await evaluate(`new Promise((resolve) => {
      const vid = document.createElement('video');
      vid.muted = true; vid.playsInline = true; vid.src = ${JSON.stringify(v.url)};
      const done = (r) => { resolve(r); };
      vid.onerror = () => done({ error: vid.error?.message || 'error' });
      vid.onloadeddata = async () => {
        try {
          await vid.play();
          await new Promise((r) => setTimeout(r, 700));
          vid.pause();
          // The overlay: the wordmark's bright pixels in the top-left corner of the frame.
          const c = document.createElement('canvas'); c.width = vid.videoWidth; c.height = vid.videoHeight;
          const g = c.getContext('2d'); g.drawImage(vid, 0, 0);
          const s = vid.videoHeight / 720;
          const d = g.getImageData(Math.round(20 * s), Math.round(20 * s), Math.round(150 * s), Math.round(30 * s)).data;
          let bright = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 540) bright++;
          done({ w: vid.videoWidth, h: vid.videoHeight, t: vid.currentTime, bright });
        } catch (err) { done({ error: String(err) }); }
      };
      setTimeout(() => done({ error: 'timeout' }), 15000);
    })`);
    ok(!play.error && play.w > 0 && play.t > 0.2, `the video plays back (${play.error ?? `${play.w}×${play.h}, ${play.t.toFixed(2)} s in`})`);
    ok(play.bright > 20, `the wordmark overlay is in the video (${play.bright} bright pixels)`);
    await evaluate(`__a.btn('discard').click()`);
    ok(!(await evaluate('__a.ui().test.video')), 'Discard drops the video');
  }
  await ESC();

  // ---- reduced motion: the short crossfade version
  console.log('Reduced motion');
  await reducedMotion(true);
  await openAuto('/builder.html?debug3d&quality=low');
  await setBuild(BUILDS[1].build);
  await evaluate('__a.start()');
  await waitFor('__a.ui()?.active', 'Auto-build');
  let faded = 0;
  let flew = false;
  const t0 = Date.now();
  while (await evaluate('__a.p().state') !== 'done' && Date.now() - t0 < 240000) {
    const s = await evaluate(`({ o: Number(document.querySelector('.auto-ov__fade').style.opacity || 0), anim: __t.r().hand.hb.animating })`);
    if (s.o > 0.05) faded++;
    flew ||= s.anim;
    await sleep(80);
  }
  const red = await evaluate('({ total: __a.p().total, state: __a.p().state, note: document.querySelector(".auto__note").textContent })');
  ok(red.state === 'done' && red.total < 30, `the crossfade version plays through (${red.total.toFixed(0)} s at 1x${red.state === 'done' ? '' : `, stuck at "${await evaluate('__a.cap()')}"`})`);
  ok(faded > 3 && !flew, `steps crossfade in, nothing flies (${faded} fading samples)`);
  ok(/Reduced motion is on/.test(red.note), 'says reduced motion is on');
  await finishedChecks('reduced');
  await ESC();
  await reducedMotion(false);

  // ---- landing page "Auto-build a PC" -> Auto-fill -> "Watch it build"
  console.log('Landing page and Auto-fill');
  await page('Page.navigate', { url: (await evaluate('location.origin')) + '/index.html' });
  await waitFor('document.readyState === "complete"', 'landing');
  const href = await evaluate(`[...document.querySelectorAll('a')].find((a) => a.textContent.trim() === 'Auto-build a PC')?.getAttribute('href')`);
  ok(href === 'builder.html?mode=auto', `landing "Auto-build a PC" goes to ${href}`);
  await openAuto('/builder.html?mode=auto&debug3d');
  await waitFor(`document.getElementById('autofill-dialog').open`, 'Auto-fill dialog');
  ok(!/mode=auto/.test(await evaluate('location.search')), 'the dialog opens and the URL drops mode=auto (a reload will not reopen it)');
  await evaluate(`document.querySelector('#autofill-dialog form').requestSubmit()`);
  await waitFor(`!!document.querySelector('#autofill-dialog [data-action="watch"]')`, 'Auto-fill result', 20000);
  ok(await evaluate(`document.activeElement?.dataset.action === 'watch' && document.querySelector('[data-action="watch"]').classList.contains('btn--primary')`), '"Watch it build" leads the result');
  await evaluate(`document.querySelector('#autofill-dialog [data-action="watch"]').click()`);
  await waitFor('__a.ui()?.active && __a.p().state === "playing"', 'Watch it build', 30000);
  ok(await evaluate(`!!__t.r().app.store.build.cpu && __t.r().scene.build.cpu?.id === __t.r().app.store.build.cpu.id`), 'Watch it build applies the Auto-fill build and plays it');
  await shot('auto-autofill');
  await ESC();
  await evaluate(`document.querySelector('[data-cmd="autofill"]').click()`);
  await evaluate(`document.querySelector('#autofill-dialog form').requestSubmit()`);
  await waitFor(`!!document.querySelector('#autofill-dialog [data-action="watch"]')`, 'Auto-fill result', 20000);
  ok(await evaluate(`document.activeElement?.dataset.action === 'apply' && !!document.querySelector('[data-action="watch"]')`), 'from the builder: "Use this build" leads, "Watch it build" is offered');
  await evaluate(`document.getElementById('autofill-dialog').close()`);

  // ---- 380 px
  console.log('380 px wide');
  await viewport(380, 820, true);
  // On a phone the 3D view loads when its tab opens.
  await page('Page.navigate', { url: `${BASE}/builder.html?debug3d&quality=low` });
  await waitFor(`document.readyState === "complete" && !!document.querySelector('[data-tab="3d"]')`, 'the builder');
  await sleep(300);
  await evaluate(`document.querySelector('.builder__tabs [data-tab="3d"]').click()`);
  await waitFor('!!window.rigsmith3d', 'the 3D view');
  await evaluate(HELPERS);
  await evaluate(AUTO);
  await waitFor('!!__t.r().scene.build?.case && !__t.r().scene.busy', 'build');
  await evaluate('__a.start()');
  await waitFor('__a.ui()?.active', 'Auto-build on a phone');
  await sleep(500);
  const wide = await evaluate(`[...document.querySelectorAll('.auto, .auto *, .auto-ov, .auto-ov *, .vgroup--mode')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).map((e) => e.className || e.tagName).slice(0, 4)`);
  ok(await evaluate('document.documentElement.scrollWidth') <= 380 && !wide.length, `Auto-build fits at 380 px${wide.length ? `: ${wide.join(', ')}` : ''}`);
  await shot('auto-380');
  await evaluate(`__a.btn('skip').click()`);
  await sleep(300);
  const wide2 = await evaluate(`[...document.querySelectorAll('.auto *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).length`);
  ok(!wide2, 'the finished state fits at 380 px');
  await shot('auto-380-done');
  await viewport(1280, 900);

  ok(consoleErrors.length === 0, `no console errors${consoleErrors.length ? `:\n    ${consoleErrors.slice(0, 8).join('\n    ')}` : ''}`);
} catch (err) {
  fail(err);
}
await finish();
