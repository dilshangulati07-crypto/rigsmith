// Auto-fill dialog: budget, use and size in; a checked build with reasons out.
import { CATEGORIES } from '../categories.js?v=733eefba1e';
import { autoBuild, USES, SIZES } from '../autobuild.js?v=733eefba1e';
import { formatTHB, PRICE_NOTE } from '../pricing.js?v=733eefba1e';
import { html, render, num } from './dom.js?v=733eefba1e';

const PRESETS = [25000, 40000, 60000, 100000, 150000];
const USE_NOTES = {
  gaming: 'Frame rates, weighted to 1080p and 1440p',
  creator: 'Video editing: cores, memory, fast storage',
  office: 'Everyday work, browsing, light editing',
  ai: 'Local AI models: GPU compute and VRAM',
};
const SIZE_NOTES = { full: 'Mid or full tower', compact: 'mATX or ITX case' };

export function mountAutofill(dialog, app) {
  const opts = app.ui.autofill;
  let result = null;
  let watchFirst = false; // opened from the landing page's "Auto-build a PC"

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) return dialog.close();
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const a = b.dataset.action;
    if (a === 'close') dialog.close();
    if (a === 'preset') {
      opts.budget = Number(b.dataset.value);
      dialog.querySelector('input[name="budget"]').value = opts.budget;
    }
    if (a === 'back') showForm();
    if ((a === 'apply' || a === 'watch') && result?.ok) {
      app.applyBuild(result.build, `Auto-fill: ${USES[result.use].label}, ${formatTHB(result.budget)}`);
      dialog.close();
      if (a === 'watch') app.autoBuild();
    }
  });

  dialog.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    opts.budget = Math.round(Number(f.get('budget')) || 0);
    opts.use = f.get('use');
    opts.size = f.get('size');
    if (opts.budget < 10000 || opts.budget > 1000000) {
      const input = dialog.querySelector('input[name="budget"]');
      input.setCustomValidity('Enter a budget between 10,000 and 1,000,000 THB.');
      input.reportValidity();
      input.addEventListener('input', () => input.setCustomValidity(''), { once: true });
      return;
    }
    render(dialog, html`<div class="modal__inner"><p class="label" role="status">Checking combinations…</p></div>`);
    // Let the status paint before the search (a few tens of ms) runs.
    setTimeout(() => {
      result = autoBuild(app.catalog, opts);
      showResult();
    }, 30);
  });

  function showForm() {
    render(dialog, html`
      <form class="modal__inner" method="dialog" novalidate>
        <header class="modal__head">
          <h2 id="af-title">Auto-fill a build</h2>
          <button class="btn btn--sm btn--ghost" type="button" data-action="close">Close</button>
        </header>
        <p class="muted">Finds the compatible build with the best performance estimate for your use, within budget. ${PRICE_NOTE}.</p>

        <div class="field">
          <label class="field__label" for="af-budget">Budget (THB)</label>
          <input class="input input--lg mono" id="af-budget" name="budget" type="number" inputmode="numeric" min="10000" max="1000000" step="1000" value="${opts.budget}" required>
          <div class="chips" role="group" aria-label="Budget presets">
            ${PRESETS.map((v) => html`<button class="chip" type="button" data-action="preset" data-value="${v}">${num(v / 1000)}k</button>`)}
          </div>
        </div>

        <fieldset class="field">
          <legend class="field__label">Use</legend>
          <div class="options">
            ${Object.entries(USES).map(([id, u]) => html`
              <label class="option"><input type="radio" name="use" value="${id}" ${opts.use === id ? 'checked' : ''}>
                <span class="option__body"><span class="option__title">${u.label}</span><span class="option__note">${USE_NOTES[id]}</span></span></label>`)}
          </div>
        </fieldset>

        <fieldset class="field">
          <legend class="field__label">Size</legend>
          <div class="options options--2">
            ${Object.entries(SIZES).map(([id, s]) => html`
              <label class="option"><input type="radio" name="size" value="${id}" ${opts.size === id ? 'checked' : ''}>
                <span class="option__body"><span class="option__title">${s.label}</span><span class="option__note">${SIZE_NOTES[id]}</span></span></label>`)}
          </div>
        </fieldset>

        <footer class="modal__foot">
          <button class="btn btn--ghost" type="button" data-action="close">Cancel</button>
          <button class="btn btn--primary" type="submit">Find build</button>
        </footer>
      </form>`);
    dialog.querySelector('input[name="budget"]').focus();
  }

  function showResult() {
    const r = result;
    if (!r.ok) {
      render(dialog, html`
        <div class="modal__inner">
          <header class="modal__head"><h2 id="af-title">No build found</h2><button class="btn btn--sm btn--ghost" type="button" data-action="close">Close</button></header>
          <p>${r.message}</p>
          <footer class="modal__foot"><button class="btn btn--primary" type="button" data-action="back">Change budget</button></footer>
        </div>`);
      dialog.querySelector('[data-action="back"]').focus();
      return;
    }
    const rows = CATEGORIES.flatMap((c) => {
      const v = r.build[c.id];
      const items = Array.isArray(v) ? v : [v];
      return items.map((p) => ({ c, p }));
    }).filter(({ c, p }) => p || ['cooler', 'gpu'].includes(c.id));

    render(dialog, html`
      <div class="modal__inner">
        <header class="modal__head">
          <div>
            <p class="label">${USES[r.use].label} · ${SIZES[r.size].label} · budget ${formatTHB(r.budget)}</p>
            <h2 id="af-title">${formatTHB(r.total)} <span class="muted af-score">· score ${r.score}/100 (estimate)</span></h2>
          </div>
          <button class="btn btn--sm btn--ghost" type="button" data-action="close">Close</button>
        </header>
        <p class="sum__counts">
          <span class="tag tag--ok tag--dot">${r.summary.error} errors</span>
          <span class="tag ${r.summary.warn ? 'tag--warn' : ''} tag--dot">${r.summary.warn} warnings</span>
          <span class="tag tag--dot">${r.summary.info} notes</span>
          <span class="muted mono af-meta">${PRICE_NOTE.toLowerCase()} · ${formatTHB(r.budget - r.total)} unspent</span>
        </p>
        <ol class="af-list">
          ${rows.map(({ c, p }) => html`
            <li class="af-row">
              <span class="label">${c.label}</span>
              <span class="af-row__name">${p ? p.name : c.id === 'gpu' ? 'None (integrated graphics)' : 'Boxed cooler'}</span>
              <span class="mono af-row__price">${p ? formatTHB(p.refPriceTHB) : '—'}</span>
              <span class="af-row__why">${r.reasons[c.id] ?? ''}</span>
            </li>`)}
        </ol>
        ${r.reasons.upgrades ? html`<p class="sum__small">${r.reasons.upgrades}</p>` : ''}
        <footer class="modal__foot">
          <button class="btn btn--ghost" type="button" data-action="back">Change inputs</button>
          <button class="btn ${watchFirst ? '' : 'btn--primary'}" type="button" data-action="apply">Use this build</button>
          <button class="btn ${watchFirst ? 'btn--primary' : ''}" type="button" data-action="watch">Watch it build</button>
        </footer>
        <p class="sum__small">Both replace the parts in your current build. Save first if you want to keep them. Watch it build plays the assembly in the 3D view, in the real install order.</p>
      </div>`);
    dialog.querySelector(`[data-action="${watchFirst ? 'watch' : 'apply'}"]`).focus();
  }

  return {
    /** @param {{watch?: boolean}} o watch: lead with "Watch it build" */
    open({ watch = false } = {}) {
      watchFirst = watch;
      showForm();
      dialog.setAttribute('aria-labelledby', 'af-title');
      if (!dialog.open) dialog.showModal();
      dialog.querySelector('input[name="budget"]').focus();
    },
  };
}
