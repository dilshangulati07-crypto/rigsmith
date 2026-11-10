// Named builds saved in localStorage. Each entry stores the same id-only form as
// BuildStore.toJSON(), so price and spec fixes in data/ apply to old saves.
// The current work-in-progress build is still owned by js/state.js.
const KEY = 'rigsmith.saved.v1';

function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const newId = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export class SavedBuilds {
  #storage;
  #key;

  constructor({ storage = browserStorage(), storageKey = KEY } = {}) {
    this.#storage = storage;
    this.#key = storageKey;
  }

  get available() { return !!this.#storage; }

  // Newest first. Bad JSON yields an empty list rather than an exception.
  list() {
    try {
      const v = JSON.parse(this.#storage?.getItem(this.#key) ?? '[]');
      return Array.isArray(v) ? v.filter((e) => e && e.id && e.data) : [];
    } catch {
      return [];
    }
  }

  get(id) { return this.list().find((e) => e.id === id) ?? null; }

  // Returns the saved entry, or null if storage is blocked or full.
  save(name, data, id = null) {
    const all = this.list();
    const entry = { id: id ?? newId(), name: cleanName(name), savedAt: new Date().toISOString(), data };
    const i = all.findIndex((e) => e.id === entry.id);
    if (i >= 0) all.splice(i, 1);
    all.unshift(entry);
    return this.#write(all) ? entry : null;
  }

  rename(id, name) {
    const all = this.list();
    const e = all.find((x) => x.id === id);
    if (!e) return null;
    e.name = cleanName(name);
    return this.#write(all) ? e : null;
  }

  duplicate(id) {
    const e = this.get(id);
    return e ? this.save(`${e.name} (copy)`, e.data) : null;
  }

  remove(id) {
    const all = this.list();
    const next = all.filter((e) => e.id !== id);
    return next.length !== all.length && this.#write(next);
  }

  #write(all) {
    try {
      this.#storage.setItem(this.#key, JSON.stringify(all));
      return true;
    } catch {
      return false;
    }
  }
}

function cleanName(name) {
  const s = String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
  return s || 'Untitled build';
}
