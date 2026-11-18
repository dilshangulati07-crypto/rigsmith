// UI description of each part type. Every module has the same shape:
//   keySpecs(part) -> [[label, value]]   3-5 specs for a catalogue card
//   specs(part)    -> [[label, value]]   full spec table (null = not confirmed)
//   filters        -> [{ id, label, kind: 'select'|'min'|'max', get(part), format?(v) }]
//   sorts          -> [{ id, label, compare(a, b) }]
// A new part type adds one module here; the browser, drawer and list need no changes.
import cpu from './cpu.js?v=fe48996dc3';
import motherboard from './motherboard.js?v=fe48996dc3';
import ram from './ram.js?v=fe48996dc3';
import gpu from './gpu.js?v=fe48996dc3';
import storage from './storage.js?v=fe48996dc3';
import psu from './psu.js?v=fe48996dc3';
import pcCase from './case.js?v=fe48996dc3';
import cooler from './cooler.js?v=fe48996dc3';
import fans from './fans.js?v=fe48996dc3';

const TYPES = { cpu, motherboard, ram, gpu, storage, psu, case: pcCase, cooler, fans };

const FALLBACK = { keySpecs: () => [], specs: () => [], filters: [], sorts: [] };
export const partType = (category) => TYPES[category] ?? FALLBACK;

const TIER_ORDER = { budget: 0, mid: 1, high: 2, flagship: 3 };
const yesNo = (v) => (v === null || v === undefined ? null : v ? 'Yes' : 'No');

// Rows every part gets at the end of its spec table.
export const commonSpecs = (p) => [
  ['Brand', p.brand],
  ['Tier', p.tier],
  ['SKU', p.sku ?? null],
  ['Specs verified', yesNo(p.specsVerified)],
  ['Price updated', p.priceUpdated],
];

// Filters and sorts every category has.
export const COMMON_FILTERS = [
  { id: 'brand', label: 'Brand', kind: 'select', get: (p) => p.brand },
  { id: 'tier', label: 'Tier', kind: 'select', get: (p) => p.tier, order: Object.keys(TIER_ORDER) },
];
export const COMMON_SORTS = [
  { id: 'fit', label: 'Compatible first', compare: () => 0 },
  { id: 'price-asc', label: 'Price: low to high', compare: (a, b) => a.refPriceTHB - b.refPriceTHB },
  { id: 'price-desc', label: 'Price: high to low', compare: (a, b) => b.refPriceTHB - a.refPriceTHB },
  { id: 'tier', label: 'Tier: highest first', compare: (a, b) => TIER_ORDER[b.tier] - TIER_ORDER[a.tier] },
  { id: 'name', label: 'Name', compare: (a, b) => a.name.localeCompare(b.name) },
];
