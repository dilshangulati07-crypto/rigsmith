#!/usr/bin/env node
// Browser scenario for the builder's 3D view and "Build by hand", in headless Chrome
// (tools/browser-harness.mjs).
// Serves the repo, then for an ATX, an mATX, an ITX and a dual-chamber build: enters Build
// by hand, checks the empty case, tray thumbnails and order gates, drags parts in with real
// pointer events (wrong order, wrong slots, right slots), places the rest, undo/redo with the
// keyboard, reload, reset. Then the cable step: the checklist, Power on gated with what is
// missing, a cable plugged in with real clicks (and a wrong port refused), Auto-route and its
// score, a waypoint dragged over the graphics card (warning, then Ctrl+Z), Power on, Close
// the case, reload. Then cycles builds, auto-routes and resets to check GPU and JS memory
// stay flat, and checks the 380 px layout. Any console error fails the run.
// Usage: node tools/test-browser.mjs [--shots <dir>] [-v]     CHROME=<path> picks the browser.
import { BUILDS } from './test-builds.mjs';
import {
  ok, fail, finish, sleep, page, evaluate, waitFor, viewport, reducedMotion, shot, consoleErrors,
  open, setBuild, drag, key, CTRL, click,
} from './browser-harness.mjs';

async function dragGroup(key, { decoy = null } = {}) {
  const from = await evaluate(`__t.tray(${JSON.stringify(key)})`);
  const to = await evaluate(`__t.t().screenPoint(${JSON.stringify(key)}, { decoy: ${decoy} })`);
  ok(await evaluate(`__t.inView(${JSON.stringify(from)}) && __t.inView(${JSON.stringify(to)})`), `${key}: tray item and ${decoy === null ? 'target' : 'wrong slot'} both on screen`);
  await drag(from, to);
}
// The cable step for one fully installed build (n = 0 also checks clicks, drags and reloads).
async function cableStep(n, id) {
  const items = await evaluate('__t.c().plan.items.filter((i) => !i.unavailable).map((i) => ({ id: i.id, from: i.from, to: i.to, required: i.required }))');
  ok(await evaluate(`document.querySelectorAll('.cab__item').length`) === await evaluate('__t.c().plan.items.length'), `checklist lists every connection (${items.length})`);
  const names = await evaluate(`[...document.querySelectorAll('.cab__name')].map((e) => e.textContent)`);
  ok(names.some((t) => /24-pin ATX power → (EATXPWR|ATX_PWR1|ATXPWR1)/.test(t)) && names.some((t) => /CPU 8-pin \(EPS12V\)/.test(t)), `connectors by their real names ("${names[0]}")`);

  // O (power) with cables missing: nothing happens but a message.
  await key('o');
  ok(await evaluate('__t.r().fx.power') === 'off', 'O does not power on with cables missing');

  if (n === 0) {
    // Plug the 24-pin in with real clicks: PSU socket, a wrong port (refused), the right port.
    const atx = items.find((i) => i.id === 'atx24');
    await evaluate(`document.querySelector('.viewer canvas').scrollIntoView({ block: 'center' })`);
    await evaluate(`document.querySelector('[data-h="where"]').click()`);
    await waitFor('__t.idle()', 'camera on the next cable');
    const from = await evaluate(`__t.marker(${JSON.stringify(atx.from)})`);
    ok(await evaluate(`__t.onCanvas(${JSON.stringify(from)})`) && /^Next: 24-pin ATX power/.test(await evaluate('__t.t().message')), '"Show me where" frames and picks the 24-pin plug');
    await click(from);
    ok(!/^Next/.test(await evaluate('__t.t().message')), 'clicking the picked plug again lets go of it');
    await click(from);
    ok(/24-pin/.test(await evaluate('__t.t().message')), `clicking the PSU socket picks the cable: "${await evaluate('__t.t().message')}"`);
    // A port for another cable, on screen and away from the right one.
    const wrong = await evaluate(`(() => {
      const right = __t.marker(${JSON.stringify(atx.to)});
      for (const i of __t.c().plan.items) {
        if (i.id === 'atx24' || i.to === ${JSON.stringify(atx.to)}) continue;
        const p = __t.marker(i.to);
        if (__t.onCanvas(p) && Math.hypot(p.x - right.x, p.y - right.y) > 40) return p;
      }
      return null;
    })()`);
    ok(!!wrong, 'another port is on screen to try');
    if (wrong) {
      await click(wrong);
      const msg = await evaluate('__t.t().message');
      ok(/^That's .+\. The 24-pin ATX power goes to/.test(msg) && !(await evaluate('__t.cables()')).atx24, `a wrong port is refused: "${msg}"`);
    }
    const to = await evaluate(`__t.marker(${JSON.stringify(atx.to)})`);
    ok(await evaluate(`__t.onCanvas(${JSON.stringify(to)})`), 'the motherboard socket glows in the 3D view');
    await click(to);
    const said = await evaluate('__t.t().message');
    await waitFor('__t.c().count3d === 1', 'the 24-pin cable in 3D', 5000).catch(() => {});
    ok(!!(await evaluate('__t.cables()')).atx24 && await evaluate('__t.c().count3d') === 1, `clicking the motherboard socket connects the 24-pin: "${said}"`);
    await key('z', CTRL);
    ok(!(await evaluate('__t.cables()')).atx24 && await evaluate('__t.c().count3d') === 0, 'Ctrl+Z unplugs it');
    await key('y', CTRL);
    ok(!!(await evaluate('__t.cables()')).atx24, 'Ctrl+Y plugs it back in');
  }

  // Auto-route: everything connected on tidy routes, with a score and its reasons.
  await evaluate(`document.querySelector('[data-c="auto"]').click()`);
  await waitFor('__t.idle()', 'auto-route');
  const saved = await evaluate('__t.cables()');
  ok(items.every((i) => saved[i.id] && saved[i.id].pts === null) && await evaluate('__t.c().count3d') === items.length, `Auto-route connects all ${items.length} cables`);
  const score = Number(await evaluate(`__t.cabText('.cab__num span')`));
  ok(score >= 90 && await evaluate(`document.querySelectorAll('.cab__reasons li').length`) === 4, `cable management ${score}/100 with its reasons`);
  ok(!(await evaluate(`document.querySelectorAll('.cab__warn').length`)), 'no crossing warnings on tidy routes');
  ok(!(await evaluate('__t.powerBtn().disabled')), 'Power on is enabled with every required cable');
  if (n === 0) await shot(`${id}-4-cables`);
  if (n !== 0) return;

  // Drag a waypoint onto the graphics card (front camera, so the drag plane cuts the card).
  const gpu = await evaluate(`__t.c().context.obstacles.find((o) => o.kind === 'gpu')?.box`);
  let picked = null;
  for (const c of ['eps:0', 'fpanel', 'atx24', 'usb3', 'audio']) {
    if (!saved[c]) continue;
    await evaluate(`__t.c().selectCable(${JSON.stringify(c)})`);
    const wps = await evaluate('__t.c().waypoints()');
    const k = wps.findIndex((p) => p[0] > gpu.min[0] + 2 && p[0] < gpu.max[0] - 2);
    if (k >= 0) { picked = { c, k, p: wps[k] }; break; }
  }
  ok(!!picked, `a cable with a waypoint to drag${picked ? ` (${picked.c})` : ''}`);
  if (picked) {
    await evaluate(`__t.r().rig.goTo('front', { animate: false })`);
    await evaluate('__t.frames(2)');
    const handle = (await evaluate('__t.c().handlePoints()'))[picked.k];
    const target = await evaluate(`__t.c().worldToScreen([${picked.p[0]}, ${(gpu.min[1] + gpu.max[1]) / 2}, ${(gpu.min[2] + gpu.max[2]) / 2}])`);
    ok(await evaluate(`__t.onCanvas(${JSON.stringify(handle)}) && __t.onCanvas(${JSON.stringify(target)})`), 'the handle and the card are both in the 3D view');
    await drag(handle, target);
    const warn = await evaluate(`__t.cabText('.cab__warn')`);
    ok(/Crosses the graphics card's fans/.test(warn) && !!(await evaluate('__t.cables()'))[picked.c].pts, `dragging a waypoint over the card warns: "${warn}"`);
    const worse = Number(await evaluate(`__t.cabText('.cab__num span')`));
    ok(worse < score, `... and lowers the score (${score} -> ${worse})`);
    await key('z', CTRL);
    ok(!(await evaluate(`document.querySelectorAll('.cab__warn').length`)) && (await evaluate('__t.cables()'))[picked.c].pts === null, 'Ctrl+Z puts the cable back on its tidy route');
  }

  // Power on runs the boot sequence; unplugging a required cable switches it off.
  await evaluate('__t.powerBtn().click()');
  ok(['booting', 'on'].includes(await evaluate('__t.r().fx.power')), `Power on boots the PC (${await evaluate('__t.r().fx.power')})`);
  await evaluate(`document.querySelector('[data-c="remove"][data-id="atx24"]').click()`);
  ok(await evaluate('__t.r().fx.power') === 'off' && await evaluate('__t.powerBtn().disabled'), 'unplugging the 24-pin powers it off');
  await key('z', CTRL);
  await evaluate('__t.powerBtn().click()');

  // Close the case: side panel on, then final screenshot and share.
  await evaluate(`document.querySelector('[data-c="close"]').click()`);
  await waitFor('__t.idle()', 'close');
  ok(await evaluate('__t.r().scene.sidePanel') && await evaluate('__t.saved().closed') === true, 'Close the case puts the side panel on');
  ok(await evaluate(`!!document.querySelector('[data-c="shot"]') && !!document.querySelector('[data-c="share"]') && !!document.querySelector('[data-c="open"]')`), 'Final screenshot, Share and Open the case are offered');
  await shot(`${id}-5-closed`);

  // Cable style is saved.
  await evaluate(`(() => { const s = document.querySelector('[data-c="style"]'); s.value = 'sleeved'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  ok(await evaluate('__t.saved().style?.kind') === 'sleeved', 'cable style changes and is saved');

  // Reload: cables, style and the closed case come back.
  await open();
  await waitFor('__t.r().hand.active && __t.idle() && __t.c().count3d > 0', 'cables after reload');
  ok(await evaluate('__t.c().count3d') === items.length && await evaluate('__t.r().scene.sidePanel') && await evaluate(`document.querySelector('[data-c="style"]').value`) === 'sleeved', 'a reload restores every cable, the style and the closed case');
  await evaluate(`document.querySelector('[data-c="open"]').click()`);
  ok(!(await evaluate('__t.saved().closed')), 'Open the case');
  await evaluate(`(() => { const s = document.querySelector('[data-c="style"]'); s.value = 'black'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
}

// The cable step at 380 px: checklist, score and Power on fit without sideways scrolling.
async function cablesAt380() {
  for (const g of await evaluate('__t.groups()')) {
    for (let i = 0; i < g.n; i++) { await evaluate(`__t.t().place(${JSON.stringify(g.key)})`); await waitFor('__t.idle()', 'place'); }
  }
  await evaluate(`document.querySelector('[data-c="auto"]').click()`);
  await waitFor('__t.c().count3d > 0 && __t.idle()', 'cables at 380 px');
  await evaluate(`document.querySelector('.cab').scrollIntoView()`);
  await sleep(200);
  const wide = await evaluate(`[...document.querySelectorAll('.cab, .cab *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).map((e) => e.className || e.tagName).slice(0, 4)`);
  ok(await evaluate('document.documentElement.scrollWidth') <= 380 && !wide.length, `cable step fits at 380 px${wide.length ? `: ${wide.join(', ')}` : ''}`);
  await shot('380-cables');
  await evaluate('__t.t().reset()');
  await evaluate('window.scrollTo(0, 0)');
  await waitFor('__t.idle()', 'reset');
}
// ---------------------------------------------------------------- scenario
try {
  await viewport(1280, 900);
  await open();
  await evaluate('localStorage.clear()');
  await open();
  ok(consoleErrors.length === 0, 'builder loads without console errors');

  for (const [n, { id, name, build }] of BUILDS.entries()) {
    console.log(`${name}`);
    await setBuild(build);
    if (n === 0) await evaluate('__t.r().setMode("hand")');
    await waitFor('__t.r().hand.active && __t.t().plan?.ready', 'build mode');
    await waitFor('__t.idle()', 'idle');
    const groups = await evaluate('__t.groups()');
    const total = groups.reduce((a, g) => a + g.n, 0);
    const models = total - 1; // the standoffs and I/O shield are part of the case and board models

    // Empty case: no parts showing, tray complete with thumbnails, later items locked with reasons.
    ok(await evaluate('__t.visiblePieces()') === 0, 'starts with an empty case');
    await waitFor(`document.querySelectorAll('.tray__thumb img').length === ${groups.length}`, 'tray thumbnails', 15000).catch(() => {});
    ok(await evaluate(`document.querySelectorAll('.tray__thumb img').length`) === groups.length, `every tray item has a thumbnail (${groups.length})`);
    const locked = await evaluate(`[...document.querySelectorAll('.tray__item[data-state="locked"] .tray__why')].map((e) => e.textContent)`);
    ok(locked.length === groups.length - 1 && locked.every((t) => /^Install the .+ first\.$|^Mount the radiator first/.test(t)), `locked items say why (${locked[0]})`);
    if (n === 0) await shot(`${id}-1-empty`);

    // "Show me where" for the first step: hint ghosts appear, nothing is installed.
    await evaluate(`document.querySelector('[data-h="where"]').click()`);
    await sleep(300);
    ok((await evaluate('__t.installed()')).length === 0, '"Show me where" only shows the spot');

    // Wrong order: drag the graphics card in first.
    const gpu = groups.find((g) => g.stage === 'gpu');
    const from = await evaluate(`__t.tray(${JSON.stringify(gpu.key)})`);
    await drag(from, { x: from.x, y: from.y - 260 });
    ok((await evaluate('__t.installed()')).length === 0 && /first/.test(await evaluate('__t.t().message')), `GPU first is refused: "${await evaluate('__t.t().message')}"`);

    ok(await evaluate('__t.standoffs()') === 0 && !(await evaluate('__t.shield()')), 'no standoffs or I/O shield before the first step');

    // Real drags for prep (and later RAM); keyboard Place for the rest.
    for (const g of groups) {
      if (g.stage === 'cpu') ok(await waitFor('__t.lever() > 1.5', 'lever up', 8000).catch(() => false), 'socket lever lifts for the CPU step');
      if (g.stage === 'm2' && await evaluate('__t.board().userData.mechanisms.m2Covers.length')) ok(await waitFor('__t.m2Lift() > 2', 'M.2 cover off', 8000).catch(() => false), 'M.2 cover comes off for the M.2 step');
      if (g.stage === 'gpu' && await evaluate('(__t.r().scene.layout.gpu?.covers ?? []).length')) ok(await waitFor('__t.coversShown() === 0', 'slot covers out', 8000).catch(() => false), 'slot covers are removed for the graphics card');
      if (g.stage === 'ram' && g.decoys) {
        await dragGroup(g.key, { decoy: 0 });
        const msg = await evaluate('__t.t().message');
        ok(/fill order/.test(msg) && !(await evaluate('__t.installed()')).some((k) => k.startsWith('ram:')), `wrong memory slot is refused: "${msg}"`);
      }
      if (g.stage === 'gpu' && g.decoys) {
        await dragGroup(g.key, { decoy: 0 });
        ok(/x16/.test(await evaluate('__t.t().message')), `lower PCIe slot is refused: "${await evaluate('__t.t().message')}"`);
      }
      for (let i = 0; i < g.n; i++) {
        const before = (await evaluate('__t.installed()')).length;
        if (g.stage === 'prep' || g.stage === 'ram' || (g.stage === 'gpu' && n === 0)) await dragGroup(g.key);
        else {
          await evaluate(`__t.t().place(${JSON.stringify(g.key)})`);
          await waitFor('__t.idle()', 'place');
        }
        ok((await evaluate('__t.installed()')).length === before + 1, `${g.key} piece ${i + 1}/${g.n} installed`);
      }
      if (g.stage === 'prep') ok(await evaluate('__t.standoffs()') >= 4 && await evaluate('__t.shield()'), 'standoffs and I/O shield in after the first step');
      if (g.stage === 'cpu') ok(await waitFor('__t.lever() < 0.05', 'lever down', 8000).catch(() => false), 'socket lever closes over the CPU');
      if (g.stage === 'm2' && await evaluate('__t.board().userData.mechanisms.m2Covers.length')) ok(await waitFor('__t.m2Lift() < 0.05', 'M.2 cover on', 8000).catch(() => false), 'M.2 cover goes back on');
      if (g.stage === 'cpu' && n === 0) await shot(`${id}-2-cpu`);
    }
    ok(await evaluate('__t.visiblePieces()') === models && models === await evaluate('__t.placedPieces()'), `all ${total} pieces in and showing, same as the viewer`);
    const done = await evaluate(`(() => { const d = document.querySelector('.hand__done'); return d && !d.hidden ? d.textContent : ''; })()`);
    ok(/Parts installed — cables next/.test(done), 'shows "Parts installed — cables next"');
    ok(await evaluate(`!document.querySelector('.cab').hidden && document.querySelector('.tray').hidden`), 'the cable checklist replaces the parts tray');
    const why = await evaluate(`__t.cabText('#cab-power-why')`);
    ok(await evaluate('__t.powerBtn().disabled') && /^Missing: 24-pin ATX power/.test(why), `Power on is disabled and says what is missing: "${why.slice(0, 60)}…"`);
    if (n === 0) await shot(`${id}-3-done`);

    // Keyboard undo / redo.
    await key('z', CTRL);
    await waitFor('__t.idle()', 'undo');
    ok((await evaluate('__t.installed()')).length === total - 1 && await evaluate('__t.visiblePieces()') === models - 1, 'Ctrl+Z takes the last part out');
    await key('y', CTRL);
    ok((await evaluate('__t.installed()')).length === total, 'Ctrl+Y puts it back');

    if (n === 0) {
      // Reload continues where it left off.
      await open();
      await waitFor('__t.r().hand.active && __t.idle()', 'build mode after reload');
      ok((await evaluate('__t.installed()')).length === total && await evaluate('__t.visiblePieces()') === models, 'a reload continues in build mode with every part in');
      // Undo half-way, reload, still half-way.
      for (let i = 0; i < 4; i++) await evaluate('__t.t().undo()');
      await open();
      await waitFor('__t.r().hand.active && __t.idle()', 'build mode after reload');
      ok(await evaluate('__t.visiblePieces()') === models - 4 && (await evaluate('__t.installed()')).length === total - 4, 'half-built progress survives a reload');
      await evaluate('__t.t().redo(); __t.t().redo(); __t.t().redo(); __t.t().redo()');
      await waitFor('__t.idle()', 'redo');

      // Swap the graphics card mid-build from the tray: only the card comes out, the view
      // comes back to the 3D build, and the new card goes in.
      const other = await evaluate(`__t.r().app.catalog.list('gpu').find((g) => g.id !== ${JSON.stringify(build.gpu.id)} && g.lengthMM && g.lengthMM < 300 && g.tdp < 250)?.id`);
      await evaluate(`document.querySelector('[data-h="swap"][data-g="${gpu.key}"]').click()`);
      ok(await evaluate(`document.getElementById('col-parts').dataset.view`) === 'parts', 'Swap opens the catalogue');
      await evaluate(`__t.r().app.select(__t.r().app.catalog.get(${JSON.stringify(other)}))`);
      await waitFor(`__t.idle() && __t.r().scene.build.gpu?.id === ${JSON.stringify(other)} && __t.t().plan.groups.some((g) => g.key.includes(${JSON.stringify(other)}))`, 'the swapped card');
      ok(await evaluate(`document.getElementById('col-parts').dataset.view`) === '3d', 'back in the 3D build after picking');
      const after = await evaluate('__t.installed()');
      ok(after.length === total - 1 && !after.some((k) => k.startsWith('gpu:')), `only the old card came out (${after.length}/${total})`);
      const newGpu = (await evaluate('__t.groups()')).find((g) => g.stage === 'gpu');
      await evaluate(`__t.t().place(${JSON.stringify(newGpu.key)})`);
      await waitFor('__t.idle()', 'place');
      ok((await evaluate('__t.installed()')).length === total, 'the new card goes in and the build is complete again');
      await evaluate(`__t.r().app.select(__t.r().app.catalog.get(${JSON.stringify(build.gpu.id)}))`);
      await waitFor(`__t.idle() && __t.r().scene.build.gpu?.id === ${JSON.stringify(build.gpu.id)}`, 'the original card');
      await evaluate(`__t.t().place(${JSON.stringify(gpu.key)})`);
      await waitFor('__t.idle()', 'place');
    }

    await cableStep(n, id);

    // Reset case, then undo the reset.
    await evaluate(`document.querySelector('[data-h="reset"]').click()`);
    ok((await evaluate('__t.installed()')).length === 0 && await evaluate('__t.visiblePieces()') === 0 && !Object.keys(await evaluate('__t.cables()')).length && await evaluate('__t.c().count3d') === 0, 'Reset case empties it, cables too');
    await evaluate('__t.t().undo()');
    await waitFor('__t.idle()', 'undo');
    ok((await evaluate('__t.installed()')).length === total && Object.keys(await evaluate('__t.cables()')).length > 0, 'undo brings the parts and cables back after a reset');
  }

  // Leaving build mode shows the full build again (viewer).
  await evaluate('__t.r().setMode("viewer")');
  ok(await evaluate('__t.visiblePieces()') === await evaluate('__t.placedPieces()'), 'Viewer mode shows every part');
  await evaluate('__t.r().setMode("hand")');

  // ---- memory: repeated builds, full installs and resets
  console.log('Memory across repeated builds and resets');
  await reducedMotion(true);
  await open();
  await waitFor('__t.r().hand.active', 'build mode');
  // Live objects by prototype (three.js types, arrays, plain objects, images): a leak shows up
  // as a count that keeps rising, where the heap size alone also moves with V8 warm-up.
  await evaluate(`import('three').then((T) => { window.__T = T; })`);
  async function liveCount(expr) {
    const { result } = await page('Runtime.evaluate', { expression: expr });
    const q = await page('Runtime.queryObjects', { prototypeObjectId: result.objectId, objectGroup: 'leak' });
    const n = await page('Runtime.callFunctionOn', { objectId: q.objects.objectId, functionDeclaration: 'function () { return this.length; }', returnByValue: true });
    await page('Runtime.releaseObjectGroup', { objectGroup: 'leak' });
    return n.result.value;
  }
  const LIVE = ['__T.Object3D', '__T.Material', '__T.BufferGeometry', '__T.Texture', '__T.BufferAttribute', '__T.Matrix4', 'Array', 'Object', 'HTMLImageElement'];
  const samples = [];
  for (let round = 0; round < 4; round++) {
    for (const { build } of BUILDS) {
      await setBuild(build);
      await waitFor('__t.t().plan?.ready', 'plan');
      for (const g of await evaluate('__t.groups()')) {
        for (let i = 0; i < g.n; i++) {
          await evaluate(`__t.t().place(${JSON.stringify(g.key)})`);
          await waitFor('__t.idle()', 'place');
        }
      }
      await evaluate('__t.frames(3)');
      await evaluate('__t.c().autoRoute()');
      await evaluate('__t.c().selectCable("atx24")');
      await evaluate('__t.frames(3)');
      await evaluate('__t.t().reset()');
      await evaluate('__t.frames(3)');
    }
    await page('HeapProfiler.collectGarbage');
    await sleep(200);
    await page('HeapProfiler.collectGarbage');
    const heap = (await page('Runtime.getHeapUsage')).usedSize;
    const live = {};
    for (const k of LIVE) live[k.replace('__T.', '')] = await liveCount(`${k}.prototype`);
    samples.push({ ...(await evaluate('__t.mem()')), heapMB: Math.round(heap / 1e5) / 10, live });
  }
  console.log(`  ${samples.map((s) => `geo ${s.geometries} tex ${s.textures} prog ${s.programs} heap ${s.heapMB} MB`).join('\n  ')}`);
  const [, a, b, c] = samples;
  ok(a.geometries === c.geometries && b.geometries === c.geometries, 'GPU geometries flat across rounds');
  ok(a.textures === c.textures, 'GPU textures flat across rounds');
  ok(a.programs === c.programs, 'shader programs flat across rounds');
  ok(c.heapMB - a.heapMB < 1.5, `JS heap flat across rounds (+${(c.heapMB - a.heapMB).toFixed(1)} MB)`);
  const grew = Object.keys(c.live).filter((k) => c.live[k] > a.live[k]);
  ok(!grew.length, `live object counts flat across rounds${grew.length ? `: ${grew.map((k) => `${k} ${a.live[k]} -> ${c.live[k]}`).join(', ')}` : ` (${c.live.Object3D} Object3D, ${c.live.Material} materials, ${c.live.BufferGeometry} geometries)`}`);
  await reducedMotion(false);

  // ---- 380 px
  console.log('380 px wide');
  await viewport(380, 820, true);
  await open();
  await waitFor('__t.r().hand.active && __t.idle()', 'build mode on a phone');
  await sleep(400);
  const overflow = await evaluate('document.documentElement.scrollWidth');
  ok(overflow <= 380, `no horizontal page scroll at 380 px (scrollWidth ${overflow})`);
  await cablesAt380();
  const g0 = (await evaluate('__t.groups()'))[0];
  const p0 = await evaluate(`__t.tray(${JSON.stringify(g0.key)})`);
  const t0 = await evaluate(`__t.t().screenPoint(${JSON.stringify(g0.key)})`);
  ok(await evaluate(`__t.inView(${JSON.stringify(p0)}) && __t.inView(${JSON.stringify(t0)})`), 'tray and case both on screen at 380 px');
  await shot('380-build');
  await viewport(1280, 900);
  await open();
  await shot('1280-build');

  ok(consoleErrors.length === 0, `no console errors${consoleErrors.length ? `:\n    ${consoleErrors.slice(0, 8).join('\n    ')}` : ''}`);
} catch (err) {
  fail(err);
}
await finish();
