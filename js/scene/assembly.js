// Install plan for "Build by hand" (and later the auto-build cinematic): which pieces go in,
// in which real-life order, where each one snaps, and which wrong spots to warn about.
// Every target comes from layoutBuild() of the whole build, so a hand-built PC ends up exactly
// where the viewer draws it. Pure (no three.js) so tools/test-assembly.mjs can run it in Node.
//
// piece:  one thing that snaps into one place (a RAM stick, one fan of a pack, the GPU)
// group:  one tray item: identical pieces of one part in one stage (a 2-stick kit, a 3-fan pack)
// stage:  a step of the real install order; a stage opens once every earlier stage is done
import { layoutBuild, m2Placement } from './layout.js?v=00a22f4faf';
import { ramSlotNames, ramSlotPlacement, pcieSlotPlacement } from './layout-board.js?v=00a22f4faf';
import { Z } from './layout-math.js?v=00a22f4faf';
import { checkBuild } from '../compat.js?v=00a22f4faf';
import { INCOMPLETE_RULES } from '../compat/essentials.js?v=00a22f4faf';

export const STAGES = Object.freeze([
  { id: 'prep', label: 'Standoffs and I/O shield', short: 'Prep', need: 'standoffs and I/O shield' },
  { id: 'psu', label: 'Power supply', short: 'PSU', need: 'power supply' },
  { id: 'motherboard', label: 'Motherboard', short: 'Board', need: 'motherboard' },
  { id: 'cpu', label: 'Processor', short: 'CPU', need: 'processor' },
  { id: 'radiator', label: 'Radiator', short: 'Radiator', need: 'radiator' },
  { id: 'cooler', label: 'CPU cooler', short: 'Cooler', need: 'CPU cooler' },
  { id: 'ram', label: 'Memory', short: 'RAM', need: 'memory' },
  { id: 'm2', label: 'M.2 drives', short: 'M.2', need: 'M.2 drives' },
  { id: 'sata', label: 'SATA drives', short: 'SATA', need: 'SATA drives' },
  { id: 'gpu', label: 'Graphics card', short: 'GPU', need: 'graphics card' },
  { id: 'fans', label: 'Case fans', short: 'Fans', need: 'case fans' },
].map(Object.freeze));
const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s.id, i]));

// What a stage physically sits on. When a part is swapped out mid-build, anything that
// depends on it comes out too (a new board means the CPU, memory and cards come off).
const NEEDS = { motherboard: ['prep'], cpu: ['motherboard'], cooler: ['cpu', 'radiator'], ram: ['motherboard'], m2: ['motherboard'], gpu: ['motherboard'] };

const UNIT_NAMES = { ram: ['stick', 'sticks'], fans: ['fan', 'fans'] };

/** Category order of the 3D models; the case is built first. */
export const MODEL_CATEGORIES = Object.freeze(['case', 'motherboard', 'cpu', 'cooler', 'ram', 'gpu', 'psu', 'storage', 'fans']);

/**
 * One entry per chosen part, keyed so a part keeps its key (and its 3D model) when other
 * parts change. Shared with build-scene.js.
 */
export function partSlots(build, categories = MODEL_CATEGORIES) {
  const out = [];
  for (const category of categories) {
    const v = build[category];
    if (Array.isArray(v)) {
      const seen = {};
      v.forEach((part, index) => {
        seen[part.id] = (seen[part.id] ?? 0) + 1;
        out.push({ key: `${category}:${part.id}:${seen[part.id]}`, category, part, index });
      });
    } else if (v) out.push({ key: `${category}:${v.id}`, category, part: v, index: 0 });
  }
  return out;
}

/** Key of one placed piece: the part's slot key, plus the unit for multi-unit models. */
export const pieceKey = (slotKey, unit) => (unit === null || unit === undefined ? slotKey : `${slotKey}/${unit}`);

function stageOf(category, unit, part) {
  if (category === 'cooler') return part.type === 'aio' && unit === 1 ? 'radiator' : 'cooler';
  if (category === 'storage') return part.formFactor === 'M.2 2280' ? 'm2' : 'sata';
  return category;
}

function groupDetail(stage, part, n) {
  if (stage === 'radiator') return `${part.radiatorSizeMM ?? ''} mm radiator with fans`.trim();
  if (stage === 'cooler' && part.type === 'aio') return 'Pump block';
  if (stage === 'prep') return `For a ${part} board`;
  const names = UNIT_NAMES[stage];
  if (names) return `${n} ${n === 1 ? names[0] : names[1]}`;
  if (n > 1) return `${n} drives`;
  return null;
}

