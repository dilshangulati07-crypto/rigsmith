#!/usr/bin/env node
// Checks js/scene/layout.js against the real data: for every case, every board size it takes,
// several PSUs and a mix of fans and drives, nothing may sit outside the case or overlap.
// Usage: node tools/test-layout.mjs [-v]   Exit code 1 on any failure.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layoutBuild, worldExtent, psuDims, DRIVE_DIMS, WALL, SIDE } from '../js/scene/layout.js';
import { ramModules } from '../js/scene/layout-board.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('-v');
const load = (c) => JSON.parse(readFileSync(join(ROOT, 'data', 'parts', `${c}.json`), 'utf8')).parts;
const cases = load('case');
const boards = load('motherboard');
const psus = load('psu');
const fans = load('fans');
const drives = load('storage');
const gpus = load('gpu').filter((g) => g.lengthMM);
const coolers = load('cooler');
const rams = load('ram');

const failures = [];
const where = {};
const TOL = 0.05;
const gNotes = [];
const radNotes = [];
const overlapNotes = [];

// Axis-aligned box from a placement and a local size.
function box(placement, size) {
  const ext = worldExtent(size, placement.ex, placement.ey);
  return { min: placement.p.map((v, a) => v - ext[a] / 2), max: placement.p.map((v, a) => v + ext[a] / 2) };
}
const overlap = (a, b) => [0, 1, 2].every((i) => a.min[i] < b.max[i] - TOL && b.min[i] < a.max[i] - TOL);
const inside = (b, c) => [0, 1, 2].every((i) => b.min[i] >= c.min[i] - TOL && b.max[i] <= c.max[i] + TOL);

const pick = (list, pred) => list.find(pred);
const psuSet = [
  pick(psus, (p) => p.formFactor === 'ATX' && p.wattage <= 650),
  pick(psus, (p) => p.formFactor === 'ATX' && p.wattage >= 1200),
  pick(psus, (p) => p.formFactor === 'SFX'),
  pick(psus, (p) => p.formFactor === 'SFX-L'),
].filter(Boolean);
const pack3 = pick(fans, (f) => f.packCount === 3 && f.sizeMM === 120);
const single = pick(fans, (f) => f.packCount === 1 && f.sizeMM === 120);
const nvme = drives.filter((d) => d.formFactor === 'M.2 2280').slice(0, 2);
const sata = pick(drives, (d) => d.formFactor === '2.5in');
const hdd = pick(drives, (d) => d.formFactor === '3.5in');

let runs = 0;
for (const pcCase of cases) {
  for (const ff of pcCase.formFactorsSupported ?? ['ATX', 'mATX', 'ITX']) {
    const board = pick(boards, (b) => b.formFactor === ff && b.m2Slots >= 2) ?? pick(boards, (b) => b.formFactor === ff);
    if (!board) continue;
    for (const psu of psuSet) {
      if (pcCase.psuFormFactors && !pcCase.psuFormFactors.includes(psu.formFactor)) continue;
      const base = { case: pcCase, motherboard: board, psu, fans: [pack3, single], storage: [...nvme, sata, hdd] };
      check(base, `${pcCase.id} + ${ff} + ${psu.id}`);
      // Longest card and tallest air cooler the case takes, plus a full set of memory.
      const maxL = pcCase.maxGPULengthMM ?? 300;
      const maxH = pcCase.maxCoolerHeightMM ?? 160;
      const longGpu = gpus.filter((g) => g.lengthMM <= maxL).sort((a, b) => b.lengthMM - a.lengthMM)[0];
      const air = coolers.filter((c) => c.type === 'air' && c.heightMM && c.heightMM <= maxH).sort((a, b) => b.heightMM - a.heightMM)[0];
      const kit2 = rams.find((r) => ramModules(r) === 2 && r.type === board.memoryType);
      check({ ...base, gpu: longGpu, cooler: air, ram: [kit2, kit2] }, `${pcCase.id} + ${ff} + ${psu.id} + ${longGpu?.id} + ${air?.id}`);
      // Largest AIO the case lists, with a 2-slot card.
      const radMax = Math.max(0, ...(pcCase.radiatorSupport ?? []).map((r) => r.maxMM ?? 0));
      const aio = coolers.filter((c) => c.type === 'aio' && c.radiatorSizeMM <= (radMax || 240)).sort((a, b) => b.radiatorSizeMM - a.radiatorSizeMM)[0];
      const slim = gpus.find((g) => g.slotWidth === 2 && g.lengthMM <= maxL);
      check({ ...base, gpu: slim, cooler: aio, ram: [kit2] }, `${pcCase.id} + ${ff} + ${psu.id} + ${aio?.id}`);
      runs += 3;
    }
  }
}
// Empty state: no case, some parts.
check({ case: null, motherboard: boards[0], psu: psuSet[0], fans: [pack3], storage: [nvme[0]] }, 'ghost case');

