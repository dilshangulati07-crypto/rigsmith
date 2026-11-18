// Centre column: search, filters, sort and part cards for the selected category.
// Tools re-render only when the category changes (so typing keeps focus);
// the card list re-renders on every build or filter change.
import { getCategory } from '../categories.js?v=00a22f4faf';
import { isPartCompatible } from '../compat.js?v=00a22f4faf';
import { formatTHB, PRICE_NOTE } from '../pricing.js?v=00a22f4faf';
import { partType, COMMON_FILTERS, COMMON_SORTS } from './part-types/index.js?v=00a22f4faf';
import { html, render, debounce, num } from './dom.js?v=00a22f4faf';

const isUnknownNote = (i) => i.level === 'info' && i.message.startsWith("Can't confirm");

export function mountPartBrowser(el, app) {
  el.innerHTML = '<div class="browser__tools"></div><div class="browser__list"></div>';
  const toolsEl = el.querySelector('.browser__tools');
  const listEl = el.querySelector('.browser__list');
  let toolsFor = null;
  let lastBuild = null;

  const state = (cat) => {
    app.ui.browse[cat] ??= { search: '', sort: 'fit', filters: {}, priceMin: '', priceMax: '' };
    return app.ui.browse[cat];
  };
  const refreshList = () => lastBuild && renderList(lastBuild);
  const searchLater = debounce(refreshList, 120);

  toolsEl.addEventListener('input', (e) => {
    const s = state(app.ui.category);
    const t = e.target;
    if (t.name === 'search') { s.search = t.value; searchLater(); return; }
    if (t.name === 'priceMin' || t.name === 'priceMax') { s[t.name] = t.value; searchLater(); }
  });
  toolsEl.addEventListener('change', (e) => {
    const s = state(app.ui.category);
    const t = e.target;
    if (t.name === 'sort') s.sort = t.value;
    else if (t.name === 'showIncompatible') app.ui.showIncompatible = t.checked;
    else if (t.dataset.filter) s.filters[t.dataset.filter] = t.value;
    else return;
    refreshList();
  });
  toolsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    if (b.dataset.action === 'reset') {
      app.ui.browse[app.ui.category] = undefined;
      toolsFor = null;
      renderAll(lastBuild);
    }
    if (b.dataset.action === 'toggle-filters') {
      const open = b.getAttribute('aria-expanded') !== 'true';
      b.setAttribute('aria-expanded', String(open));
      toolsEl.querySelector('.filters').dataset.open = String(open);
    }
    if (b.dataset.action === 'cancel-swap') app.cancelSwap();
  });
  listEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const part = app.catalog.get(b.dataset.id);
    if (b.dataset.action === 'details') app.openDetail(part);
    if (b.dataset.action === 'remove') app.remove(part.category, part.id);
    if (b.dataset.action === 'select') {
      if (b.getAttribute('aria-disabled') === 'true') app.toast(b.dataset.reason, 'error');
      else app.select(part);
    }
  });

  function renderAll(build) {
    lastBuild = build;
    const cat = app.ui.category;
    if (toolsFor !== cat) {
      renderTools(cat);
      toolsFor = cat;
    }
    renderList(build);
  }

  function renderTools(cat) {
    const c = getCategory(cat);
    const type = partType(cat);
    const s = state(cat);
    const parts = app.catalog.list(cat);
    const filters = [...COMMON_FILTERS, ...type.filters];
    const sorts = [...COMMON_SORTS, ...type.sorts];
    render(toolsEl, html`
      <div class="browser__head">
        <h2 class="browser__title" id="browser-title" tabindex="-1">${c.label}</h2>
        <p class="browser__count mono" aria-live="polite"></p>
      </div>
      <div class="browser__swap" hidden></div>
      <div class="browser__row">
        <label class="field field--grow">
          <span class="visually-hidden">Search ${c.label.toLowerCase()}</span>
          <input class="input" type="search" name="search" value="${s.search}" placeholder="Search ${c.label.toLowerCase()} (press /)" autocomplete="off" data-focus-key="search">
        </label>
        <label class="field">
          <span class="visually-hidden">Sort</span>
          <select class="input" name="sort">${sorts.map((o) => html`<option value="${o.id}" ${o.id === s.sort ? 'selected' : ''}>${o.label}</option>`)}</select>
        </label>
        <button class="btn btn--sm btn--ghost filters-toggle" type="button" data-action="toggle-filters" aria-expanded="false" aria-controls="filters">Filters</button>
      </div>
      <div class="filters" id="filters" data-open="false">
        ${filters.map((f) => filterControl(f, parts, s))}
        <fieldset class="field field--price">
          <legend class="field__label">Price (THB)</legend>
          <span class="price-range">
            <input class="input" type="number" inputmode="numeric" min="0" step="500" name="priceMin" value="${s.priceMin}" placeholder="Min" aria-label="Minimum price">
            <span aria-hidden="true">–</span>
            <input class="input" type="number" inputmode="numeric" min="0" step="500" name="priceMax" value="${s.priceMax}" placeholder="Max" aria-label="Maximum price">
          </span>
        </fieldset>
        <div class="filters__end">
          <label class="check">
            <input type="checkbox" name="showIncompatible" ${app.ui.showIncompatible ? 'checked' : ''}>
            <span>Show incompatible</span>
          </label>
          <button class="linkbtn" type="button" data-action="reset">Reset filters</button>
        </div>
      </div>
      <p class="browser__note"><span class="mono">${PRICE_NOTE}.</span> Prices are reference figures entered by hand; use “Search this part” for today's price.</p>`);
  }

  function renderList(build) {
    const cat = app.ui.category;
    const c = getCategory(cat);
    const type = partType(cat);
    const s = state(cat);
    const swap = app.ui.swap?.category === cat ? app.ui.swap : null;
    const base = swap ? { ...build, [cat]: build[cat].filter((p, i) => i !== build[cat].findIndex((x) => x.id === swap.id)) } : build;
    const mode = swap ? 'add' : undefined;
    const chosen = c.multiple ? build[cat] : build[cat] ? [build[cat]] : [];
    const filters = [...COMMON_FILTERS, ...type.filters];

    const q = s.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const min = Number(s.priceMin) || 0;
    const max = Number(s.priceMax) || Infinity;
    let rows = app.catalog.list(cat)
      .filter((p) => q.every((w) => `${p.name} ${p.brand} ${p.chip ?? ''} ${p.chipset ?? ''} ${p.socket ?? ''}`.toLowerCase().includes(w)))
      .filter((p) => p.refPriceTHB >= min && p.refPriceTHB <= max)
      .filter((p) => filters.every((f) => passes(f, p, s.filters[f.id])))
      .map((p) => {
        const inBuild = chosen.filter((x) => x.id === p.id).length;
        const r = isPartCompatible(p, base, { mode });
        const warn = r.issues.find((i) => i.level === 'warn');
        const unknown = r.issues.find(isUnknownNote);
        return { p, r, inBuild, warn, unknown };
      });
    const total = rows.length;
    const hidden = app.ui.showIncompatible ? 0 : rows.filter((x) => !x.r.ok).length;
    if (!app.ui.showIncompatible) rows = rows.filter((x) => x.r.ok);

    const sort = [...COMMON_SORTS, ...type.sorts].find((o) => o.id === s.sort) ?? COMMON_SORTS[0];
    const fitRank = (x) => (x.r.ok ? (x.warn ? 1 : 0) : 2);
    rows.sort((a, b) => (s.sort === 'fit' ? fitRank(a) - fitRank(b) || a.p.refPriceTHB - b.p.refPriceTHB : sort.compare(a.p, b.p)));

    const countEl = toolsEl.querySelector('.browser__count');
    if (countEl) countEl.textContent = `${num(rows.length)} of ${num(app.catalog.list(cat).length)}${hidden ? ` · ${hidden} incompatible hidden` : ''}`;
    const swapEl = toolsEl.querySelector('.browser__swap');
    if (swapEl) {
      swapEl.hidden = !swap;
      if (swap) render(swapEl, html`<span>Swapping <strong>${app.catalog.get(swap.id)?.name}</strong>: pick a replacement.</span> <button class="linkbtn" type="button" data-action="cancel-swap">Cancel</button>`);
    }

    render(listEl, rows.length
      ? html`<ul class="parts" aria-labelledby="browser-title">${rows.map((x) => card(x, c, type, swap))}</ul>`
      : html`<div class="empty"><p>No ${c.label.toLowerCase()} match${total && hidden ? ' (incompatible parts are hidden)' : ''}.</p><button class="btn btn--sm" type="button" data-action="reset-from-list">Reset filters</button></div>`);
    listEl.querySelector('[data-action="reset-from-list"]')?.addEventListener('click', () => {
      app.ui.browse[cat] = undefined;
      app.ui.showIncompatible = true;
      toolsFor = null;
      renderAll(lastBuild);
    });
  }

  return { render: renderAll, focusSearch: () => toolsEl.querySelector('input[name="search"]')?.focus(), focusTitle: () => toolsEl.querySelector('#browser-title')?.focus() };
}

