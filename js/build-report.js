// Every headline number for one build, from the existing engines (compat, pricing, perf).
// Used by preset cards, compare.html, the printed spec sheet and the CSV export so they all
// show the same figures as the builder's summary.
import { CATEGORIES } from './categories.js?v=fe48996dc3';
import { checkBuild, summarize, estimateDraw, getVerification, PSU_HEADROOM } from './compat.js?v=fe48996dc3';
import { priceBuild, pricePerPerformance } from './pricing.js?v=fe48996dc3';
import { estimatePerformance, WORKLOADS } from './perf.js?v=fe48996dc3';
import { allParts } from './compat/util.js?v=fe48996dc3';

/** PSU load and headroom, worded the same way as the builder summary. */
export function psuHeadroom(build, draw = estimateDraw(build)) {
  const psu = build.psu;
  if (!psu || !draw.watts) return { wattage: psu?.wattage ?? null, pct: null, level: null, target: Math.round(draw.watts * PSU_HEADROOM) };
  const target = Math.round(draw.watts * PSU_HEADROOM);
  const pct = Math.round(((psu.wattage - draw.watts) / draw.watts) * 100);
  const level = draw.watts > psu.wattage ? 'error' : target > psu.wattage ? 'warn' : 'ok';
  return { wattage: psu.wattage, pct, level, target };
}

/** Case size: D × W × H in mm and the volume in litres (null when the case or its size is unknown). */
export function caseSize(pcCase) {
  const d = pcCase?.dimensionsMM;
  if (!d || !d.depth || !d.width || !d.height) return null;
  return { depth: d.depth, width: d.width, height: d.height, litres: Math.round((d.depth * d.width * d.height) / 1e5) / 10 };
}

export function buildReport(build) {
  const issues = checkBuild(build);
  const perf = estimatePerformance(build);
  const draw = estimateDraw(build);
  return {
    parts: allParts(build),
    price: priceBuild(build),
    perf,
    ppp: pricePerPerformance(build, perf),
    draw,
    psu: psuHeadroom(build, draw),
    size: caseSize(build.case),
    issues,
    counts: summarize(issues),
    verification: getVerification(build),
  };
}

/** Rows of the parts list: one per part (repeats folded into qty), in category order. */
export function partRows(build) {
  const rows = [];
  for (const c of CATEGORIES) {
    const v = build[c.id];
    const list = Array.isArray(v) ? v : v ? [v] : [];
    const seen = new Map();
    for (const p of list) {
      const r = seen.get(p.id);
      if (r) r.qty++;
      else {
        const row = { category: c, part: p, qty: 1 };
        seen.set(p.id, row);
        rows.push(row);
      }
    }
  }
  return rows;
}

export { WORKLOADS };
