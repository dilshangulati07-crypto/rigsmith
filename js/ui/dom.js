// Small DOM helpers: escaped HTML templates, number formats, focus-safe re-rendering.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Raw(s);

const out = (v) => {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(out).join('');
  return esc(v);
};

// html`<p>${userText}</p>` escapes every value; nest html`` or raw() to insert markup.
export function html(strings, ...values) {
  let s = strings[0];
  values.forEach((v, i) => { s += out(v) + strings[i + 1]; });
  return new Raw(s);
}

// Replace an element's content, then restore what the user had: keyboard focus (by
// data-focus-key) and which <details data-key> were open or closed.
export function render(el, content) {
  const active = document.activeElement;
  const key = active && el.contains(active) ? active.dataset.focusKey : null;
  const folds = new Map([...el.querySelectorAll('details[data-key]')].map((d) => [d.dataset.key, d.open]));
  el.innerHTML = out(content);
  for (const d of el.querySelectorAll('details[data-key]')) if (folds.has(d.dataset.key)) d.open = folds.get(d.dataset.key);
  if (key) el.querySelector(`[data-focus-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
}

const int = new Intl.NumberFormat('en-US');
export const num = (n) => int.format(n);

export function capacity(gb) {
  if (gb === null || gb === undefined) return null;
  return gb >= 1000 ? `${Math.round((gb / 1000) * 10) / 10} TB` : `${gb} GB`;
}

export const unit = (v, u) => (v === null || v === undefined ? null : `${v}${u}`);

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}