// ---------------------------------------------------------------- filters
function values(f, parts) {
  const set = new Set();
  for (const p of parts) {
    const v = f.get(p);
    if (v === null || v === undefined) continue;
    (Array.isArray(v) ? v : [v]).forEach((x) => set.add(x));
  }
  let list = [...set];
  if (f.order) list.sort((a, b) => f.order.indexOf(a) - f.order.indexOf(b));
  else if (f.numeric || typeof list[0] === 'number') list.sort((a, b) => parseFloat(a) - parseFloat(b));
  else list.sort((a, b) => String(a).localeCompare(String(b)));
  if ((f.kind === 'min' || f.kind === 'max') && f.steps) list = f.steps;
  return list;
}

function filterControl(f, parts, s) {
  const opts = values(f, parts);
  if (opts.length < 2 && f.kind === 'select') return '';
  const any = f.kind === 'min' ? 'Any' : f.kind === 'max' ? 'Any' : 'All';
  const fmt = f.format ?? ((v) => String(v));
  const cur = s.filters[f.id] ?? '';
  return html`
    <label class="field">
      <span class="field__label">${f.label}</span>
      <select class="input" data-filter="${f.id}">
        <option value="">${any}</option>
        ${opts.map((v) => html`<option value="${v}" ${String(v) === cur ? 'selected' : ''}>${f.kind === 'min' ? `${fmt(v)} +` : f.kind === 'max' ? `≤ ${fmt(v)}` : fmt(v)}</option>`)}
      </select>
    </label>`;
}

