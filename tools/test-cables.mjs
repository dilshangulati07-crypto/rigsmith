#!/usr/bin/env node
// Cable step checks in Node: the connection list from the real part data (names, counts,
// native 16-pin vs adapter), tidy auto-routes for the ATX, mATX, ITX and dual-chamber builds
// (ends on the ports, inside the case, through openings only, no warnings, score), a moved
// waypoint across the graphics card, the power-on gate, and the cable state in
// AssemblyProgress (undo/redo, reset, persistence, version 1 saves).
// Usage: node tools/test-cables.mjs [-v]
import { layoutBuild } from '../js/scene/layout.js';
import { planAssembly } from '../js/scene/assembly.js';
import { planCables, powerReady, CABLE_SPECS } from '../js/scene/cable-plan.js';
import { routeContext, routeOf, checkCable, scoreCables, sampleRoute, waypointsOf, boxContains } from '../js/scene/cable-route.js';
import { AssemblyProgress } from '../js/state.js';
import { BUILDS } from './test-builds.mjs';

const VERBOSE = process.argv.includes('-v');
let failures = 0;
let checks = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) { failures++; console.log(`  FAIL ${msg}`); } else if (VERBOSE) console.log(`  ok   ${msg}`);
  return cond;
}
const close = (a, b, e = 0.02) => a.every((v, i) => Math.abs(v - b[i]) <= e);

// Silk-screen names per brand (the board's own manual), for the boards in the test builds.
const NAMES = {
  ASUS: { atx24: 'EATXPWR', eps0: 'EATX12V_1', panel: 'PANEL', cpuFan: 'CPU_FAN' },
  MSI: { atx24: 'ATX_PWR1', eps0: 'CPU_PWR1', panel: 'JFP1', cpuFan: 'CPU_FAN1' },
  ASRock: { atx24: 'ATXPWR1', eps0: 'ATX12V1', panel: 'PANEL1', cpuFan: 'CPU_FAN1' },
};
const brandOf = (board) => Object.keys(NAMES).find((b) => board.name.startsWith(b === 'ASRock' ? 'ASRock' : b));

