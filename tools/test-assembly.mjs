#!/usr/bin/env node
// Checks the build-by-hand install plan (js/scene/assembly.js) and its progress store
// (AssemblyProgress in js/state.js) on real builds: an ATX tower, an mATX build with an AIO
// and an ITX build. Full install order, order gates with their reasons, compat checks on
// drop, wrong-slot decoys, swaps mid-build, undo/redo/reset and saving.
// Usage: node tools/test-assembly.mjs [-v]   Exit code 1 on any failure.
import { checkBuild } from '../js/compat.js';
import { emptyBuild, AssemblyProgress } from '../js/state.js';
import { layoutBuild } from '../js/scene/layout.js';
import {
  planAssembly, canInstall, checkFit, freePieces, reconcile, progress, currentStage, STAGES,
} from '../js/scene/assembly.js';
import { catalog, BUILDS } from './test-builds.mjs';

const VERBOSE = process.argv.includes('-v');

let failures = 0;
let checks = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) {
    failures++;
    console.log(`  FAIL ${msg}`);
  } else if (VERBOSE) console.log(`  ok   ${msg}`);
}

const placementsEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

for (const { name, build } of BUILDS) {
  console.log(`${name}: ${build.case.name} + ${build.motherboard.name}`);
  const errors = checkBuild(build).filter((i) => i.level === 'error');
  ok(errors.length === 0, `build has no compat errors (${errors.map((e) => e.message).join('; ')})`);
  const layout = layoutBuild(build);
  const plan = planAssembly(build, layout);
  ok(plan.ready, 'plan is ready');

  // Every placed layout item is exactly one piece, at exactly the viewer's placement.
  const placed = layout.items.filter((it) => it.placement);
  const pieces = [...plan.pieces.values()].filter((p) => p.category !== 'prep');
  ok(placed.length === pieces.length, `one piece per placed layout item (${pieces.length}/${placed.length})`);
  for (const it of placed) {
    const p = pieces.find((x) => x.category === it.category && x.index === it.index && x.unit === it.unit);
    ok(p && placementsEqual(p.placement, it.placement), `target of ${it.category}#${it.index}/${it.unit} is the layout placement`);
  }

  // Stages come in real-life order.
  const order = plan.stages.map((s) => s.id);
  const real = STAGES.map((s) => s.id).filter((id) => order.includes(id));
  ok(JSON.stringify(order) === JSON.stringify(real), `stages in install order: ${order.join(' > ')}`);
  ok(order[0] === 'prep' && order[1] === 'psu' && order[2] === 'motherboard' && order[3] === 'cpu', 'prep, PSU, board, CPU come first');
  ok(order.indexOf('m2') < order.indexOf('gpu'), 'M.2 drives go in before the graphics card');
  ok(order.indexOf('cooler') < order.indexOf('ram'), 'cooler before memory (as asked)');
  if (build.cooler.type === 'aio') ok(order.indexOf('radiator') + 1 === order.indexOf('cooler'), 'AIO: radiator, then pump block');

  // Gates before anything is in.
  const empty = new Set();
  const gpuGroup = plan.groups.find((g) => g.stage === 'gpu');
  const g0 = canInstall(plan, empty, gpuGroup.key);
  ok(!g0.ok && g0.reason === 'Install the standoffs and I/O shield first.', `GPU first is refused: "${g0.reason}"`);
  ok(canInstall(plan, empty, 'prep').ok, 'standoffs and I/O shield can go in first');

  // Decoys: memory fill order and the top x16 slot.
  const ramGroup = plan.groups.find((g) => g.stage === 'ram');
  if (build.motherboard.memorySlots === 4) {
    ok(ramGroup.decoys.map((d) => d.name).join() === 'A1,B1', `2 sticks on 4 slots: A1 and B1 are wrong spots (${ramGroup.decoys.map((d) => d.name)})`);
    ok(/A2 and B2/.test(ramGroup.decoys[0].reason), `decoy reason names A2 and B2: "${ramGroup.decoys[0].reason}"`);
  } else ok(ramGroup.decoys.length === 0, '2 sticks on a 2-slot board: no wrong spots');
  if (layout.board.layout.pcie.length > 1) ok(gpuGroup.decoys.length === layout.board.layout.pcie.length - 1, 'every lower PCIe slot is a wrong spot for the card');

  // Full install, in order, checking gates on the way.
  const inst = new Set();
  const prog = new AssemblyProgress({ storage: null });
  prog.sync(plan.caseId, (k) => k);
  let steps = 0;
  for (const stage of plan.stages) {
    ok(currentStage(plan, inst)?.id === stage.id, `current stage is ${stage.id}`);
    // A later stage is still locked, naming this stage.
    const later = plan.groups.find((g) => STAGES.findIndex((s) => s.id === g.stage) > STAGES.findIndex((s) => s.id === stage.id));
    if (later) {
      const c = canInstall(plan, inst, later.key);
      ok(!c.ok && c.reason.includes(stage.need) || (stage.id === 'radiator' && later.stage === 'cooler' && /radiator/.test(c.reason)), `${later.stage} waits for ${stage.id}: "${c.reason}"`);
    }
    for (const g of plan.groups.filter((x) => x.stage === stage.id)) {
      ok(canInstall(plan, inst, g.key).ok, `${g.key} can be installed`);
      ok(checkFit(build, plan, inst, g.key).ok, `${g.key} passes compat`);
      for (const key of freePieces(plan, inst, g.key)) {
        inst.add(key);
        prog.install(key);
        steps++;
      }
      ok(!canInstall(plan, inst, g.key).ok, `${g.key} is done after its pieces`);
    }
  }
  const p = progress(plan, inst);
  ok(p.complete && p.done === p.total && currentStage(plan, inst) === null, `all ${p.total} pieces installed in ${steps} steps`);
  ok(prog.installed.length === steps, 'progress store recorded every install');

  // Undo / redo / reset.
  prog.undo();
  ok(prog.installed.length === steps - 1, 'undo removes the last piece');
  prog.redo();
  ok(prog.installed.length === steps, 'redo puts it back');
  prog.reset();
  ok(prog.installed.length === 0 && prog.canUndo, 'reset empties the case and can be undone');
  prog.undo();
  ok(prog.installed.length === steps, 'undo after reset restores everything');
  prog.install(prog.installed[0]);
  ok(prog.installed.length === steps, 'installing an installed piece does nothing');

  // Compat on drop: a CPU for another socket is refused with the compat message.
  const wrongCpu = catalog.list('cpu').find((c) => c.socket !== build.cpu.socket);
  const badBuild = { ...build, cpu: wrongCpu };
  const badPlan = planAssembly(badBuild);
  const upTo = new Set([...badPlan.pieces.values()].filter((x) => ['prep', 'psu', 'motherboard'].includes(x.stage)).map((x) => x.key));
  const cpuGroup = badPlan.groups.find((g) => g.stage === 'cpu');
  const fit = checkFit(badBuild, badPlan, upTo, cpuGroup.key);
  ok(canInstall(badPlan, upTo, cpuGroup.key).ok && !fit.ok && /socket/.test(fit.reason), `wrong-socket CPU refused on drop: "${fit.reason}"`);

  // Swap mid-build: a different board takes the parts that sit on it out; PSU and fans stay.
  const all = [...inst];
  const otherBoard = catalog.list('motherboard').find((b) => b.id !== build.motherboard.id && b.formFactor === build.motherboard.formFactor && b.socket === build.motherboard.socket);
  if (otherBoard) {
    const swapped = { ...build, motherboard: otherBoard };
    const kept = reconcile(planAssembly(swapped), all);
    const stageOfKey = (k) => plan.pieces.get(k).stage;
    ok(kept.some((k) => stageOfKey(k) === 'psu'), 'board swap keeps the PSU');
    ok(!kept.some((k) => ['motherboard', 'cpu', 'ram', 'm2', 'gpu', 'cooler'].includes(stageOfKey(k))), 'board swap takes out the board and everything on it');
    ok(kept.every((k) => !['cpu', 'ram'].includes(stageOfKey(k))), 'no CPU or memory left floating');
  }
  // Same build: nothing changes.
  ok(reconcile(plan, all).length === all.length, 'reconcile keeps everything for the same build');
}

// Saving and loading progress; a new case starts over.
{
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const a = new AssemblyProgress({ storage });
  a.sync('case-a', (k) => k);
  a.setMode('hand');
  a.install('prep:ATX');
  a.install('psu:x');
  const b = new AssemblyProgress({ storage });
  ok(b.load() && b.mode === 'hand' && b.installed.join() === 'prep:ATX,psu:x' && b.canUndo, 'progress, mode and history survive a reload');
  b.sync('case-a', (keys) => keys.filter((k) => k !== 'psu:x'));
  ok(b.installed.join() === 'prep:ATX' && !b.canRedo, 'sync drops pieces that no longer apply');
  b.sync('case-b', (k) => k);
  ok(b.installed.length === 0 && !b.canUndo, 'a different case starts over');
  mem.set('rigsmith.assembly.v1', '{broken');
  ok(new AssemblyProgress({ storage }).load() === false, 'corrupt saved progress is ignored');
}

// No case: the plan asks for one.
ok(planAssembly(emptyBuild()).ready === false, 'no case: plan not ready, asks for a case');

console.log(failures ? `FAILED: ${failures} of ${checks} checks` : `OK: ${checks} checks`);
process.exit(failures ? 1 : 0);