// A null spec is unknown: it fails an active min/max filter (can't confirm) but never a cleared one.
function passes(f, p, value) {
  if (value === undefined || value === '') return true;
  const v = f.get(p);
  if (v === null || v === undefined) return false;
  if (f.kind === 'min') return v >= Number(value);
  if (f.kind === 'max') return v <= Number(value);
  return Array.isArray(v) ? v.map(String).includes(value) : String(v) === value;
}

// ---------------------------------------------------------------- card
function card({ p, r, inBuild, warn, unknown }, cat, type, swap) {
  const state = inBuild && !swap ? 'selected' : !r.ok ? 'incompatible' : warn ? 'warn' : 'ok';
  const reason = !r.ok ? r.reason : null;
  const tipPos = 'left';
  let badge;
  if (state === 'selected') badge = html`<span class="tag tag--accent tag--dot">In build${cat.multiple && inBuild > 1 ? ` ×${inBuild}` : ''}</span>`;
  else if (!r.ok) badge = html`<span class="tag tag--error tag--dot" tabindex="0" data-tooltip="${reason}" data-tooltip-pos="${tipPos}">Incompatible</span>`;
  else if (warn) badge = html`<span class="tag tag--warn tag--dot" tabindex="0" data-tooltip="${warn.message}" data-tooltip-pos="${tipPos}">Check</span>`;
  else if (unknown) badge = html`<span class="tag tag--dot" tabindex="0" data-tooltip="${unknown.message}" data-tooltip-pos="${tipPos}">Unconfirmed fit</span>`;
  else badge = html`<span class="tag tag--ok tag--dot">Compatible</span>`;

  // RAM is an array but picking a kit replaces the current one, like a single slot.
  const single = !cat.multiple || cat.pickMode !== 'add';
  let action;
  if (state === 'selected' && single) {
    action = html`<button class="btn btn--sm btn--ghost" type="button" data-action="remove" data-id="${p.id}" data-focus-key="act-${p.id}">Remove<span class="visually-hidden"> ${p.name}</span></button>`;
  } else {
    const label = swap ? 'Swap in' : single ? 'Select' : inBuild ? 'Add another' : 'Add';
    action = html`<button class="btn btn--sm ${r.ok ? '' : 'is-blocked'}" type="button" data-action="select" data-id="${p.id}" data-focus-key="act-${p.id}"
      ${r.ok ? '' : html`aria-disabled="true" data-reason="${reason}" data-tooltip="${reason}" data-tooltip-pos="${tipPos}" aria-describedby="why-${p.id}"`}>${label}<span class="visually-hidden"> ${p.name}</span></button>
      ${r.ok ? '' : html`<span class="visually-hidden" id="why-${p.id}">${reason}</span>`}`;
  }

  const unverified = p.specsVerified === false;
  return html`
    <li class="part" data-state="${state}" data-part-cat="${p.category}" data-part-id="${p.id}">
      <div class="part__main">
        <h3 class="part__name"><button class="part__title" type="button" data-action="details" data-id="${p.id}" data-focus-key="det-${p.id}">${p.name}</button></h3>
        <p class="part__tags">
          <span class="tag">${p.tier}</span>
          ${unverified ? html`<span class="tag tag--warn" tabindex="0" data-tooltip="Some specs are not confirmed by the maker's page yet; checks that need them show as notes.">Unconfirmed spec</span>` : ''}
        </p>
        <dl class="part__specs">${type.keySpecs(p).map(([k, v]) => html`<div><dt>${k}</dt><dd class="${v === null || v === undefined ? 'null' : ''}">${v ?? '—'}</dd></div>`)}</dl>
      </div>
      <div class="part__side">
        ${badge}
        <p class="part__price"><span class="mono">${formatTHB(p.refPriceTHB)}</span><span class="part__price-note">${PRICE_NOTE.toLowerCase()}</span></p>
        ${action}
      </div>
    </li>`;
}