const t0 = performance.now();
for (const { id, name, build } of BUILDS) {
  console.log(name);
  const aplan = planAssembly(build, layoutBuild(build));
  const cplan = planCables(build, aplan);
  ok(cplan.ready !== false || cplan.items.length, `${id}: a cable plan`);
  const items = new Map(cplan.items.map((i) => [i.id, i]));
  const board = build.motherboard;
  const N = NAMES[brandOf(board)];

  // ---- the list, from the part data
  ok(items.get('atx24')?.required && items.get('atx24').target === N.atx24, `24-pin goes to ${N.atx24}`);
  const eps = cplan.items.filter((i) => i.id.startsWith('eps:'));
  const sockets = board.cpuPower ?? ['8-pin'];
  ok(eps.length === sockets.length, `CPU power: ${eps.length} socket(s), as in the data (${sockets.join(' + ')})`);
  ok(eps[0]?.required && eps[0].target === N.eps0 && eps.slice(1).every((e) => !e.required), `first CPU socket ${N.eps0} required, the rest recommended`);
  ok(eps.every((e, i) => e.cable === (sockets[i] === '4-pin' ? 'eps4' : 'eps8')), 'CPU cable sizes follow the sockets (8-pin / 4-pin)');
  if (!board.cpuPower) ok(/aren't in the data/.test(eps[0].note ?? ''), 'a board without CPU socket data says so');

  const gpuPower = build.gpu.powerConnectors ?? ['8-pin'];
  const gpuItems = cplan.items.filter((i) => i.id.startsWith('gpu:'));
  if (gpuPower.includes('16-pin')) {
    const native = (build.psu.connectors?.pcie16 ?? 0) > 0;
    ok(gpuItems.length === 1 && gpuItems[0].cable === 'hpwr' && gpuItems[0].required, '16-pin card: one 12V-2x6 cable');
    ok(native ? !/adapter/.test(gpuItems[0].name) : /adapter/.test(gpuItems[0].name), `${native ? 'native 16-pin cable from the PSU' : 'adapter, the PSU has no 16-pin'}: "${gpuItems[0].name}"`);
  } else {
    ok(gpuItems.length === gpuPower.length && gpuItems.every((g) => g.cable === 'pcie' && g.required), `card power: ${gpuItems.length} PCIe cable(s) for ${gpuPower.join(' + ')}`);
  }

  const sata = build.storage.filter((s) => s.formFactor === '2.5in' || s.formFactor === '3.5in');
  const sp = cplan.items.filter((i) => i.id.startsWith('sata-power:'));
  const sd = cplan.items.filter((i) => i.id.startsWith('sata-data:'));
  ok(sp.length === sata.length && sd.length === sata.length && [...sp, ...sd].every((i) => i.required), `SATA power + data for each SATA drive (${sata.length})`);
  ok(items.get('fpanel')?.required && items.get('fpanel').target === N.panel, `front panel to ${N.panel}`);
  ok(items.has('usb3') && items.has('audio'), 'front USB 3 and HD audio listed');
  ok(build.case.frontIO?.usbC === 0 ? !items.has('usbc') : items.has('usbc'), `front USB-C ${build.case.frontIO?.usbC === 0 ? 'left out (the case has none)' : 'listed'}`);
  if (build.cooler.type === 'aio') ok(items.get('pump')?.required && items.get('cpu-fan')?.required, 'AIO: pump and radiator fans to their headers');
  else ok(items.get('cpu-fan')?.required && items.get('cpu-fan').target === N.cpuFan && !items.has('pump'), `air cooler: CPU fan to ${N.cpuFan}`);
  const fanRuns = cplan.items.filter((i) => /^fan:\d+$/.test(i.id));
  ok(fanRuns.length === new Set(aplan.layout.fans.map((f) => `${f.partIndex}|${f.mount}`)).size, `one cable per fan run (${fanRuns.length})`);
  const rgbFans = build.fans.some((f) => f.rgb);
  ok(rgbFans ? cplan.items.some((i) => i.id.startsWith('argb:fan')) : !cplan.items.some((i) => i.id.startsWith('argb:fan')), `ARGB cables ${rgbFans ? 'for the RGB fans' : 'only for RGB fans'}`);
  ok(cplan.items.every((i) => CABLE_SPECS[i.cable] && cplan.ports.has(i.from) && cplan.ports.has(i.to)), 'every item has a cable size and both ports');

  // ---- tidy auto-routes
  const ctx = routeContext(aplan);
  const routed = [];
  const bad = [];
  for (const it of cplan.items.filter((i) => !i.unavailable)) {
    const A = cplan.ports.get(it.from);
    const B = cplan.ports.get(it.to);
    const route = routeOf(it, cplan, ctx, null);
    const check = checkCable(it, route, ctx, A, B);
    routed.push({ item: it, route, check, auto: check });
    const s = sampleRoute(route.pts);
    const outside = s.filter((p) => !boxContains(ctx.shell, p, 1.0)).length;
    if (!close(route.pts[0], A.p) || !close(route.pts[route.pts.length - 1], B.p)) bad.push(`${it.id}: ends off the ports`);
    if (outside) bad.push(`${it.id}: ${outside} samples outside the case`);
    if (check.steel) bad.push(`${it.id}: through steel ${check.steel}x`);
    if (check.solid) bad.push(`${it.id}: through a solid part`);
    if (check.warnings.length) bad.push(`${it.id}: crosses ${check.warnings.map((w) => w.label).join(', ')}`);
    if (VERBOSE) console.log(`       ${it.id.padEnd(13)} ${check.length.toFixed(0).padStart(3)} cm, ${Math.round((check.hidden / check.length) * 100)}% hidden`);
  }
  ok(!bad.length, `auto-routes: on the ports, inside the case, through openings, no crossings${bad.length ? `: ${bad.slice(0, 4).join('; ')}` : ''}`);
  const score = scoreCables(routed);
  ok(score.score >= 90 && score.reasons.length === 4 && score.reasons.every((r) => r.text), `auto-route score ${score.score}/100 with 4 reasons`);
  if (ctx.zb !== null) ok(score.hiddenFrac > 0.4, `cables run behind the tray (${Math.round(score.hiddenFrac * 100)}% of the length out of sight)`);
  const floating = routed.filter((r) => /^fan:|^argb:fan/.test(r.item.id) && r.check.float > 8);
  ok(!floating.length, `case fan cables don't float across the case${floating.length ? `: ${floating.map((r) => r.item.id).join(', ')}` : ''}`);

  // ---- a waypoint dragged across the card's fans: a warning (not a block) and a lower score
  const gpuZone = ctx.obstacles.find((o) => o.kind === 'gpu');
  const victim = routed.find((r) => r.item.id === 'eps:0');
  if (gpuZone && victim) {
    const mid = gpuZone.box.min.map((v, a) => (v + gpuZone.box.max[a]) / 2);
    const state = { pts: [mid], src: null, dst: null };
    const route = routeOf(victim.item, cplan, ctx, state);
    ok(route.custom && waypointsOf(route).length === 1, 'moved waypoint is kept as the route');
    const check = checkCable(victim.item, route, ctx, cplan.ports.get(victim.item.from), cplan.ports.get(victim.item.to));
    ok(check.warnings.some((w) => w.kind === 'gpu'), `CPU power cable over the card warns: "${check.warnings.map((w) => w.label).join(', ')}"`);
    const worse = scoreCables(routed.map((r) => (r === victim ? { ...r, route, check } : r)));
    ok(worse.score < score.score && worse.reasons.find((r) => r.id === 'crossings').level === 'warn', `score drops with the crossing (${score.score} -> ${worse.score})`);
  }

  // ---- power on only with every required cable
  const required = cplan.items.filter((i) => i.required && !i.unavailable);
  ok(!powerReady(cplan, {}).ok && powerReady(cplan, {}).missing.length === required.length, `nothing connected: ${required.length} required cables missing`);
  const all = Object.fromEntries(cplan.items.map((i) => [i.id, { pts: null, src: null, dst: null }]));
  ok(powerReady(cplan, all).ok, 'everything connected: ready to power on');
  const { atx24, ...noAtx } = all;
  const r = powerReady(cplan, noAtx);
  ok(!r.ok && r.missing.length === 1 && r.missing[0].id === 'atx24', 'without the 24-pin: not ready, and it says which');
  const onlyRequired = Object.fromEntries(required.map((i) => [i.id, all[i.id]]));
  ok(powerReady(cplan, onlyRequired).ok, 'recommended cables are not needed to power on');
}
const ms = performance.now() - t0;
ok(ms < 4000, `plans, routes and checks for ${BUILDS.length} builds in ${ms.toFixed(0)} ms`);

// ---------------------------------------------------------------- cable state
console.log('Cable state (js/state.js)');
const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), map: m }; };
{
  const storage = memory();
  const p = new AssemblyProgress({ storage });
  p.sync('case-a', (k) => k);
  p.install('a'); p.install('b');
  ok(p.connect('atx24') && !p.connect('atx24'), 'connect once');
  ok(p.cables.atx24?.pts === null, 'a new cable follows the tidy route');
  p.connect('eps:0', { src: 'psu:3', dst: null });
  ok(p.cables['eps:0'].src === 'psu:3', 'connect keeps the chosen PSU socket');
  p.setRoute('atx24', [[1.234, 2.345, 3.456]]);
  ok(JSON.stringify(p.cables.atx24.pts) === '[[1.23,2.35,3.46]]', 'moved waypoints are stored (rounded)');
  p.undo();
  ok(p.cables.atx24.pts === null, 'undo puts the cable back on its tidy route');
  p.redo();
  ok(p.cables.atx24.pts?.length === 1, 'redo moves it again');
  p.undo(); p.undo();
  ok(!p.cables['eps:0'] && p.cables.atx24, 'undo disconnects the last cable');
  p.redo();
  const c = p.cables; c.atx24.pts = [[9, 9, 9]];
  ok(p.cables.atx24.pts === null, 'cables getter returns a copy');

  ok(p.connectAll({ atx24: null, 'eps:0': { src: 'psu:3' }, fpanel: null, 'cpu-fan': null }), 'auto-route connects everything');
  ok(Object.keys(p.cables).length === 4 && p.cables.atx24.pts === null, '... on tidy routes');
  ok(!p.connectAll({ atx24: null, 'eps:0': { src: 'psu:3' }, fpanel: null, 'cpu-fan': null }), 'auto-route again with nothing to change is not a new step');
  p.undo();
  ok(Object.keys(p.cables).length === 2, 'one undo takes back the whole auto-route');
  p.redo();
  ok(p.setClosed(true) && p.closed, 'close the case');
  p.undo();
  ok(!p.closed, 'undo opens it again');
  p.redo();

  // Style is a look, not a step.
  const before = p.canRedo;
  let styleEvents = 0;
  p.addEventListener('change', (e) => { if (e.detail.action === 'style') styleEvents++; });
  p.setCableStyle({ kind: 'sleeved', color: '#3DDC97' });
  p.setCableStyle({ kind: 'neon', color: 'red' });
  ok(p.cableStyle.kind === 'sleeved' && p.cableStyle.color === '#3ddc97' && styleEvents === 1 && p.canRedo === before, 'cable style: valid values only, not in undo');

  // Persistence.
  const q = new AssemblyProgress({ storage });
  ok(q.load() && q.closed && Object.keys(q.cables).length === 4 && q.cables['eps:0'].src === 'psu:3' && q.cableStyle.kind === 'sleeved', 'a reload restores cables, closed case and style');
  q.undo();
  ok(!q.closed && q.canRedo, '... and the undo history');
  ok(JSON.parse(storage.map.get('rigsmith.assembly.v1')).version === 2, 'saved as version 2');

  // Reset clears parts and cables; undo brings them back.
  ok(q.reset() && !q.installed.length && !Object.keys(q.cables).length && !q.closed, 'reset empties the case and the cables');
  q.undo();
  ok(q.installed.length === 2 && Object.keys(q.cables).length === 4, 'undo after reset brings parts and cables back');

  // Disconnecting the last cable re-opens a closed case.
  const solo = new AssemblyProgress({ storage: memory() });
  solo.sync('x', (k) => k);
  solo.connect('atx24'); solo.setClosed(true); solo.disconnect('atx24');
  ok(!solo.closed, 'no cables left: the case is open');

  // A build change keeps only the cables that still apply.
  q.sync('case-a', (k) => k, (cables) => Object.fromEntries(Object.entries(cables).filter(([k]) => k !== 'cpu-fan')));
  ok(!q.cables['cpu-fan'] && q.cables.atx24, 'sync drops cables whose part is gone');
  q.sync('case-b', (k) => k);
  ok(!Object.keys(q.cables).length && !q.canUndo, 'a different case starts over');
}
{
  // Version 1 saves (parts only) still load.
  const storage = memory();
  storage.setItem('rigsmith.assembly.v1', JSON.stringify({ version: 1, mode: 'hand', caseId: 'c', installed: ['a', 'b'], undo: [[], ['a']], redo: [] }));
  const p = new AssemblyProgress({ storage });
  ok(p.load() && p.mode === 'hand' && p.installed.join() === 'a,b' && !Object.keys(p.cables).length && !p.closed, 'a version 1 save loads with no cables');
  p.undo();
  ok(p.installed.join() === 'a', '... with its undo history');
  // Bad cable data is cleaned, not trusted.
  storage.setItem('rigsmith.assembly.v1', JSON.stringify({ version: 2, caseId: 'c', installed: [], cables: { atx24: { pts: [[1, 'x', 3]], src: 5 }, bad: null }, undo: [{ installed: 'no', cables: [] }], style: { kind: 'x', color: 'y' } }));
  const q = new AssemblyProgress({ storage });
  ok(q.load() && q.cables.atx24.pts === null && q.cables.atx24.src === null && !q.cables.bad && q.cableStyle.kind === 'black', 'damaged saved cables are cleaned up');
  storage.setItem('rigsmith.assembly.v1', '{not json');
  ok(!new AssemblyProgress({ storage }).load(), 'unreadable save is ignored');
}

console.log(failures ? `FAILED: ${failures} of ${checks} checks` : `OK: ${checks} checks`);
process.exit(failures ? 1 : 0);
