// Parts catalogue: loads data/parts/*.json and looks parts up by id.
// createCatalog() is pure so Node tools can build one from files on disk.
import { CATEGORY_IDS } from './categories.js?v=5b4c14becb';

export function createCatalog(partsByCategory) {
  const byId = new Map();
  const lists = {};
  for (const cat of CATEGORY_IDS) {
    lists[cat] = Object.freeze([...(partsByCategory[cat] || [])]);
    for (const p of lists[cat]) byId.set(p.id, p);
  }
  return Object.freeze({
    get: (id) => byId.get(id) ?? null,
    list: (category) => lists[category] ?? [],
    get size() { return byId.size; },
  });
}

// Browser loader. `base` is relative to the page.
export async function loadCatalog({ base = 'data/parts/', fetchFn = globalThis.fetch } = {}) {
  const entries = await Promise.all(CATEGORY_IDS.map(async (cat) => {
    const res = await fetchFn(`${base}${cat}.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Could not load ${cat}.json (${res.status})`);
    const json = await res.json();
    return [cat, json.parts];
  }));
  return createCatalog(Object.fromEntries(entries));
}