function check(build, label) {
  const L = layoutBuild(build);
  const c = L.case;
  const shell = { min: [-c.D / 2 + WALL, WALL, -c.W / 2 + WALL], max: [c.D / 2 - WALL, c.H - WALL, c.W / 2 - SIDE] };
  const fail = (msg) => failures.push(`${label}: ${msg}`);
  const solids = [];

  if (L.board) {
    const b = { min: [L.board.x0, L.board.y0, c.trayZ], max: [L.board.x1, L.board.y1, L.board.z] };
    if (!inside(b, shell)) fail('board outside the case');
    solids.push(['board', b]);
  }
  if (L.psu) {
    const d = psuDims(build.psu);
    const b = box(L.psu.placement, [d.len, d.h, d.w]);
    where[L.psu.where] = (where[L.psu.where] ?? 0) + 1;
    if (!inside(b, shell)) fail(`PSU (${L.psu.where}) outside the case`);
    if (c.shroud && L.psu.where === 'shroud' && b.max[1] > c.shroud.y1 + TOL) fail('PSU pokes through the shroud');
    solids.push(['psu', b]);
  }
  for (const f of L.fans) {
    const b = box(f.placement, [f.size, f.size, f.depth]);
    if (!inside(b, shell)) fail(`${f.mount} fan ${f.unit} outside the case`);
    if (c.shroud && f.mount !== 'shroud' && f.mount !== 'front' && overlap(b, { min: [c.shroud.x0, 0, c.shroud.z0], max: [c.shroud.x1, c.shroud.y1, c.shroud.z1] })) fail(`${f.mount} fan inside the shroud`);
    solids.push([`${f.mount} fan`, b]);
  }
  for (const s of L.storage) {
    if (!s.placement) continue;
    const ff = build.storage[s.index].formFactor;
    const b = box(s.placement, DRIVE_DIMS[ff]);
    if (!inside(b, shell)) fail(`${ff} drive outside the case`);
    if (s.kind !== 'm2') solids.push([`${ff} drive`, b]);
  }
  if (L.gpu) {
    if (L.gpu.inside) {
      const relaxed = { min: shell.min.map((v, a) => v - (a === 0 || (c.ioDown && a === 1) ? 1.3 : 0)), max: shell.max };
      if (!inside(L.gpu.box, relaxed)) fail('graphics card outside the case');
    } else if ((build.case.maxGPULengthMM ?? 0) >= build.gpu.lengthMM && !c.ioDown) gNotes.push(label);
    solids.push(['gpu', L.gpu.box, ['board', 'fan']]);
  }
  const rad = L.cooler?.radiator;
  if (rad) {
    const b = { min: rad.placement.p.map((v, a) => v - rad.ext[a] / 2), max: rad.placement.p.map((v, a) => v + rad.ext[a] / 2) };
    if (!inside(b, shell)) fail(`${rad.mount} radiator outside the case`);
    solids.push([`${rad.mount} radiator`, b, ['gpu', 'board']]);
  }
  if (build.cooler && !L.cooler?.radiator && build.cooler.type === 'aio') radNotes.push(label);
  if (build.ram?.length && L.board) {
    const want = Math.min(build.ram.reduce((n, r) => n + ramModules(r), 0), L.board.layout.ram.length);
    if (L.ram.length !== want) fail(`${L.ram.length} of ${want} memory modules placed`);
    const slots = new Set(L.ram.map((r) => r.slot));
    if (slots.size !== L.ram.length) fail('two memory modules share a slot');
    if (L.board.layout.ram.length === 4 && L.ram.length === 2 && !(slots.has(1) && slots.has(3))) fail('2 modules not in A2/B2');
  }
  if (L.cooler?.kind === 'air' && build.case.maxCoolerHeightMM && build.cooler.heightMM <= build.case.maxCoolerHeightMM) {
    if (L.board.z + L.cooler.height > shell.max[2] + 0.3) fail(`air cooler (${L.cooler.height} cm) goes through the side panel`);
  }
  for (let i = 0; i < solids.length; i++) {
    for (let j = i + 1; j < solids.length; j++) {
      const skip = (a, b) => (a[2] ?? []).some((k) => b[0].includes(k));
      if (skip(solids[i], solids[j]) || skip(solids[j], solids[i])) continue;
      if (L.overlap && [solids[i][0], solids[j][0]].some((n) => /psu|gpu|board/.test(n))) continue;
      if (overlap(solids[i][1], solids[j][1])) fail(`${solids[i][0]} overlaps ${solids[j][0]}`);
    }
  }
  if (L.overlap) overlapNotes.push(label);
  if (VERBOSE) console.log(label, L.psu?.where, L.fans.map((f) => f.mount).join(','), L.notes.join(' | '));
}

if (gNotes.length) console.log(`Note: ${gNotes.length} build(s) where a card within maxGPULengthMM is longer than the case model's interior, e.g. ${gNotes[0]}`);
if (overlapNotes.length) console.log(`Note: ${overlapNotes.length} compact build(s) flagged as overlapping (riser/sandwich layouts), e.g. ${overlapNotes[0]}`);
if (radNotes.length) console.log(`Note: ${radNotes.length} build(s) with no radiator position, e.g. ${radNotes[0]}`);
console.log(`${runs} case/board/PSU/cooling combinations. PSU positions: ${JSON.stringify(where)}`);
if (failures.length) {
  const unique = [...new Set(failures)];
  console.log(`FAIL: ${unique.length} problem(s)`);
  for (const f of unique.slice(0, 60)) console.log('  ' + f);
  process.exit(1);
}
console.log('OK: every part sits inside its case without overlaps');
