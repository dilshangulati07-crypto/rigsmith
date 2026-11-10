// The current build. The only place build state lives.
// Holds part objects in memory; saves part ids to localStorage and resolves them
// against the catalogue on load. Fires a 'change' event after every edit:
//   detail = { action: 'add'|'remove'|'replace'|'clear'|'load', category?, part?, previous? }
import { CATEGORIES, getCategory } from './categories.js';

const STORAGE_KEY = 'rigsmith.build.v1';
const SAVE_VERSION = 1;

export function emptyBuild() {
  return Object.fromEntries(CATEGORIES.map((c) => [c.id, c.multiple ? [] : null]));
}

// Copy so callers can't mutate state behind the store's back.
function snapshot(build) {
  return Object.fromEntries(Object.entries(build).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v]));
}

function browserStorage() {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    const probe = '__rigsmith_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null; // private mode, blocked cookies, or Node
  }
}

export class BuildStore extends EventTarget {
  #build = emptyBuild();
  #storage;
  #key;
  #autosave;

  constructor({ storage = browserStorage(), storageKey = STORAGE_KEY, autosave = true } = {}) {
    super();
    this.#storage = storage;
    this.#key = storageKey;
    this.#autosave = autosave;
  }

  get build() { return snapshot(this.#build); }

  get(category) {
    const v = this.#build[getCategory(category).id];
    return Array.isArray(v) ? [...v] : v;
  }

  // Single slot: replaces what is there. Array slot: appends.
  add(part) {
    const cat = getCategory(part?.category);
    if (cat.multiple) {
      this.#build[cat.id].push(part);
      this.#emit({ action: 'add', category: cat.id, part });
      return null;
    }
    const previous = this.#build[cat.id];
    this.#build[cat.id] = part;
    this.#emit({ action: previous ? 'replace' : 'add', category: cat.id, part, previous });
    return previous;
  }

  // Array slot: removes one copy of `id` (or everything when id is omitted).
  remove(category, id) {
    const cat = getCategory(category);
    if (!cat.multiple) {
      const previous = this.#build[cat.id];
      if (!previous || (id && previous.id !== id)) return false;
      this.#build[cat.id] = null;
      this.#emit({ action: 'remove', category: cat.id, previous });
      return true;
    }
    const list = this.#build[cat.id];
    if (id === undefined) {
      if (!list.length) return false;
      this.#build[cat.id] = [];
      this.#emit({ action: 'remove', category: cat.id, previous: list });
      return true;
    }
    const i = list.findIndex((p) => p.id === id);
    if (i < 0) return false;
    const [previous] = list.splice(i, 1);
    this.#emit({ action: 'remove', category: cat.id, previous });
    return true;
  }

  // Swap one part for another of the same category, keeping its place in an array.
  replace(oldId, part) {
    const cat = getCategory(part?.category);
    if (!cat.multiple) {
      if (this.#build[cat.id]?.id !== oldId) return false;
      this.add(part);
      return true;
    }
    const list = this.#build[cat.id];
    const i = list.findIndex((p) => p.id === oldId);
    if (i < 0) return false;
    const previous = list[i];
    list[i] = part;
    this.#emit({ action: 'replace', category: cat.id, part, previous });
    return true;
  }

  // Replace a whole slot at once (used by auto-build and load).
  set(category, value) {
    const cat = getCategory(category);
    this.#build[cat.id] = cat.multiple ? [...(value || [])] : (value ?? null);
    this.#emit({ action: 'replace', category: cat.id, part: value });
  }

  clear() {
    this.#build = emptyBuild();
    this.#emit({ action: 'clear' });
  }

  // Saved form: ids only, so price and spec fixes in data/ apply to old saves.
  toJSON() {
    const parts = {};
    for (const c of CATEGORIES) {
      const v = this.#build[c.id];
      parts[c.id] = c.multiple ? v.map((p) => p.id) : (v?.id ?? null);
    }
    return { version: SAVE_VERSION, savedAt: new Date().toISOString(), parts };
  }

  save() {
    if (!this.#storage) return false;
    try {
      this.#storage.setItem(this.#key, JSON.stringify(this.toJSON()));
      return true;
    } catch {
      return false; // quota full or storage blocked: keep working in memory
    }
  }

  // Returns { loaded, missing: [ids no longer in the catalogue] }.
  load(catalog) {
    let saved;
    try {
      saved = JSON.parse(this.#storage?.getItem(this.#key) ?? 'null');
    } catch {
      saved = null;
    }
    if (!saved || saved.version !== SAVE_VERSION || !saved.parts) return { loaded: false, missing: [] };
    return this.fromJSON(saved, catalog);
  }

  fromJSON(saved, catalog) {
    const missing = [];
    const resolve = (id) => {
      const p = catalog.get(id);
      if (!p) missing.push(id);
      return p;
    };
    const next = emptyBuild();
    for (const c of CATEGORIES) {
      const v = saved.parts[c.id];
      if (c.multiple) next[c.id] = (Array.isArray(v) ? v : []).map(resolve).filter(Boolean);
      else next[c.id] = v ? resolve(v) : null;
    }
    this.#build = next;
    this.#emit({ action: 'load' }, false);
    return { loaded: true, missing };
  }

  #emit(detail, save = true) {
    if (save && this.#autosave) this.save();
    this.dispatchEvent(new CustomEvent('change', { detail: { ...detail, build: this.build } }));
  }
}

// The app's build. Tests create their own BuildStore instances.
export const buildStore = new BuildStore();
