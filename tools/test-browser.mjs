#!/usr/bin/env node
// Browser scenario for the builder's 3D view and "Build by hand", in headless Chrome over the
// DevTools protocol (no npm packages; Node 22+ for the built-in WebSocket).
// Serves the repo, then for an ATX, an mATX and an ITX build: enters Build by hand, checks
// the empty case, tray thumbnails and order gates, drags parts in with real pointer events
// (wrong order, wrong slots, right slots), places the rest, undo/redo with the keyboard,
// reload, reset. Then cycles builds and resets to check GPU and JS memory stay flat, and
// checks the 380 px layout. Any console error fails the run.
// Usage: node tools/test-browser.mjs [--shots <dir>] [-v]     CHROME=<path> picks the browser.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, extname, normalize, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { BUILDS, idsOf } from './test-builds.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('-v');
const shotsArg = process.argv.indexOf('--shots');
const SHOTS = shotsArg > 0 ? process.argv[shotsArg + 1] : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
let checks = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) { failures++; console.log(`  FAIL ${msg}`); } else if (VERBOSE) console.log(`  ok   ${msg}`);
  return cond;
}

// ---------------------------------------------------------------- static server
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.glb': 'model/gltf-binary' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[\\/]+/, '');
  const file = join(ROOT, path || 'index.html');
  if (!file.startsWith(ROOT + sep) && file !== ROOT) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// ---------------------------------------------------------------- chrome + CDP
function findChrome() {
  const list = [process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return list.find((p) => p && existsSync(p));
}
const chromePath = findChrome();
if (!chromePath) { console.log('No Chrome found: set CHROME=<path to chrome>.'); process.exit(1); }
const profile = await mkdtemp(join(tmpdir(), 'rigsmith-chrome-'));
const chrome = spawn(chromePath, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,900', '--autoplay-policy=no-user-gesture-required', 'about:blank',
], { stdio: 'ignore' });

