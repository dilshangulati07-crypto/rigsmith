// Build pricing from refPriceTHB. These are hand-entered reference prices, never live:
// every result carries `note` and the UI must show it next to any price.
import { CONFIG } from './config.js?v=00a22f4faf';
import { CATEGORIES } from './categories.js?v=00a22f4faf';
import { estimatePerformance, WORKLOADS } from './perf.js?v=00a22f4faf';

export const PRICE_NOTE = CONFIG.priceNote; // 'Reference price, not live'

const fmt = new Intl.NumberFormat('th-TH', { style: 'currency', currency: CONFIG.currency, maximumFractionDigits: 0 });
export const formatTHB = (n) => fmt.format(n);

export function priceBuild(build) {
  const byCategory = {};
  let total = 0;
  let oldest = null;
  for (const c of CATEGORIES) {
    const v = build[c.id];
    const items = Array.isArray(v) ? v : v ? [v] : [];
    const subtotal = items.reduce((s, p) => s + (p.refPriceTHB ?? 0), 0);
    byCategory[c.id] = { label: c.label, count: items.length, subtotal };
    total += subtotal;
    for (const p of items) if (p.priceUpdated && (!oldest || p.priceUpdated < oldest)) oldest = p.priceUpdated;
  }
  return { currency: CONFIG.currency, note: PRICE_NOTE, total, byCategory, priceUpdated: oldest };
}

// Whole-build price per estimated performance point, per workload.
// thbPerPoint: lower is better. pointsPer10k: higher is better.
export function pricePerPerformance(build, perf = estimatePerformance(build)) {
  const { total } = priceBuild(build);
  const out = {};
  for (const w of WORKLOADS) {
    const s = perf.scores[w.id];
    out[w.id] = {
      label: w.label,
      score: s,
      thbPerPoint: s ? Math.round(total / s) : null,
      pointsPer10k: s && total ? Math.round((s / total) * 10000 * 10) / 10 : null,
    };
  }
  return { note: `${PRICE_NOTE}; performance is an estimate`, total, workloads: out };
}
