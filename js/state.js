// The current build. The only place build state lives.
// Holds part objects in memory; saves part ids to localStorage and resolves them
// against the catalogue on load. Fires a 'change' event after every edit:
//   detail = { action: 'add'|'remove'|'replace'|'clear'|'load', category?, part?, previous? }
import { CATEGORIES, getCategory } from './categories.js?v=733eefba1e';

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
// Which pieces are in the case (keys from js/scene/assembly.js, in install order), the cables
// connected (ids from js/scene/cable-plan.js, each with its moved waypoints, or null for the
// tidy auto-route) and whether the side panel is closed, with undo/redo over every action;
// plus the 3D view mode and the cable style. Saved to localStorage so a reload continues
// where the user left off. Fires 'change' with detail { action }.
const ASSEMBLY_KEY = 'rigsmith.assembly.v1';
const HISTORY_LIMIT = 200;
export const CABLE_STYLES = Object.freeze(['black', 'white', 'custom', 'sleeved']);
const DEFAULT_STYLE = Object.freeze({ kind: 'black', color: '#ff5a1f' });

const snap = (installed, cables, closed) => ({ installed, cables, closed });
const copyCables = (c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, { pts: v.pts ? v.pts.map((p) => [...p]) : null, src: v.src ?? null, dst: v.dst ?? null }]));
const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

export class AssemblyProgress extends EventTarget {
  #now = snap([], {}, false);
  #undo = [];
  #redo = [];
  #mode = 'viewer';
  #caseId = null;
  #style = { ...DEFAULT_STYLE };
  #storage;
  #key;

  constructor({ storage = browserStorage(), storageKey = ASSEMBLY_KEY } = {}) {
    super();
    this.#storage = storage;
    this.#key = storageKey;
  }

