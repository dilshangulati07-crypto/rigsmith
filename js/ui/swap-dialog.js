// compare.html: "Swap this part". Lists the catalogue for one category with what each choice
// would change in that column: reference price, the two workloads that move most, power,
// and new compatibility errors. Choosing one updates the column (and the table) live.
import { getCategory } from '../categories.js';
import { checkBuild, estimateDraw } from '../compat.js';
import { INCOMPLETE_RULES } from '../compat/essentials.js';
import { priceBuild, formatTHB, PRICE_NOTE } from '../pricing.js';
import { estimatePerformance, WORKLOADS } from '../perf.js';
import { partType } from './part-types/index.js';
import { html, render, num, debounce } from './dom.js';

const sign = (n, fmt = String) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '±0');

/** The build with `part` at (category, index): replaces, or appends when index is past the end. */
export function withPart(build, category, index, part) {
  const next = { ...build };
  const v = build[category];
  if (Array.isArray(v)) {
    const list = [...v];
    if (index < list.length) list[index] = part; else list.push(part);
    next[category] = list;
  } else next[category] = part;
  return next;
}

export function mountSwapDialog(dialog, { catalog, onChoose }) {
  let ctx = null; // { col, category, index, build, name, rows }
  let query = '';
  let onlyOk = true;

  function rowsFor(build, category, index) {
    const cur = Array.isArray(build[category]) ? build[category][index] : build[category];
    const base = { price: priceBuild(build).total, perf: estimatePerformance(build).scores, draw: estimateDraw(build).watts };
    return catalog.list(category).map((p) => {
      const next = withPart(build, category, index, p);
      const perf = estimatePerformance(next).scores;
      const moves = WORKLOADS.map((w) => ({ w, d: (perf[w.id] ?? 0) - (base.perf[w.id] ?? 0) }))
        .filter((m) => m.d !== 0).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 2);
      const errors = checkBuild(next).filter((i) => i.level === 'error' && i.parts.includes(p.id) && !INCOMPLETE_RULES.has(i.rule));
      return {
        part: p, current: cur?.id === p.id,
        dPrice: priceBuild(next).total - base.price, dDraw: estimateDraw(next).watts - base.draw,
        moves, errors, search: `${p.name} ${p.brand}`.toLowerCase(),
      };
    }).sort((a, b) => (b.current - a.current) || (a.part.refPriceTHB - b.part.refPriceTHB));
  }

  function draw(focusKey) {
    const cat = getCategory(ctx.category);
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = ctx.rows.filter((r) => (!onlyOk || !r.errors.length || r.current) && words.every((w) => r.search.includes(w)));
    const hidden = ctx.rows.filter((r) => r.errors.length && !r.current).length;
    render(dialog.querySelector('[data-ref="list"]'), html`
      <p class="swap__count mono muted">${rows.length} of ${ctx.rows.length} ${cat.label.toLowerCase()} options${onlyOk && hidden ? ` · ${hidden} hidden because they would add a compatibility error` : ''}</p>
      ${rows.length ? html`<ul class="swap__list">${rows.map((r) => html`
        <li class="swap__row" ${r.current ? html`data-current="true"` : ''} ${r.errors.length ? html`data-bad="true"` : ''}>
          <div class="swap__main">
            <p class="swap__name">${r.part.name}${r.current ? html` <span class="tag tag--accent">In this build</span>` : ''}</p>
            <p class="swap__specs mono">${partType(r.part.category).keySpecs(r.part).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${k} ${v}`).join(' · ')}</p>
            ${r.errors.length ? html`<p class="swap__error">${r.errors[0].message}</p>` : ''}
          </div>
          <dl class="swap__deltas mono">
            <div><dt>Price</dt><dd>${formatTHB(r.part.refPriceTHB)}${r.current ? '' : html` <span class="${r.dPrice > 0 ? 'is-up' : r.dPrice < 0 ? 'is-down' : ''}">(${sign(r.dPrice, formatTHB)})</span>`}</dd></div>
            ${r.current ? '' : html`<div><dt>Perf</dt><dd>${r.moves.length ? r.moves.map((m, i) => html`${i ? ', ' : ''}${m.w.label} ${sign(m.d)}`) : 'no change'}</dd></div>
            <div><dt>Power</dt><dd>${r.dDraw ? `${sign(r.dDraw, num)} W` : 'no change'}</dd></div>`}
          </dl>
          <div class="swap__act">${r.current
            ? html`<span class="muted swap__keep">Current</span>`
            : html`<button class="btn btn--sm ${r.errors.length ? '' : 'btn--primary'}" type="button" data-pick="${r.part.id}" data-focus-key="pick-${r.part.id}">Use this</button>`}</div>
        </li>`)}</ul>`
        : html`<p class="muted">No parts match “${query}”.</p>`}`);
    if (focusKey) dialog.querySelector(`[data-focus-key="${focusKey}"]`)?.focus();
  }

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) return dialog.close();
    if (e.target.closest('[data-action="close"]')) return dialog.close();
    const pick = e.target.closest('[data-pick]');
    if (!pick || !ctx) return;
    const part = catalog.get(pick.dataset.pick);
    dialog.close();
    onChoose({ col: ctx.col, category: ctx.category, index: ctx.index, part });
  });
  const redraw = debounce(() => draw(), 120);
  dialog.addEventListener('input', (e) => {
    if (e.target.name === 'q') { query = e.target.value; redraw(); }
  });
  dialog.addEventListener('change', (e) => {
    if (e.target.name === 'ok') { onlyOk = e.target.checked; draw(); }
  });

  return {
    /** Open for column `col` (its name and build), category and position in that slot. */
    open({ col, name, build, category, index }) {
      const cat = getCategory(category);
      const cur = Array.isArray(build[category]) ? build[category][index] : build[category];
      ctx = { col, category, index, build, rows: rowsFor(build, category, index) };
      query = '';
      onlyOk = true;
      render(dialog, html`
        <div class="modal__inner">
          <header class="modal__head">
            <div>
              <p class="label">Swap a part · ${name}</p>
              <h2 id="swap-title">${cur ? `Replace ${cur.name}` : `Add ${cat.label.toLowerCase()}`}</h2>
            </div>
            <button class="btn btn--sm btn--ghost" type="button" data-action="close">Close</button>
          </header>
          <div class="swap__tools">
            <label class="field field--grow"><span class="field__label">Search ${cat.label.toLowerCase()}</span>
              <input class="input" name="q" type="search" autocomplete="off" placeholder="Name or brand">
            </label>
            <label class="check"><input type="checkbox" name="ok" checked> Compatible with this build only</label>
          </div>
          <p class="swap__note">Changes shown against this column as it is now. Prices: ${PRICE_NOTE.toLowerCase()}. Performance: estimate.</p>
          <div data-ref="list"></div>
        </div>`);
      dialog.setAttribute('aria-labelledby', 'swap-title');
      draw();
      if (!dialog.open) dialog.showModal();
      dialog.querySelector('input[name="q"]').focus();
    },
  };
}
