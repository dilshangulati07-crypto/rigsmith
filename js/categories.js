// Part categories: the one list every module reads. Adding a part type = one entry here
// plus data/parts/<id>.json (and, later, a model module in js/scene/).
//   multiple:  the build holds an array (several kits, drives, fan packs)
//   essential: the PC cannot run without it (cooler is handled separately: boxed coolers exist)
//   pickMode:  what choosing a part from the catalogue does to an array slot
export const CATEGORIES = Object.freeze([
  { id: 'cpu', label: 'Processor', short: 'CPU', multiple: false, essential: true },
  { id: 'motherboard', label: 'Motherboard', short: 'Board', multiple: false, essential: true },
  { id: 'ram', label: 'Memory', short: 'RAM', multiple: true, essential: true, pickMode: 'replace' },
  { id: 'gpu', label: 'Graphics card', short: 'GPU', multiple: false, essential: false },
  { id: 'storage', label: 'Storage', short: 'Storage', multiple: true, essential: true, pickMode: 'add' },
  { id: 'psu', label: 'Power supply', short: 'PSU', multiple: false, essential: true },
  { id: 'case', label: 'Case', short: 'Case', multiple: false, essential: true },
  { id: 'cooler', label: 'CPU cooler', short: 'Cooler', multiple: false, essential: false },
  { id: 'fans', label: 'Case fans', short: 'Fans', multiple: true, essential: false, pickMode: 'add' },
].map(Object.freeze));

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function getCategory(id) {
  const c = BY_ID.get(id);
  if (!c) throw new Error(`Unknown part category "${id}"`);
  return c;
}

export const isCategory = (id) => BY_ID.has(id);
