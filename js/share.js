// Share links: a build as a short code in the URL, and back.
//
// Code (version 1): `1.<cpu>.<motherboard>.<ram>.<gpu>.<storage>.<psu>.<case>.<cooler>.<fans>`
// in CATEGORIES order, trailing empty fields dropped. Each part is a 4-character base-36 hash
// of its id (stable when the catalogue grows or is reordered); several parts in one slot are
// joined with `_`, and `*n` repeats one. If two parts of a category ever hash alike, the full
// id is written instead, so a code always resolves to exactly the part it was made from.
// Only characters URLSearchParams leaves unescaped are used: [0-9a-z] . _ * -
//
// Link params: b = build code, h = build-by-hand state (js/share-hand.js), n = name.
// compare.html takes several b (each optionally followed by its n), one per column.
import { CATEGORIES } from './categories.js?v=fe48996dc3';

export const SHARE_VERSION = '1';
const SHORT_LEN = 4;
const SHORT_SPACE = 36 ** SHORT_LEN;

/** 4-character base-36 FNV-1a hash of a part id. */
export function shortId(id) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h % SHORT_SPACE).toString(36).padStart(SHORT_LEN, '0');
}

const codecs = new WeakMap();
// Per catalogue: short code -> part id for each category, and the codes two parts share.
function codecFor(catalog) {
  let c = codecs.get(catalog);
  if (c) return c;
  c = {};
  for (const cat of CATEGORIES) {
    const byShort = new Map();
    const clash = new Set();
    for (const p of catalog.list(cat.id)) {
      const s = shortId(p.id);
      if (byShort.has(s)) clash.add(s);
      byShort.set(s, p.id);
    }
    for (const s of clash) byShort.delete(s);
    c[cat.id] = { byShort, clash };
  }
  codecs.set(catalog, c);
  return c;
}

const idOf = (v) => (typeof v === 'string' ? v : v?.id ?? null);

/**
 * Build (part objects or ids per category) -> code. Empty build -> ''.
 * @param {object} build
 * @param {object} catalog from createCatalog()/loadCatalog()
 */
export function encodeBuild(build, catalog) {
  const codec = codecFor(catalog);
  const token = (cat, id) => {
    const s = shortId(id);
    return codec[cat].clash.has(s) || !catalog.get(id) ? id : s;
  };
  const fields = CATEGORIES.map((c) => {
    const v = build?.[c.id];
    const ids = (Array.isArray(v) ? v : v ? [v] : []).map(idOf).filter(Boolean);
    // Run-length: the same part twice in a row is written once with *n.
    const out = [];
    for (const id of ids) {
      const last = out[out.length - 1];
      if (last && last.id === id) last.n++;
      else out.push({ id, n: 1 });
    }
    return out.map((x) => token(c.id, x.id) + (x.n > 1 ? `*${x.n}` : '')).join('_');
  });
  while (fields.length && !fields[fields.length - 1]) fields.pop();
  return fields.length ? [SHARE_VERSION, ...fields].join('.') : '';
}

/**
 * Code -> { ok, ids, missing, error }. `ids` has the saved-build shape ({ cpu: id, ram: [ids] … })
 * with everything that resolved; `missing` lists what didn't: [{ category, label, token }].
 * `ok` is false only when the code itself can't be read (then ids is empty).
 */
export function decodeBuild(code, catalog) {
  const ids = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.multiple ? [] : null]));
  const missing = [];
  const s = String(code ?? '').trim();
  if (!s) return { ok: false, ids, missing, error: 'The link has no build in it.' };
  const [version, ...fields] = s.split('.');
  if (version !== SHARE_VERSION) return { ok: false, ids, missing, error: `This link was made by a different version of the app (code version "${version.slice(0, 8)}"), so it can't be read.` };
  if (fields.length > CATEGORIES.length || !/^[0-9a-z._*-]*$/.test(s)) return { ok: false, ids, missing, error: 'The build code in this link is damaged.' };
  const codec = codecFor(catalog);
  CATEGORIES.forEach((c, i) => {
    const field = fields[i] ?? '';
    if (!field) return;
    for (const tok of field.split('_')) {
      const m = /^([0-9a-z-]+?)(?:\*(\d{1,2}))?$/.exec(tok);
      const n = m ? Math.min(Number(m[2] ?? 1), 16) : 0;
      const key = m?.[1] ?? tok;
      const part = catalog.get(key) ?? (codec[c.id].byShort.has(key) ? catalog.get(codec[c.id].byShort.get(key)) : null);
      if (!m || !n || !part || part.category !== c.id) {
        missing.push({ category: c.id, label: c.label, token: tok });
        continue;
      }
      if (c.multiple) for (let k = 0; k < n; k++) ids[c.id].push(part.id);
      else if (!ids[c.id]) ids[c.id] = part.id;
    }
  });
  return { ok: true, ids, missing, error: null };
}

/** Parts per category from decoded ids (the build object the rest of the app uses). */
export function buildFromIds(ids, catalog) {
  return Object.fromEntries(CATEGORIES.map((c) => {
    const v = ids?.[c.id];
    return [c.id, c.multiple ? (Array.isArray(v) ? v.map((id) => catalog.get(id)).filter(Boolean) : []) : (v ? catalog.get(v) : null)];
  }));
}

/** Plain sentence for parts a link named that aren't in the catalogue (or '' if none). */
export function missingMessage(missing) {
  if (!missing.length) return '';
  const what = missing.map((m) => m.label.toLowerCase());
  const uniq = [...new Set(what)];
  return `${missing.length === 1 ? 'One part' : `${missing.length} parts`} in this link (${uniq.join(', ')}) ${missing.length === 1 ? 'is' : 'are'} not in the parts catalogue and ${missing.length === 1 ? 'was' : 'were'} left out. Everything else loaded.`;
}

/**
 * Builder link for a build. `hand` = code from encodeHand() (optional), `name` optional.
 * `base` = the page URL to resolve against (location.href in the browser).
 */
export function shareUrl(base, { code, hand = '', name = '' }, page = 'builder.html') {
  const u = new URL(page, base);
  u.search = '';
  u.hash = '';
  if (code) u.searchParams.set('b', code);
  if (hand) u.searchParams.set('h', hand);
  if (name) u.searchParams.set('n', name.slice(0, 60));
  return u.href;
}

/** Compare link for up to three { code, name } columns. */
export function compareUrl(base, columns) {
  const u = new URL('compare.html', base);
  u.search = '';
  u.hash = '';
  for (const c of columns.slice(0, 3)) {
    u.searchParams.append('b', c.code || '1');
    if (c.name) u.searchParams.append('n', c.name.slice(0, 60));
  }
  return u.href;
}

/**
 * Read link params: [{ code, name, hand }] in order. A `b` starts an entry; the `n` and `h`
 * that follow it belong to it.
 */
export function readShareParams(search) {
  const out = [];
  for (const [k, v] of new URLSearchParams(search)) {
    if (k === 'b') out.push({ code: v, name: '', hand: '' });
    else if ((k === 'n' || k === 'h') && out.length) out[out.length - 1][k === 'n' ? 'name' : 'hand'] = v;
  }
  return out;
}
