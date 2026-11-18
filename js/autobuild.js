// Auto-fill: pick the build with the best estimated performance for a use within a budget.
// Pure (no DOM), so tools/test-autobuild.mjs can run it in Node.
//
// 1. Score every CPU + GPU pair (and CPU-only for iGPU builds) with perf.js, using the
//    RAM and storage the plan calls for. Drop pairs whose cheapest possible build is over
//    budget, and unbalanced pairs (CPU tier more than two steps below the GPU tier).
// 2. Walk pairs from best score down. For each, add the cheapest compatible board + RAM,
//    drive, case + cooler and PSU. Parts with "serious" issues (any warning, an entry
//    board under a hot CPU, an under-rated cooler) are avoided first; if that build is
//    over budget it is retried allowing them. Within that, price wins, with penalties
//    for unconfirmed specs and unverified parts (see `rank`). Builds are compared on
//    score minus SERIOUS_COST per serious issue; within SCORE_TOLERANCE the cheapest wins.
// 3. Spend leftover budget on the plan's upgrades (more RAM, bigger drive) when they fit.
// Every result is checked with checkBuild(); a build with any error is never returned.
import { checkBuild, isPartCompatible, summarize, estimateDraw } from './compat.js?v=fe48996dc3';
import { estimatePerformance } from './perf.js?v=fe48996dc3';
import { priceBuild, formatTHB } from './pricing.js?v=fe48996dc3';
import { emptyBuild } from './state.js?v=fe48996dc3';

const SCORE_TOLERANCE = 1; // points: no paying for a 1-point gain
// A serious issue (warning, weak board or cooler) costs this many score points when
// builds are compared, so a clean build beats a slightly faster risky one.
const SERIOUS_COST = 4;
const MAX_ATTEMPTS = 60;

// Gaming weighs 1080p and 1440p most: that is where most budgets in the catalogue land.
export const USES = Object.freeze({
  gaming: {
    label: 'Gaming',
    score: (s) => 0.5 * s.gaming1080 + 0.35 * s.gaming1440 + 0.15 * s.gaming4k,
    scoreLabel: 'gaming (1080p 50%, 1440p 35%, 4K 15%)',
    ramGB: (b) => (b < 30000 ? 16 : 32),
    storageGB: (b) => (b < 60000 ? 1000 : 2000),
  },
  creator: {
    label: 'Creator',
    score: (s) => s.video,
    scoreLabel: 'video editing',
    ramGB: (b) => (b < 40000 ? 16 : b < 90000 ? 32 : 64),
    storageGB: (b) => (b < 40000 ? 1000 : 2000),
  },
  office: {
    label: 'Office',
    score: (s) => s.general,
    scoreLabel: 'general use',
    ramGB: () => 16,
    storageGB: () => 1000,
  },
  ai: {
    label: 'AI / compute',
    score: (s) => s.ai,
    scoreLabel: 'AI / compute',
    ramGB: (b) => (b < 35000 ? 16 : b < 80000 ? 32 : 64),
    storageGB: (b) => (b < 60000 ? 1000 : 2000),
  },
});

export const SIZES = Object.freeze({
  full: { label: 'Full size', caseTypes: ['mid-tower', 'full-tower'], boards: ['E-ATX', 'ATX', 'mATX', 'ITX'] },
  compact: { label: 'Compact', caseTypes: ['itx', 'matx'], boards: ['mATX', 'ITX'] },
});

const price = (p) => p?.refPriceTHB ?? 0;
const byPrice = (a, b) => price(a) - price(b);
const isUnknownNote = (i) => i.level === 'info' && i.message.startsWith("Can't confirm");

// Price penalty per issue involving a candidate. A spec the checker can't confirm
// needs the part to be a third cheaper to win. A few notes count too.
const PENALTY = {
  warn: 1.0,
  unknown: 0.5,
  'chipset-power': 0.4, // entry board under a high-power CPU
  'cooler-capacity': 0.3, // cooler rated below the CPU's peak power
  'gpu-power': 0.1, // 16-pin card on an adapter
  'psu-atx3': 0.1,
};
const UNVERIFIED = 0.3;
// Issues avoided whenever the budget allows: counted, and compared before price.
const SERIOUS_NOTES = new Set(['chipset-power', 'cooler-capacity']);

