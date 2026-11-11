#!/usr/bin/env node
// Auto-build cinematic script checks in Node, for the ATX, mATX, ITX and dual-chamber builds:
// steps follow the real install order, every piece and every possible cable appears exactly
// once, cables are Auto-route's tidy routes ending on their ports, labels name the real parts,
// the state at any step (for timeline jumps) matches the steps before it, and the boot step
// only appears when every required cable is in. Also: no case, no parts.
// Usage: node tools/test-cinematic.mjs [-v]
import { layoutBuild } from '../js/scene/layout.js';
import { planAssembly, STAGES } from '../js/scene/assembly.js';
import { planCables, powerReady } from '../js/scene/cable-plan.js';
import { routeContext, routeOf, sampleRoute } from '../js/scene/cable-route.js';
import { planCinematic, stateAt, startOf, cableSeconds } from '../js/scene/cinematic-plan.js';
import { emptyBuild } from '../js/state.js';
import { BUILDS, catalog } from './test-builds.mjs';

const VERBOSE = process.argv.includes('-v');
let failures = 0;
let checks = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) { failures++; console.log(`  FAIL ${msg}`); } else if (VERBOSE) console.log(`  ok   ${msg}`);
  return cond;
}
const near = (a, b, e = 0.02) => a.every((v, i) => Math.abs(v - b[i]) <= e);
const STAGE_ORDER = STAGES.map((s) => s.id);

