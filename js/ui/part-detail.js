// Part detail drawer: full spec table, how the part fits the current build, links.
import { getCategory } from '../categories.js?v=4fbe99bdc0';
import { isPartCompatible } from '../compat.js?v=4fbe99bdc0';
import { unknownFields } from '../compat/util.js?v=4fbe99bdc0';
import { formatTHB, PRICE_NOTE } from '../pricing.js?v=4fbe99bdc0';
import { partType, commonSpecs } from './part-types/index.js?v=4fbe99bdc0';
import { html, render, num } from './dom.js?v=4fbe99bdc0';
import { priceHistory } from '../price-history.js?v=4fbe99bdc0';

const LEVEL = { error: 'Error', warn: 'Warning', info: 'Note' };
const dayLabel = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

// The part's reference price over time (only shown once it has changed at least once).
async function fillTrend(dialog, part) {
  const list = await priceHistory(part.id);
  const el = dialog.querySelector(`[data-trend-for="${CSS.escape(part.id)}"]`);
  if (!el || list.length < 2) return;
  const prices = list.map(([, p]) => p);
  const [first, last] = [prices[0], prices[prices.length - 1]];
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const w = 300;
  const x = (i) => (i / (list.length - 1)) * w;
  const y = (p) => (max === min ? 22 : 40 - ((p - min) / (max - min)) * 36);
  const diff = last - first;
  render(el, html`
    <div class="trend__head">
      <span>Since ${dayLabel(list[0][0])}: <b class="${diff < 0 ? 'trend__down' : diff > 0 ? 'trend__up' : ''}">${diff === 0 ? 'no change' : `${diff < 0 ? 'down' : 'up'} ${formatTHB(Math.abs(diff))}`}</b></span>
      <span class="muted">low ${formatTHB(min)} · high ${formatTHB(max)}</span>
    </div>
    <svg viewBox="-3 0 ${w + 6} 44" role="img" aria-label="Reference price from ${formatTHB(first)} to ${formatTHB(last)} over ${num(list.length)} changes">
      <polyline points="${list.map(([, p], i) => `${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ')}"></polyline>
      ${list.map(([d, p], i) => html`<circle cx="${x(i).toFixed(1)}" cy="${y(p).toFixed(1)}" r="2.5"><title>${dayLabel(d)}: ${formatTHB(p)}</title></circle>`)}
    </svg>`);
  el.hidden = false;
}

export function mountPartDetail(dialog, app) {
  let current = null;

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) return dialog.close(); // backdrop
    const b = e.target.closest('[data-action]');
    if (!b) return;
    if (b.dataset.action === 'close') dialog.close();
    if (b.dataset.action === 'select' && b.getAttribute('aria-disabled') !== 'true') {
      app.select(current);
      dialog.close();
    }
    if (b.dataset.action === 'remove') {
      app.remove(current.category, current.id);
      dialog.close();
    }
  });

  function fill(part, build) {
    const cat = getCategory(part.category);
    const chosen = cat.multiple ? build[cat.id].some((p) => p.id === part.id) : build[cat.id]?.id === part.id;
    const r = isPartCompatible(part, build);
    const fit = r.issues;
    const missing = unknownFields(part);
    const rows = [...partType(cat.id).specs(part), ...commonSpecs(part)];

    render(dialog, html`
      <div class="drawer__inner">
        <header class="drawer__head">
          <div>
            <p class="label">${cat.label} · ${part.brand}</p>
            <h2 class="drawer__title" id="drawer-title">${part.name}</h2>
          </div>
          <button class="btn btn--sm btn--ghost" type="button" data-action="close" aria-label="Close details">Close</button>
        </header>

        <div class="drawer__price">
          <span class="mono drawer__amount">${formatTHB(part.refPriceTHB)}</span>
          <span class="muted">${PRICE_NOTE} · updated ${part.priceUpdated}</span>
          <div class="trend" data-trend-for="${part.id}" hidden></div>
        </div>

        <div class="drawer__actions">
          ${chosen && !cat.multiple
            ? html`<button class="btn btn--sm" type="button" data-action="remove">Remove from build</button>`
            : html`<button class="btn btn--sm btn--primary" type="button" data-action="select" ${r.ok ? '' : html`aria-disabled="true"`}>${cat.multiple ? 'Add to build' : 'Select'}</button>`}
          <a class="btn btn--sm" href="${part.searchUrl}" target="_blank" rel="noopener noreferrer">Search this part <span class="btn__arrow" aria-hidden="true">↗</span></a>
          ${part.specsVerified && part.specSource
            ? html`<a class="btn btn--sm btn--ghost" href="${part.specSource}" target="_blank" rel="noopener noreferrer">Spec source${part.specSourceType ? ` (${part.specSourceType})` : ''} <span class="btn__arrow" aria-hidden="true">↗</span></a>`
            : ''}
        </div>

        ${part.specsVerified === false ? html`
          <div class="callout callout--warn">
            <p class="label">Unconfirmed spec</p>
            <p>These fields were not stated on the maker's page we checked: <span class="mono">${missing.join(', ') || 'none listed'}</span>. Compatibility checks that need them show as notes, not as passes or failures.</p>
          </div>` : ''}

        <section aria-labelledby="fit-h">
          <h3 class="drawer__h" id="fit-h">In this build</h3>
          ${!r.ok ? html`<p class="fit fit--error">${r.reason}${r.fix ? html` <span class="muted">${r.fix}</span>` : ''}</p>` : ''}
          ${fit.filter((i) => i.level !== 'error').length
            ? html`<ul class="fit-list">${fit.filter((i) => i.level !== 'error').map((i) => html`<li class="fit fit--${i.level}"><span class="label">${LEVEL[i.level]}</span> ${i.message}</li>`)}</ul>`
            : r.ok ? html`<p class="fit fit--ok">No issues with the parts chosen so far.</p>` : ''}
        </section>

        <section aria-labelledby="spec-h">
          <h3 class="drawer__h" id="spec-h">Specifications</h3>
          <table class="spec-table">
            <tbody>${rows.map(([k, v]) => html`<tr><th scope="row">${k}</th><td class="${v === null || v === undefined ? 'null' : ''}">${v ?? 'Not confirmed'}</td></tr>`)}</tbody>
          </table>
        </section>
      </div>`);
  }

  return {
    open(part) {
      if (!part) return;
      current = part;
      fill(part, app.store.build);
      dialog.setAttribute('aria-labelledby', 'drawer-title');
      if (!dialog.open) dialog.showModal();
      fillTrend(dialog, part);
      dialog.querySelector('[data-action="close"]')?.focus();
    },
    refresh(build) {
      if (dialog.open && current) {
        fill(current, build);
        fillTrend(dialog, current);
      }
    },
  };
}
