// Part detail drawer: full spec table, how the part fits the current build, links.
import { getCategory } from '../categories.js?v=fe48996dc3';
import { isPartCompatible } from '../compat.js?v=fe48996dc3';
import { unknownFields } from '../compat/util.js?v=fe48996dc3';
import { formatTHB, PRICE_NOTE } from '../pricing.js?v=fe48996dc3';
import { partType, commonSpecs } from './part-types/index.js?v=fe48996dc3';
import { html, render } from './dom.js?v=fe48996dc3';

const LEVEL = { error: 'Error', warn: 'Warning', info: 'Note' };

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
      dialog.querySelector('[data-action="close"]')?.focus();
    },
    refresh(build) {
      if (dialog.open && current) fill(current, build);
    },
  };
}