  get installed() { return [...this.#now.installed]; }
  /** Connected cables: { id: { pts: [[x,y,z]...] | null, src, dst } } (a copy). */
  get cables() { return copyCables(this.#now.cables); }
  get closed() { return this.#now.closed; }
  get mode() { return this.#mode; }
  get caseId() { return this.#caseId; }
  get canUndo() { return this.#undo.length > 0; }
  get canRedo() { return this.#redo.length > 0; }
  get cableStyle() { return { ...this.#style }; }

  setMode(mode) {
    if (mode !== 'viewer' && mode !== 'hand') return;
    if (mode === this.#mode) return;
    this.#mode = mode;
    this.#emit('mode');
  }

  /** Cable look (not part of undo): { kind: black | white | custom | sleeved, color: '#rrggbb' }. */
  setCableStyle(patch) {
    const kind = CABLE_STYLES.includes(patch.kind) ? patch.kind : this.#style.kind;
    const color = isHex(patch.color) ? patch.color.toLowerCase() : this.#style.color;
    if (kind === this.#style.kind && color === this.#style.color) return;
    this.#style = { kind, color };
    this.#emit('style');
  }

  #commit(next, action) {
    this.#undo.push(this.#now);
    if (this.#undo.length > HISTORY_LIMIT) this.#undo.shift();
    this.#redo = [];
    this.#now = next;
    this.#emit(action);
  }

  install(key) {
    if (this.#now.installed.includes(key)) return false;
    this.#commit(snap([...this.#now.installed, key], this.#now.cables, this.#now.closed), 'install');
    return true;
  }

  /** Connect one cable on its tidy route; `ends` = { src, dst } port overrides (or nulls). */
  connect(id, { src = null, dst = null } = {}) {
    if (this.#now.cables[id]) return false;
    this.#commit(snap(this.#now.installed, { ...copyCables(this.#now.cables), [id]: { pts: null, src, dst } }, this.#now.closed), 'cable');
    return true;
  }

  /** Connect every cable in `ends` ({ id: { src, dst } }) on tidy routes, as one step. */
  connectAll(ends) {
    const next = {};
    for (const [id, e] of Object.entries(ends)) next[id] = { pts: null, src: e?.src ?? null, dst: e?.dst ?? null };
    if (JSON.stringify(next) === JSON.stringify(this.#now.cables)) return false;
    this.#commit(snap(this.#now.installed, next, this.#now.closed), 'cable');
    return true;
  }

  disconnect(id) {
    if (!this.#now.cables[id]) return false;
    const next = copyCables(this.#now.cables);
    delete next[id];
    this.#commit(snap(this.#now.installed, next, this.#now.closed && Object.keys(next).length > 0), 'cable');
    return true;
  }

  /** Moved waypoints for a connected cable (null = back to the tidy route). */
  setRoute(id, pts) {
    if (!this.#now.cables[id]) return false;
    const next = copyCables(this.#now.cables);
    next[id].pts = pts ? pts.map((p) => p.map((v) => Math.round(v * 100) / 100)) : null;
    this.#commit(snap(this.#now.installed, next, this.#now.closed), 'cable');
    return true;
  }

  /** Everything in at once, as one undoable step (the finished Auto-build opened in Build by hand). */
  fill({ installed, cables, closed }) {
    this.#commit(snap([...installed], copyCables(cables), !!closed && Object.keys(cables).length > 0), 'fill');
    return true;
  }

  setClosed(closed) {
    if (!!closed === this.#now.closed) return false;
    this.#commit(snap(this.#now.installed, this.#now.cables, !!closed), 'close');
    return true;
  }

  reset() {
    if (!this.#now.installed.length && !Object.keys(this.#now.cables).length && !this.#now.closed) return false;
    this.#commit(snap([], {}, false), 'reset');
    return true;
  }

  undo() {
    if (!this.#undo.length) return false;
    this.#redo.push(this.#now);
    this.#now = this.#undo.pop();
    this.#emit('undo');
    return true;
  }

  redo() {
    if (!this.#redo.length) return false;
    this.#undo.push(this.#now);
    this.#now = this.#redo.pop();
    this.#emit('redo');
    return true;
  }

  /**
   * Fit the progress to the current build: `keep(keys)` returns the piece keys that still
   * apply, `keepCables(cables)` the cables that still apply. A different case starts over
   * (with no history). Silent unless something changed.
   */
  sync(caseId, keep, keepCables = (c) => c) {
    if (caseId !== this.#caseId) {
      const had = this.#now.installed.length || this.#undo.length;
      this.#caseId = caseId;
      this.#now = snap([], {}, false);
      this.#undo = [];
      this.#redo = [];
      if (had) this.#emit('sync');
      else this.save();
      return;
    }
    const fix = (s) => {
      const cables = keepCables(s.cables);
      return snap(keep(s.installed), cables, s.closed && Object.keys(cables).length > 0);
    };
    const next = fix(this.#now);
    const n = (c) => Object.keys(c).length;
    if (next.installed.length === this.#now.installed.length && n(next.cables) === n(this.#now.cables) && next.closed === this.#now.closed) return;
    this.#now = next;
    this.#undo = this.#undo.map(fix);
    this.#redo = [];
    this.#emit('sync');
  }

  save() {
    if (!this.#storage) return false;
    try {
      this.#storage.setItem(this.#key, JSON.stringify({
        version: 2, mode: this.#mode, caseId: this.#caseId, style: this.#style,
        installed: this.#now.installed, cables: this.#now.cables, closed: this.#now.closed, undo: this.#undo, redo: this.#redo,
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
    if (!s || (s.version !== 1 && s.version !== 2)) return false;
    const list = (a) => (Array.isArray(a) ? a.filter((k) => typeof k === 'string') : []);
    const point = (p) => Array.isArray(p) && p.length === 3 && p.every((v) => typeof v === 'number' && Number.isFinite(v));
    const cables = (c) => {
      const out = {};
      if (!c || typeof c !== 'object' || Array.isArray(c)) return out;
      for (const [id, v] of Object.entries(c)) {
        if (!v || typeof v !== 'object') continue;
        out[id] = { pts: Array.isArray(v.pts) && v.pts.every(point) ? v.pts : null, src: typeof v.src === 'string' ? v.src : null, dst: typeof v.dst === 'string' ? v.dst : null };
      }
      return out;
    };
    // Version 1 kept the history as plain key lists.
    const entry = (e) => {
      if (Array.isArray(e)) return snap(list(e), {}, false);
      if (e && typeof e === 'object') return snap(list(e.installed), cables(e.cables), e.closed === true);
      return null;
    };
    const entries = (a) => (Array.isArray(a) ? a.map(entry).filter(Boolean).slice(-HISTORY_LIMIT) : []);
    this.#mode = s.mode === 'hand' ? 'hand' : 'viewer';
    this.#caseId = typeof s.caseId === 'string' ? s.caseId : null;
    this.#now = snap(list(s.installed), cables(s.cables), s.closed === true);
    this.#undo = entries(s.undo);
    this.#redo = entries(s.redo);
    if (s.style && typeof s.style === 'object') {
      this.#style = { kind: CABLE_STYLES.includes(s.style.kind) ? s.style.kind : DEFAULT_STYLE.kind, color: isHex(s.style.color) ? s.style.color : DEFAULT_STYLE.color };
    }
    return true;
  }

  #emit(action) {
    this.save();
    this.dispatchEvent(new CustomEvent('change', { detail: { action, installed: this.installed } }));
  }
}

export const assemblyProgress = new AssemblyProgress();