for (const { id, name, build } of BUILDS) {
  console.log(name);
  const aplan = planAssembly(build, layoutBuild(build));
  const cin = planCinematic(build, aplan);
  ok(cin.ready && cin.steps.length > 5, `${id}: a script (${cin.steps.length} steps, ${cin.total.toFixed(1)} s at 1x, ${cin.totalReduced.toFixed(1)} s reduced)`);
  const kinds = cin.steps.map((s) => s.kind);
  const shape = kinds.join(' ').replace(/(part ?)+/, 'part… ').replace(/(cables ?)+/, 'cables… ').trim();
  ok(/^intro part… cables… close power hero$/.test(shape), `${id}: intro, parts, cables, close, power, hero ("${shape}")`);

  // Parts: the install order, every piece once.
  const parts = cin.steps.filter((s) => s.kind === 'part');
  const order = parts.map((s) => STAGE_ORDER.indexOf(s.stage));
  ok(order.every((v, i) => !i || v >= order[i - 1]), `${id}: parts in the real install order (${parts.map((s) => s.short).join(', ')})`);
  ok(parts.map((s) => s.group).join() === aplan.groups.map((g) => g.key).join(), `${id}: one step per tray group, same order as Build by hand`);
  const pieces = parts.flatMap((s) => s.pieces);
  ok(pieces.length === aplan.pieces.size && new Set(pieces).size === pieces.length, `${id}: every piece exactly once (${pieces.length})`);
  const cooler = parts.find((s) => s.stage === 'cooler');
  ok(!cooler || cooler.label.includes(build.cooler.name), `${id}: labels name the part ("${cooler?.label}")`);
  ok(/^Fitting standoffs and I\/O shield — (E-ATX|ATX|mATX|ITX) board$/.test(parts[0].label), `${id}: first step is the standoffs ("${parts[0].label}")`);

  // Cables: Auto-route's set on tidy routes, ending on the ports.
  const cplan = planCables(build, aplan);
  const want = cplan.items.filter((i) => !i.unavailable).map((i) => i.id);
  const steps = cin.steps.filter((s) => s.kind === 'cables');
  const drawn = steps.flatMap((s) => s.items);
  ok(drawn.length === want.length && want.every((w) => drawn.includes(w)), `${id}: every possible cable drawn once (${drawn.length})`);
  const firstFan = drawn.findIndex((d) => d.startsWith('fan:') || d === 'cpu-fan' || d === 'pump');
  ok(drawn[0] === 'atx24' && drawn.indexOf('eps:0') > 0 && drawn.indexOf('eps:0') < firstFan, `${id}: 24-pin first, CPU power before fans (${drawn.slice(0, 3).join(', ')}…)`);
  const ctx = routeContext(aplan);
  let ends = true;
  let same = true;
  for (const c of cin.cables.values()) {
    const s = c.samples;
    ends &&= near(s[0], c.A.p) && near(s[s.length - 1], c.B.p);
    same &&= JSON.stringify(sampleRoute(routeOf(c.item, cplan, ctx, null).pts)) === JSON.stringify(s);
  }
  ok(ends, `${id}: each cable starts on its PSU/case/fan port and ends on its socket`);
  ok(same, `${id}: the same curves as Auto-route draws`);
  const atx = cin.cables.get('atx24');
  ok(atx && /^Connecting 24-pin ATX power — \S+/.test(atx.label) && atx.dur === cableSeconds(atx.length), `${id}: cable label "${atx?.label}"`);

  // State at each step.
  const n = cin.steps.length;
  const end = stateAt(cin.steps, n);
  ok(end.installed.length === pieces.length && end.cables.length === drawn.length && end.closed && end.power && end.stage === null, `${id}: the end state has everything in, closed and on`);
  const st0 = stateAt(cin.steps, 0);
  ok(!st0.installed.length && !st0.cables.length && !st0.closed && !st0.power && st0.stage === 'prep', `${id}: the start is an empty, open case on the first stage`);
  const cpuStep = cin.steps.findIndex((s) => s.stage === 'cpu');
  const atCpu = stateAt(cin.steps, cpuStep);
  ok(atCpu.stage === 'cpu' && atCpu.installed.every((k) => !k.startsWith('cpu:')) && atCpu.installed.some((k) => k.startsWith('motherboard:')), `${id}: jumping to the CPU step has the board in and the socket open`);
  const closeStep = kinds.indexOf('close');
  ok(!stateAt(cin.steps, closeStep).closed && stateAt(cin.steps, closeStep + 1).closed && stateAt(cin.steps, closeStep).stage === null, `${id}: the panel closes at its own step`);
  ok(Math.abs(startOf(cin.steps, n) - cin.total) < 1e-9 && startOf(cin.steps, 1) === cin.steps[0].dur, `${id}: step start times add up`);
  ok(cin.total > 25 && cin.total < 120 && cin.totalReduced < cin.total / 2, `${id}: ${cin.total.toFixed(0)} s at 1x, ${(cin.total / 4).toFixed(0)} s at 4x, ${cin.totalReduced.toFixed(0)} s crossfade`);
}

// Edge cases: no case, an empty case, a case and board only (no cables, no boot).
console.log('Edge cases');
const none = planCinematic(emptyBuild(), planAssembly(emptyBuild()));
ok(!none.ready && /case/.test(none.reason), `no case: "${none.reason}"`);
const empty = { ...emptyBuild(), case: BUILDS[0].build.case };
const e = planCinematic(empty, planAssembly(empty));
ok(!e.ready && /parts/.test(e.reason), `case only: "${e.reason}"`);
const half = { ...emptyBuild(), case: BUILDS[0].build.case, motherboard: BUILDS[0].build.motherboard, cpu: BUILDS[0].build.cpu };
const h = planCinematic(half, planAssembly(half));
ok(h.ready && !h.steps.some((s) => s.kind === 'cables' || s.kind === 'power') && h.steps.some((s) => s.kind === 'close'), `board and CPU only: no cables, no boot (${h.steps.map((s) => s.short).join(', ')})`);
const noGpuPower = { ...BUILDS[0].build };
const p = planAssembly(noGpuPower);
ok(powerReady(planCables(noGpuPower, p), {}).ok === false, 'sanity: power needs cables');
ok(catalog.list('case').length > 0, 'sanity: catalogue loaded');

console.log(failures ? `FAILED: ${failures} of ${checks} checks` : `OK: ${checks} checks`);
process.exit(failures ? 1 : 0);
