#!/usr/bin/env node
// Shared browser harness for tools/test-browser.mjs and tools/test-cinematic-browser.mjs:
// serves the repo, starts headless Chrome (SwiftShader WebGL) and talks to it over the
// DevTools protocol (no npm packages; Node 22+ for the built-in WebSocket). Importing it starts
// the browser. Also the in-page helpers (window.__t, need ?debug3d) and real pointer and key input.
// CHROME=<path> picks the browser; -v prints passing checks; --shots <dir> saves screenshots.
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { idsOf } from './test-builds.mjs';
import { serveDir as serveRoot } from './serve.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('-v');
const shotsArg = process.argv.indexOf('--shots');
const SHOTS = shotsArg > 0 ? process.argv[shotsArg + 1] : null;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
let checks = 0;
export function ok(cond, msg) {
  checks++;
  if (!cond) { failures++; console.log(`  FAIL ${msg}`); } else if (VERBOSE) console.log(`  ok   ${msg}`);
  return cond;
}

// ---------------------------------------------------------------- static server
const servers = [];
/** Static server for `root` on a free port (no caching). Resolves to its base URL. */
export async function serveDir(root) {
  const { server, url } = await serveRoot(root);
  servers.push(server);
  return url;
}
export const BASE = await serveDir(ROOT);

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
// Tests use the software renderer (same result on every machine). RIGSMITH_GPU=1 uses the
// real GPU with the frame-rate cap off, for tools/bench-quality.mjs.
const gpuFlags = process.env.RIGSMITH_GPU
  ? ['--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const chrome = spawn(chromePath, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  ...gpuFlags, '--window-size=1280,900', '--autoplay-policy=no-user-gesture-required', 'about:blank',
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
export const page = (method, params) => send(method, params, sessionId);

export const consoleErrors = [];
listeners.push((m) => {
  if (m.sessionId !== sessionId) return;
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'assert')) consoleErrors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.params.entry.url ?? '')) consoleErrors.push(`${m.params.entry.text} ${m.params.entry.url ?? ''}`);
});
await page('Runtime.enable');
await page('Log.enable');
await page('Page.enable');

export async function evaluate(expression) {
  const r = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}\n  in: ${expression.slice(0, 160)}`);
  return r.result.value;
}
export async function waitFor(expression, label, timeout = 30000) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await evaluate(expression); } catch { /* page not ready */ }
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`Timed out waiting for ${label}`);
    await sleep(100);
  }
}
export async function viewport(width, height, mobile = false) {
  await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
}
export async function reducedMotion(on) {
  await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: on ? 'reduce' : 'no-preference' }] });
}
export async function shot(name) {
  if (!SHOTS) return;
  await mkdir(SHOTS, { recursive: true });
  const { data } = await page('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
}

// In-page helpers (need ?debug3d).
export const HELPERS = `window.__t = {
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
  c: () => __t.t().cables,
  cables: () => __t.saved().cables || {},
  cabText: (sel) => document.querySelector(sel)?.textContent.trim() ?? '',
  powerBtn: () => document.querySelector('.cab__power .vbtn--power'),
  marker(id) { const p = __t.c().markerPoint(id); return p && !p.behind ? { x: p.x, y: p.y } : null; },
  // On the 3D view and not under the sticky top bar or another element.
  onCanvas(p) { return !!p && document.elementFromPoint(p.x, p.y) === document.querySelector('.viewer canvas'); },
};`;

export async function open(url = '/builder.html?debug3d') {
  await page('Page.navigate', { url: BASE + url });
  await waitFor('document.readyState === "complete" && !!window.rigsmith3d', 'the 3D view');
  await evaluate(HELPERS);
}
export async function setBuild(build) {
  await evaluate(`(() => {
    const app = __t.r().app; const ids = ${JSON.stringify(idsOf(build))};
    const b = {}; for (const [k, v] of Object.entries(ids)) b[k] = Array.isArray(v) ? v.map((id) => app.catalog.get(id)) : v ? app.catalog.get(v) : null;
    app.applyBuild(b, 'Test build');
  })()`);
  await sleep(50);
  await waitFor('__t.idle() && __t.r().scene.build?.case?.id === ' + JSON.stringify(build.case.id), 'the new build in 3D');
  await sleep(100);
}
export async function mouse(type, p, buttons = 0) {
  await page('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
}
export async function drag(from, to) {
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
export async function key(k, mods = 0) {
  const code = `Key${k.toUpperCase()}`;
  const keyCode = k.toUpperCase().charCodeAt(0);
  await page('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: keyCode, modifiers: mods });
  await page('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: keyCode, modifiers: mods });
  await sleep(30);
}
export const CTRL = 2;

export async function click(p) {
  await mouse('mouseMoved', p);
  await mouse('mousePressed', p, 1);
  await mouse('mouseReleased', p, 0);
  await sleep(80);
}

/** Count an exception as a failure and print it with the console errors so far. */
export function fail(err) {
  failures++;
  console.log(`  FAIL ${err.message ?? err}`);
  if (consoleErrors.length) console.log(`  console:\n    ${consoleErrors.slice(0, 8).join('\n    ')}`);
}

/** Close everything, print the result and exit. */
export async function finish() {
  ws.close();
  chrome.kill();
  for (const s of servers) s.close();
  await sleep(300);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  console.log(failures ? `FAILED: ${failures} of ${checks} checks` : `OK: ${checks} checks`);
  process.exit(failures ? 1 : 0);
}