let port = null;
for (let i = 0; i < 100 && !port; i++) {
  await sleep(100);
  try { [port] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n'); } catch { /* not yet */ }
}
const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let nextId = 0;
const pending = new Map();
const listeners = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`)); else p.resolve(msg.result);
  } else if (msg.method) listeners.forEach((fn) => fn(msg));
};
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject, method });
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const page = (method, params) => send(method, params, sessionId);

const consoleErrors = [];
listeners.push((m) => {
  if (m.sessionId !== sessionId) return;
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'assert')) consoleErrors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.params.entry.url ?? '')) consoleErrors.push(`${m.params.entry.text} ${m.params.entry.url ?? ''}`);
});
await page('Runtime.enable');
await page('Log.enable');
await page('Page.enable');

async function evaluate(expression) {
  const r = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}\n  in: ${expression.slice(0, 160)}`);
  return r.result.value;
}
async function waitFor(expression, label, timeout = 30000) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await evaluate(expression); } catch { /* page not ready */ }
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`Timed out waiting for ${label}`);
    await sleep(100);
  }
}
async function viewport(width, height, mobile = false) {
  await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
}
async function reducedMotion(on) {
  await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: on ? 'reduce' : 'no-preference' }] });
}
async function shot(name) {
  if (!SHOTS) return;
  await mkdir(SHOTS, { recursive: true });
  const { data } = await page('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
}

// In-page helpers (need ?debug3d).
const HELPERS = `window.__t = {
  r: () => window.rigsmith3d,
  t: () => window.rigsmith3d.hand.test,
  saved: () => JSON.parse(localStorage.getItem('rigsmith.assembly.v1') || '{}'),
  installed: () => __t.saved().installed || [],
  groups: () => __t.t().plan.groups.map((g) => ({ key: g.key, stage: g.stage, n: g.pieces.length, decoys: g.decoys.length })),
  shown(o) { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; },
  visiblePieces() {
    let n = 0;
    for (const m of __t.r().scene.models) {
      if (m.category === 'case') continue;
      for (const o of m.model.userData.units || [m.model]) {
        if (!o.userData.placed || !__t.shown(o)) continue;
        if (m.category === 'motherboard' && !o.children.some((c) => c.visible && c.name !== 'io-shield')) continue;
        n++;
      }
    }
    return n;
  },
  placedPieces() { let n = 0; for (const m of __t.r().scene.models) if (m.category !== 'case') for (const o of m.model.userData.units || [m.model]) if (o.userData.placed) n++; return n; },
  center(sel) { const b = document.querySelector(sel); if (!b) return null; b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; },
  tray: (key) => __t.center('[data-group="' + CSS.escape(key) + '"]'),
  idle: () => !__t.t().busy && !__t.r().hand.hb.animating && !__t.r().scene.busy,
  mem() { const i = __t.r().viewer.renderer.info; return { geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs.length, names: i.programs.map((p) => p.name + ':' + p.usedTimes).sort().join(' ') }; },
  frames: (n = 3) => new Promise((r) => { const f = () => (n-- <= 0 ? r(true) : requestAnimationFrame(f)); f(); }),
  board: () => __t.r().scene.modelOf('motherboard'),
  lever: () => __t.board().userData.mechanisms.lever.rotation.x,
  m2Lift: () => Math.max(0, ...__t.board().userData.mechanisms.m2Covers.map((c) => c.cover.position.z)),
  coversShown() { const cs = __t.r().scene.modelOf('case').userData.slotCovers; return (__t.r().scene.layout.gpu?.covers ?? []).filter((i) => cs[i] && __t.shown(cs[i])).length; },
  standoffs: () => __t.r().scene.modelOf('case').userData.standoffs.filter((m) => __t.shown(m)).length,
  shield: () => __t.shown(__t.board().getObjectByName('io-shield')),
  inView(p) { return p && p.x >= 0 && p.y >= 0 && p.x <= innerWidth && p.y <= innerHeight; },
};`;

async function open(url = '/builder.html?debug3d') {
  await page('Page.navigate', { url: BASE + url });
  await waitFor('document.readyState === "complete" && !!window.rigsmith3d', 'the 3D view');
  await evaluate(HELPERS);
}
async function setBuild(build) {
  await evaluate(`(() => {
    const app = __t.r().app; const ids = ${JSON.stringify(idsOf(build))};
    const b = {}; for (const [k, v] of Object.entries(ids)) b[k] = Array.isArray(v) ? v.map((id) => app.catalog.get(id)) : v ? app.catalog.get(v) : null;
    app.applyBuild(b, 'Test build');
  })()`);
  await sleep(50);
  await waitFor('__t.idle() && __t.r().scene.build?.case?.id === ' + JSON.stringify(build.case.id), 'the new build in 3D');
  await sleep(100);
}
async function mouse(type, p, buttons = 0) {
  await page('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
}
async function drag(from, to) {
  await mouse('mouseMoved', from);
  await mouse('mousePressed', from, 1);
  for (let i = 1; i <= 14; i++) {
    const t = i / 14;
    await mouse('mouseMoved', { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, 1);
  }
  await sleep(60);
  await mouse('mouseMoved', to, 1);
  await mouse('mouseReleased', to, 0);
  await waitFor('__t.idle()', 'the drop to finish');
}
async function dragGroup(key, { decoy = null } = {}) {
  const from = await evaluate(`__t.tray(${JSON.stringify(key)})`);
  const to = await evaluate(`__t.t().screenPoint(${JSON.stringify(key)}, { decoy: ${decoy} })`);
  ok(await evaluate(`__t.inView(${JSON.stringify(from)}) && __t.inView(${JSON.stringify(to)})`), `${key}: tray item and ${decoy === null ? 'target' : 'wrong slot'} both on screen`);
  await drag(from, to);
}
async function key(k, mods = 0) {
  const code = `Key${k.toUpperCase()}`;
  const keyCode = k.toUpperCase().charCodeAt(0);
  await page('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: keyCode, modifiers: mods });
  await page('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: keyCode, modifiers: mods });
  await sleep(30);
}
const CTRL = 2;

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
    ok(/Parts installed — cables next/.test(done) && /Connect the cables first/.test(done), 'shows "Parts installed — cables next"');
    ok(await evaluate(`document.querySelector('.hand__done .vbtn--power').disabled`), 'Power on is disabled until the cables are in');
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

    // Reset case, then undo the reset.
    await evaluate(`document.querySelector('[data-h="reset"]').click()`);
    ok((await evaluate('__t.installed()')).length === 0 && await evaluate('__t.visiblePieces()') === 0, 'Reset case empties it');
    await evaluate('__t.t().undo()');
    ok((await evaluate('__t.installed()')).length === total, 'undo brings the parts back after a reset');
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
  failures++;
  console.log(`  FAIL ${err.message}`);
  if (consoleErrors.length) console.log(`  console:\n    ${consoleErrors.slice(0, 8).join('\n    ')}`);
} finally {
  ws.close();
  chrome.kill();
  server.close();
  await sleep(300);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

console.log(failures ? `FAILED: ${failures} of ${checks} checks` : `OK: ${checks} checks`);
process.exit(failures ? 1 : 0);