// Auto-fill only picks graphics cards whose length and power figures are known:
// the PSU and case choices depend on them.
const gpuUsable = (g) => g.lengthMM != null && g.tdp != null && Array.isArray(g.powerConnectors);
// Stock coolers are only trusted on low-power CPUs (peak draw at or under 90 W).
const BOXED_MAX_W = 90;
const TIERS = ['budget', 'mid', 'high', 'flagship'];
const balanced = (cpu, gpu) => !gpu || TIERS.indexOf(gpu.tier) - TIERS.indexOf(cpu.tier) <= 2;

// Effective cost of a candidate in the current partial build, or null if incompatible.
function rank(part, build, mode) {
  const r = isPartCompatible(part, build, { mode });
  if (!r.ok) return null;
  let factor = part.specsVerified ? 1 : 1 + UNVERIFIED;
  let serious = 0;
  for (const i of r.issues) {
    if (i.level === 'warn') {
      factor += PENALTY.warn;
      serious++;
    } else if (isUnknownNote(i)) {
      factor += PENALTY.unknown;
    } else {
      factor += PENALTY[i.rule] ?? 0;
      if (SERIOUS_NOTES.has(i.rule)) serious++;
    }
  }
  return { part, cost: price(part) * factor, serious };
}

// strict: fewer serious issues beats a lower price.
const isBetter = (a, b, strict) => !b || (strict && a.serious !== b.serious ? a.serious < b.serious : a.cost < b.cost);
// Lists are price-sorted and every factor is >= 1, so the scan can stop once the raw
// price passes the best effective cost (and, when strict, the best is clean).
const canStop = (best, rawPrice, strict) => best && (!strict || best.serious === 0) && rawPrice > best.cost;

function cheapest(list, build, mode, strict) {
  let best = null;
  for (const p of list) {
    if (canStop(best, price(p), strict)) break;
    const r = rank(p, build, mode);
    if (r && isBetter(r, best, strict)) best = r;
  }
  return best;
}

