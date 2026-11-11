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

// ---------------------------------------------------------------- build-by-hand progress
// Which pieces are in the case (keys from js/scene/assembly.js, in install order), with
// undo/redo over every action (install, reset) and the 3D view mode. Saved to localStorage
// so a reload continues where the user left off. Fires 'change' with detail { action }.
const ASSEMBLY_KEY = 'rigsmith.assembly.v1';
const HISTORY_LIMIT = 200;

export class AssemblyProgress extends EventTarget {
  #installed = [];
  #undo = [];
  #redo = [];
  #mode = 'viewer';
  #caseId = null;
  #storage;
  #key;

  constructor({ storage = browserStorage(), storageKey = ASSEMBLY_KEY } = {}) {
    super();
    this.#storage = storage;
    this.#key = storageKey;
  }

  get installed() { return [...this.#installed]; }
  get mode() { return this.#mode; }
  get caseId() { return this.#caseId; }
  get canUndo() { return this.#undo.length > 0; }
  get canRedo() { return this.#redo.length > 0; }

  setMode(mode) {
    if (mode !== 'viewer' && mode !== 'hand') return;
    if (mode === this.#mode) return;
    this.#mode = mode;
    this.#emit('mode');
  }

  #commit(next, action) {
    this.#undo.push(this.#installed);
    if (this.#undo.length > HISTORY_LIMIT) this.#undo.shift();
    this.#redo = [];
    this.#installed = next;
    this.#emit(action);
  }

  install(key) {
    if (this.#installed.includes(key)) return false;
    this.#commit([...this.#installed, key], 'install');
    return true;
  }

  reset() {
    if (!this.#installed.length) return false;
    this.#commit([], 'reset');
    return true;
  }

  undo() {
    if (!this.#undo.length) return false;
    this.#redo.push(this.#installed);
    this.#installed = this.#undo.pop();
    this.#emit('undo');
    return true;
  }

  redo() {
    if (!this.#redo.length) return false;
    this.#undo.push(this.#installed);
    this.#installed = this.#redo.pop();
    this.#emit('redo');
    return true;
  }

  /**
   * Fit the progress to the current build: `keep(keys)` returns the keys that still apply.
   * A different case starts over (with no history). Silent unless something changed.
   */
  sync(caseId, keep) {
    if (caseId !== this.#caseId) {
      const had = this.#installed.length || this.#undo.length;
      this.#caseId = caseId;
      this.#installed = [];
      this.#undo = [];
      this.#redo = [];
      if (had) this.#emit('sync');
      else this.save();
      return;
    }
    const next = keep(this.#installed);
    const fix = (list) => list.map(keep);
    if (next.length === this.#installed.length) return;
    this.#installed = next;
    this.#undo = fix(this.#undo);
    this.#redo = [];
    this.#emit('sync');
  }

  save() {
    if (!this.#storage) return false;
    try {
      this.#storage.setItem(this.#key, JSON.stringify({
        version: 1, mode: this.#mode, caseId: this.#caseId, installed: this.#installed, undo: this.#undo, redo: this.#redo,
      }));
      return true;
    } catch {
      return false;
    }
  }

  load() {
    let s;
    try {
      s = JSON.parse(this.#storage?.getItem(this.#key) ?? 'null');
    } catch {
      s = null;
    }
    if (!s || s.version !== 1) return false;
    const list = (a) => (Array.isArray(a) ? a.filter((k) => typeof k === 'string') : []);
    const lists = (a) => (Array.isArray(a) ? a.filter(Array.isArray).map(list).slice(-HISTORY_LIMIT) : []);
    this.#mode = s.mode === 'hand' ? 'hand' : 'viewer';
    this.#caseId = typeof s.caseId === 'string' ? s.caseId : null;
    this.#installed = list(s.installed);
    this.#undo = lists(s.undo);
    this.#redo = lists(s.redo);
    return true;
  }

  #emit(action) {
    this.save();
    this.dispatchEvent(new CustomEvent('change', { detail: { action, installed: this.installed } }));
  }
}

export const assemblyProgress = new AssemblyProgress();