/**
 * @param {object} build the whole build (every part that will go in)
 * @param {object} [layout] layoutBuild(build), if the caller already has it
 */
export function planAssembly(build, layout = layoutBuild(build)) {
  const plan = { ready: !!build.case, reason: null, caseId: build.case?.id ?? null, groups: [], pieces: new Map(), skipped: [], stages: [], layout };
  if (!build.case) {
    plan.reason = 'Choose a case to start building by hand.';
    return plan;
  }
  const slots = partSlots(build);
  const slotAt = new Map(slots.map((s) => [`${s.category}|${s.index}`, s]));
  const groups = new Map();
  const addPiece = (piece, groupKey, groupInit) => {
    let g = groups.get(groupKey);
    if (!g) {
      g = { key: groupKey, pieces: [], decoys: [], ...groupInit };
      groups.set(groupKey, g);
    }
    piece.group = groupKey;
    g.pieces.push(piece.key);
    plan.pieces.set(piece.key, piece);
  };

  // Standoffs and I/O shield: in the case before the board, for the board's size.
  const board = layout.board;
  if (board) {
    const ff = board.ff;
    addPiece({ key: `prep:${ff}`, stage: 'prep', category: 'prep', index: 0, unit: null, slotKey: null, placement: null, explode: Z, dist: 6 },
      'prep', { stage: 'prep', category: 'prep', part: null, label: 'Standoffs and I/O shield', detail: groupDetail('prep', ff), formFactor: ff });
  }

  const placed = new Set();
  for (const it of layout.items) {
    const slot = slotAt.get(`${it.category}|${it.index}`);
    if (!slot || !it.placement) continue;
    const stage = stageOf(it.category, it.unit, slot.part);
    const key = pieceKey(slot.key, it.unit);
    placed.add(slot.key);
    addPiece({ key, stage, category: it.category, index: it.index, unit: it.unit, slotKey: slot.key, placement: it.placement, explode: it.explode ?? Z, dist: it.dist ?? 6 },
      `${it.category}:${slot.part.id}:${stage}`, { stage, category: it.category, part: slot.part, label: slot.part.name });
  }
  for (const s of slots) {
    if (s.category === 'case' || placed.has(s.key)) continue;
    plan.skipped.push({ category: s.category, part: s.part, reason: 'No free mount for it in this case model, so it is left out of the install.' });
  }

  plan.groups = [...groups.values()].sort((a, b) => STAGE_INDEX[a.stage] - STAGE_INDEX[b.stage]);
  for (const g of plan.groups) {
    if (g.stage !== 'prep') g.detail = groupDetail(g.stage, g.part, g.pieces.length);
    g.decoys = board ? decoysFor(g, layout) : [];
  }
  plan.stages = STAGES.filter((s) => plan.groups.some((g) => g.stage === s.id));
  return plan;
}

// Wrong but tempting spots: free memory slots outside the fill order, the lower PCIe slots,
// M.2 slots out of order. Dropping there is refused with the reason.
function decoysFor(group, layout) {
  const { board } = layout;
  const f = board.frame;
  const bl = board.layout;
  const out = [];
  if (group.stage === 'ram') {
    const used = new Set(layout.ram.map((r) => r.slot));
    const names = ramSlotNames(bl.ram.length);
    const order = layout.ram.map((r) => names[r.slot]);
    const n = layout.ram.length;
    bl.ram.forEach((s, i) => {
      if (used.has(i)) return;
      out.push({ id: `ram-slot-${i}`, name: names[i], placement: ramSlotPlacement(f, s),
        reason: `Use ${order.join(' and ')} first: that is this board's fill order for ${n} stick${n > 1 ? 's' : ''}.` });
    });
  }
  if (group.stage === 'gpu' && layout.gpu) {
    for (const s of bl.pcie) {
      if (s === layout.gpu.slot) continue;
      out.push({ id: `pcie-${s.k}`, name: `PCIe ${s.size}`, placement: pcieSlotPlacement(f, s),
        reason: s.size === 'x16'
          ? 'Use the top x16 slot: it is the one wired to the CPU with all 16 lanes.'
          : `That is an ${s.size} slot. The card goes in the top x16 slot.` });
    }
  }
  if (group.stage === 'm2') {
    const used = new Set(layout.storage.filter((s) => s.kind === 'm2').map((s) => s.slot));
    bl.m2.forEach((s, i) => {
      if (used.has(i) || s.back) return;
      out.push({ id: `m2-${i}`, name: `M.2 slot ${i + 1}`, placement: m2Placement(f, s),
        reason: 'Fill the M.2 slots in order, starting with the one nearest the CPU.' });
    });
  }
  return out;
}