export function autoBuild(catalog, { budget, use = 'gaming', size = 'full' }) {
  const t0 = Date.now();
  const U = USES[use];
  const S = SIZES[size];
  if (!U || !S) throw new Error(`Unknown use "${use}" or size "${size}"`);
  const plan = { ramGB: U.ramGB(budget), storageGB: U.storageGB(budget) };

  const lists = {};
  for (const c of ['cpu', 'motherboard', 'ram', 'gpu', 'storage', 'psu', 'case', 'cooler']) lists[c] = [...catalog.list(c)].sort(byPrice);
  const cases = lists.case.filter((c) => S.caseTypes.includes(c.caseType));

  // Cheapest two-module kit of a type and capacity.
  const kitCache = new Map();
  const kitFor = (type, gb) => {
    const k = `${type}:${gb}`;
    if (!kitCache.has(k)) kitCache.set(k, lists.ram.find((r) => r.type === type && r.capacityGB === gb && r.modules === 2) ?? null);
    return kitCache.get(k);
  };
  const driveFor = (gb) => lists.storage.filter((d) => d.type === 'nvme' && d.capacityGB >= gb);
  const boardsFor = (cpu) => lists.motherboard.filter((m) => m.socket === cpu.socket && cpu.memoryType.includes(m.memoryType) && S.boards.includes(m.formFactor));
  const boxedOk = (cpu) => cpu.coolerIncluded === true && (cpu.maxPowerW ?? cpu.tdp) <= BOXED_MAX_W;

  // Lower bounds, for pruning pairs that can never fit the budget.
  const platformCache = new Map();
  const platformFloor = (cpu, gb) => {
    const k = `${cpu.socket}:${cpu.memoryType.join()}:${gb}`;
    if (!platformCache.has(k)) {
      const costs = boardsFor(cpu).map((m) => (kitFor(m.memoryType, gb) ? price(m) + price(kitFor(m.memoryType, gb)) : Infinity));
      platformCache.set(k, Math.min(Infinity, ...costs));
    }
    return platformCache.get(k);
  };
  const floorFixed = price(driveFor(plan.storageGB)[0]) + price(cases[0]) + price(lists.psu[0]);
  const coolerFloor = (cpu) => (boxedOk(cpu) ? 0 : price(lists.cooler.find((k) => k.socketsSupported.includes(cpu.socket))));

  // ---- 1. score pairs
  const gpus = [null, ...lists.gpu.filter(gpuUsable)];
  const pairs = [];
  for (const cpu of lists.cpu) {
    const plat = platformFloor(cpu, plan.ramGB);
    if (!Number.isFinite(plat)) continue;
    const kit = kitFor(cpu.memoryType.includes('DDR5') ? 'DDR5' : 'DDR4', plan.ramGB) ?? kitFor(cpu.memoryType[0], plan.ramGB);
    for (const gpu of gpus) {
      if ((!gpu && !cpu.igpu) || !balanced(cpu, gpu)) continue;
      const floor = price(cpu) + price(gpu) + plat + floorFixed + coolerFloor(cpu);
      if (floor > budget) continue;
      const perf = estimatePerformance({ cpu, gpu, ram: kit ? [kit] : [], storage: driveFor(plan.storageGB).slice(0, 1) });
      const s = U.score(perf.scores);
      if (s === null || Number.isNaN(s)) continue;
      pairs.push({ cpu, gpu, score: s, floor });
    }
  }
  pairs.sort((a, b) => b.score - a.score || a.floor - b.floor);

  // ---- 2. assemble
  const fit = (pair, p) => {
    const clean = assemble(pair, p, true);
    return clean && clean.total <= budget ? clean : assemble(pair, p, false);
  };
  let best = null;
  let attempts = 0;
  for (const pair of pairs) {
    // A pair can never beat the best on adjusted score once its raw score is lower.
    if (best && pair.score < best.adjusted - SCORE_TOLERANCE) break;
    if (++attempts > MAX_ATTEMPTS) break;
    const built = fit(pair, plan);
    if (!built || built.total > budget) continue;
    const cand = { ...built, pairScore: pair.score, adjusted: pair.score - SERIOUS_COST * built.serious };
    if (!best || cand.adjusted > best.adjusted + SCORE_TOLERANCE
      || (cand.adjusted >= best.adjusted - SCORE_TOLERANCE && cand.total < best.total)) best = cand;
  }

  if (!best) {
    return {
      ok: false, budget, use, size, plan, pairsConsidered: pairs.length, ms: Date.now() - t0,
      message: pairs.length
        ? `No compatible ${S.label.toLowerCase()} ${U.label.toLowerCase()} build fits ${formatTHB(budget)}. Try a higher budget.`
        : `The cheapest possible ${S.label.toLowerCase()} build for ${U.label.toLowerCase()} costs more than ${formatTHB(budget)}.`,
    };
  }

  // ---- 3. upgrades with leftover budget (never at the cost of a clean build)
  const upgrades = [];
  for (const step of upgradeSteps(use)) {
    const next = step.apply(plan);
    if (!next) continue;
    const trial = fit({ cpu: best.build.cpu, gpu: best.build.gpu }, next);
    if (trial && trial.total <= budget && trial.serious <= best.serious) {
      upgrades.push(step.label(next));
      best = { ...trial, pairScore: best.pairScore, adjusted: best.adjusted };
      Object.assign(plan, next);
    }
  }

  const perf = estimatePerformance(best.build);
  const issues = checkBuild(best.build);
  return {
    ok: true,
    budget, use, size, plan,
    build: best.build,
    total: best.total,
    reasons: explain(best, pairs, { U, S, plan, budget, upgrades, perf }),
    perf,
    score: Math.round(U.score(perf.scores)),
    issues,
    summary: summarize(issues),
    pairsConsidered: pairs.length,
    attempts,
    ms: Date.now() - t0,
  };

  // The cheapest compatible machine around a CPU + GPU, or null.
  function assemble({ cpu, gpu }, p, strict) {
    const b = emptyBuild();
    b.cpu = cpu;
    b.gpu = gpu;

    // Board and RAM together: the board decides the memory type.
    let board = null;
    for (const m of boardsFor(cpu)) {
      const kit = kitFor(m.memoryType, p.ramGB);
      if (!kit) continue;
      if (canStop(board, price(m) + price(kit), strict)) break;
      const r = rank(m, b);
      if (!r) continue;
      const cand = { ...r, cost: r.cost + price(kit), kit };
      if (isBetter(cand, board, strict)) board = cand;
    }
    if (!board) return null;
    b.motherboard = board.part;
    b.ram = [board.kit];

    const drive = cheapest(driveFor(p.storageGB), b, 'add', strict);
    if (!drive) return null;
    b.storage = [drive.part];

    // Case and cooler together: the case limits cooler height and radiator size.
    // A boxed cooler only counts outside ITX cases (its height isn't in the data).
    let shell = null;
    for (const c of cases) {
      if (canStop(shell, price(c), strict)) break;
      const rc = rank(c, b);
      if (!rc) continue;
      let cooler;
      if (boxedOk(cpu) && c.caseType !== 'itx') cooler = { part: null, cost: 0, serious: 0 };
      else cooler = cheapest(lists.cooler.filter((k) => k.socketsSupported.includes(cpu.socket)), { ...b, case: c }, undefined, strict);
      if (!cooler) continue;
      const cand = { pcCase: c, cooler: cooler.part, cost: rc.cost + cooler.cost, serious: rc.serious + cooler.serious };
      if (isBetter(cand, shell, strict)) shell = cand;
    }
    if (!shell) return null;
    b.case = shell.pcCase;
    b.cooler = shell.cooler;

    const psu = cheapest(lists.psu, b, undefined, strict);
    if (!psu) return null;
    b.psu = psu.part;

    const issues = checkBuild(b);
    if (summarize(issues).error) return null; // belt and braces
    return {
      build: b,
      total: priceBuild(b).total,
      serious: board.serious + drive.serious + shell.serious + psu.serious,
      boardClean: board.serious === 0,
    };
  }
}

