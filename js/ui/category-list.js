// Left column: one row per category with the chosen part(s), price and status.
// Doubles as the text alternative to the 3D view.
import { CATEGORIES } from '../categories.js?v=fe48996dc3';
import { formatTHB } from '../pricing.js?v=fe48996dc3';
import { html, render } from './dom.js?v=fe48996dc3';

const LEVEL_RANK = { error: 3, warn: 2, info: 1 };
const STATUS_TEXT = { error: 'has an error', warn: 'has a warning' };

export function mountCategoryList(el, app) {
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const { action, cat, id } = b.dataset;
    if (action === 'category') app.setCategory(cat, { focusBrowser: true });
    if (action === 'remove') app.remove(cat, id);
    if (action === 'details') app.openDetail(app.catalog.get(id));
    if (action === 'swap') app.startSwap(cat, id);
  });

  return {
    render(build, issues) {
      // Worst issue level per part id (missing-part issues have no parts).
      const worst = new Map();
      for (const i of issues) {
        if (i.level === 'info') continue;
        for (const id of i.parts) if ((LEVEL_RANK[i.level] ?? 0) > (LEVEL_RANK[worst.get(id)] ?? 0)) worst.set(id, i.level);
      }
      render(el, html`
        <ol class="cats">${CATEGORIES.map((c) => row(c, build[c.id], worst, app))}</ol>`);
    },
  };
}

function row(cat, value, worst, app) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  const status = items.reduce((s, p) => ((LEVEL_RANK[worst.get(p.id)] ?? 0) > (LEVEL_RANK[s] ?? 0) ? worst.get(p.id) : s), items.length ? 'ok' : 'empty');
  const total = items.reduce((s, p) => s + p.refPriceTHB, 0);
  const current = app.ui.category === cat.id;
  const needed = cat.essential || (cat.id === 'cooler' && app.store.get('cpu') && app.store.get('cpu').coolerIncluded !== true);

  return html`
    <li class="cat" data-status="${status}" data-part-cat="${cat.id}" data-part-id="${!cat.multiple && items[0] ? items[0].id : ''}" ${current ? html`data-current="true"` : ''}>
      <button class="cat__btn" type="button" data-action="category" data-cat="${cat.id}" data-focus-key="cat-${cat.id}"
        ${current ? html`aria-current="true"` : ''}>
        <span class="cat__thumb" aria-hidden="true">${items[0] && app.partThumbs?.get(items[0].id)
          ? html`<img alt="" src="${app.partThumbs.get(items[0].id)}" data-thumb-for="${items[0].id}">`
          : html`<span class="cat__glyph">${cat.label.slice(0, 1)}</span>`}</span>
        <span class="cat__head">
          <span class="cat__label">${cat.label}</span>
          <span class="cat__dot" aria-hidden="true"></span>
          ${STATUS_TEXT[status] ? html`<span class="visually-hidden">(${STATUS_TEXT[status]})</span>` : ''}
        </span>
        ${items.length
          ? html`<span class="cat__name">${cat.multiple && items.length > 1 ? `${items.length} items` : items[0].name}</span>
                 <span class="cat__price mono">${formatTHB(total)}</span>`
          : html`<span class="cat__empty">${needed ? 'Not chosen · required' : cat.id === 'gpu' ? 'Optional with integrated graphics' : 'Optional'}</span>`}
      </button>
      ${items.length ? html`<ul class="cat__items">${items.map((p, i) => item(cat, p, i, items.length))}</ul>` : ''}
    </li>`;
}

function item(cat, p, i, count) {
  const key = `${cat.id}-${p.id}-${i}`;
  return html`
    <li class="cat__item" ${cat.multiple ? html`data-part-cat="${cat.id}" data-part-id="${p.id}"` : ''}>
      ${cat.multiple && count > 1 ? html`<span class="cat__item-name">${p.name}</span>` : ''}
      <span class="cat__actions">
        <button class="linkbtn" type="button" data-action="details" data-id="${p.id}" data-focus-key="d-${key}">Details<span class="visually-hidden"> of ${p.name}</span></button>
        <button class="linkbtn" type="button" data-action="swap" data-cat="${cat.id}" data-id="${p.id}" data-focus-key="s-${key}">Swap<span class="visually-hidden"> ${p.name}</span></button>
        <button class="linkbtn linkbtn--danger" type="button" data-action="remove" data-cat="${cat.id}" data-id="${p.id}" data-focus-key="r-${key}">Remove<span class="visually-hidden"> ${p.name}</span></button>
      </span>
    </li>`;
}