// ---------------------------------------------------------------- progress queries
const stageDone = (plan, installed, stageId) => plan.groups.every((g) => g.stage !== stageId || g.pieces.every((k) => installed.has(k)));

/** First stage (in install order) that still has pieces to go in, or null when all are in. */
export function currentStage(plan, installed) {
  return plan.stages.find((s) => !stageDone(plan, installed, s.id)) ?? null;
}

/** Order check: { ok, reason }. A stage opens once every earlier stage is complete. */
export function canInstall(plan, installed, groupKey) {
  const g = plan.groups.find((x) => x.key === groupKey);
  if (!g) return { ok: false, reason: 'That part is not in this build.' };
  if (g.pieces.every((k) => installed.has(k))) return { ok: false, reason: 'Already installed.' };
  for (const s of plan.stages) {
    if (s.id === g.stage) break;
    if (!stageDone(plan, installed, s.id)) {
      if (g.stage === 'cooler' && s.id === 'radiator') return { ok: false, reason: 'Mount the radiator first, then the pump block.' };
      return { ok: false, reason: `Install the ${s.need} first.` };
    }
  }
  return { ok: true, reason: null };
}

/** The parts already in the case, as a build object (case always included). */
export function installedBuild(build, plan, installed) {
  const out = { case: build.case };
  for (const key of installed) {
    const p = plan.pieces.get(key);
    if (!p || p.category === 'prep') continue;
    const part = Array.isArray(build[p.category]) ? build[p.category][p.index] : build[p.category];
    if (!part) continue;
    if (Array.isArray(build[p.category])) {
      out[p.category] ??= [];
      out[p.category][p.index] = part;
    } else out[p.category] = part;
  }
  for (const [k, v] of Object.entries(out)) if (Array.isArray(v)) out[k] = v.filter(Boolean);
  return out;
}

/**
 * Compatibility check for putting a group's part in with what is already installed,
 * using compat.js. Returns { ok, reason, fix }.
 */
export function checkFit(build, plan, installed, groupKey) {
  const g = plan.groups.find((x) => x.key === groupKey);
  if (!g?.part) return { ok: true, reason: null, fix: null };
  const next = installedBuild(build, plan, installed);
  const cat = g.category;
  if (Array.isArray(build[cat])) {
    const index = plan.pieces.get(g.pieces[0]).index;
    if (!(next[cat] ?? []).includes(build[cat][index])) next[cat] = [...(next[cat] ?? []), build[cat][index]];
  } else next[cat] = g.part;
  const bad = checkBuild(next).find((i) => i.level === 'error' && i.parts.includes(g.part.id) && !INCOMPLETE_RULES.has(i.rule));
  return bad ? { ok: false, reason: bad.message, fix: bad.fix } : { ok: true, reason: null, fix: null };
}

/** Pieces of a group that are still to go in, in layout order. */
export const freePieces = (plan, installed, groupKey) => (plan.groups.find((g) => g.key === groupKey)?.pieces ?? []).filter((k) => !installed.has(k));

/**
 * Keep only installed keys that still exist in the plan and whose support is still there,
 * in order. Used after a part swap and when restoring saved progress.
 */
export function reconcile(plan, keys) {
  let kept = keys.filter((k, i) => plan.pieces.has(k) && keys.indexOf(k) === i);
  for (;;) {
    const set = new Set(kept);
    const next = kept.filter((k) => {
      const needs = NEEDS[plan.pieces.get(k).stage] ?? [];
      return needs.every((s) => stageDone(plan, set, s));
    });
    if (next.length === kept.length) return kept;
    kept = next;
  }
}

/** Summary for the progress bar: per stage { id, label, short, total, done, state }. */
export function progress(plan, installed) {
  const cur = currentStage(plan, installed);
  const stages = plan.stages.map((s) => {
    const keys = plan.groups.filter((g) => g.stage === s.id).flatMap((g) => g.pieces);
    const done = keys.filter((k) => installed.has(k)).length;
    return { ...s, total: keys.length, done, state: done === keys.length ? 'done' : s.id === cur?.id ? 'current' : 'todo' };
  });
  const total = stages.reduce((a, s) => a + s.total, 0);
  const done = stages.reduce((a, s) => a + s.done, 0);
  return { stages, total, done, current: cur, complete: plan.ready && total > 0 && done === total };
}