// Applied in order; each returns the next plan, or null when it doesn't apply.
function upgradeSteps(use) {
  const ramMax = use === 'office' ? 16 : use === 'gaming' ? 32 : 64;
  return [
    { label: (p) => `memory raised to ${p.ramGB} GB`, apply: (p) => (p.ramGB < ramMax ? { ...p, ramGB: p.ramGB * 2 } : null) },
    { label: () => 'storage raised to 2 TB', apply: (p) => (use !== 'office' && p.storageGB < 2000 ? { ...p, storageGB: 2000 } : null) },
  ];
}

const capacity = (gb) => (gb >= 1000 ? `${gb / 1000} TB` : `${gb} GB`);

// One plain sentence or two per chosen part.
function explain(best, pairs, { U, S, plan, budget, upgrades, perf }) {
  const { build: b } = best;
  const r = {};
  const score = Math.round(U.score(perf.scores));
  const stronger = pairs.filter((p) => p.score > best.pairScore + SCORE_TOLERANCE);
  const stepUp = stronger.length ? Math.min(...stronger.map((p) => p.floor)) - best.total : null;

  r.cpu = `Best ${U.scoreLabel} estimate (${score}/100) of ${pairs.length} CPU and graphics combinations that could fit ${formatTHB(budget)}.`
    + (stepUp > 0 ? ` A higher-scoring pair needs at least ${formatTHB(stepUp)} more.` : '');
  r.gpu = b.gpu
    ? `Strongest card to pair with ${b.cpu.name} in budget. ${perf.bottleneck.primary ?? ''}`.trim()
    : `No graphics card: ${b.cpu.name} has integrated graphics, and a card would not raise the ${U.scoreLabel} estimate enough to pay for itself.`;
  r.motherboard = best.boardClean
    ? `Cheapest ${b.motherboard.socket} ${b.motherboard.formFactor} board with no BIOS-update warning and enough power delivery for this CPU; ${b.motherboard.memoryType} memory.`
    : `Cheapest ${b.motherboard.socket} ${b.motherboard.formFactor} board that fits the budget; see its note in the issues list.`;
  r.ram = `${plan.ramGB} GB suits ${U.label.toLowerCase()} at this budget; cheapest two-module ${b.ram[0].type} kit of that size (dual channel).`;
  r.storage = `Cheapest NVMe SSD of ${capacity(plan.storageGB)} or more.`;
  r.case = `Cheapest ${S.label.toLowerCase()} case (${S.caseTypes.join(' / ')}) that takes the ${b.motherboard.formFactor} board${b.gpu ? ` and the ${b.gpu.lengthMM} mm card` : ''}.`;
  r.cooler = b.cooler
    ? `Cheapest cooler that fits ${b.case.name} and handles the CPU's ${b.cpu.maxPowerW ?? b.cpu.tdp} W peak.`
    : `Boxed cooler: ${b.cpu.name} ships with one and peaks at ${b.cpu.maxPowerW ?? b.cpu.tdp} W, which it handles.`;
  const draw = estimateDraw(b);
  r.psu = `Cheapest ${b.psu.formFactor} unit that covers the estimated ${draw.watts} W peak with 30% headroom${b.gpu ? ' and has the plugs the card needs' : ''}.`;
  if (upgrades.length) r.upgrades = `Leftover budget: ${upgrades.join(', ')}.`;
  return r;
}
