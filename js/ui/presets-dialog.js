// Builder: the Presets dialog. Cards from preset-cards.js; "Open in builder" applies the
// preset, "Watch it build" applies it and plays the Auto-build cinematic. Replacing unsaved
// parts asks twice, like loading a saved build.
import { loadPresets, presetBuild } from '../presets.js?v=5b4c14becb';
import { allParts } from '../compat/util.js?v=5b4c14becb';
import { html, render } from './dom.js?v=5b4c14becb';
import { renderPresetCards, presetCompareUrl } from './preset-cards.js?v=5b4c14becb';

const ARM_MS = 4000;

export function mountPresetsDialog(dialog, app) {
  let presets = null;
  let armed = null;
  let disarm = null;
  let cards = null;

  const risky = () => app.ui.dirty && allParts(app.store.build).length > 0;

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) return dialog.close();
    const b = e.target.closest('[data-action]');
    if (!b) return;
    if (b.dataset.action === 'close') return dialog.close();
    const preset = presets?.find((p) => p.id === b.dataset.preset);
    if (!preset) return;
    const key = `${b.dataset.action}-${preset.id}`;
    if (risky() && armed !== key) {
      clearTimeout(disarm);
      resetArmed();
      armed = key;
      b.textContent = 'Replace unsaved build?';
      disarm = setTimeout(resetArmed, ARM_MS);
      return;
    }
    resetArmed();
    dialog.close();
    app.applyBuild(presetBuild(preset, app.catalog), preset.name);
    app.ui.suggestedName = preset.name;
    if (b.dataset.action === 'watch') app.autoBuild();
  });

  function resetArmed() {
    armed = null;
    for (const b of dialog.querySelectorAll('[data-action="open"]')) b.textContent = 'Open in builder';
    for (const b of dialog.querySelectorAll('[data-action="watch"]')) b.textContent = 'Watch it build';
  }

  async function open() {
    render(dialog, html`
      <div class="modal__inner">
        <header class="modal__head">
          <div>
            <p class="label">Starting points</p>
            <h2 id="presets-title">Preset builds</h2>
          </div>
          <button class="btn btn--sm btn--ghost" type="button" data-action="close">Close</button>
        </header>
        <p class="presets__intro">Eight complete builds from the catalogue, each with zero compatibility errors. Open one to change parts, or watch it assemble in 3D.</p>
        <div data-ref="cards"><p class="muted">Loading presets…</p></div>
      </div>`);
    dialog.setAttribute('aria-labelledby', 'presets-title');
    if (!dialog.open) dialog.showModal();
    try {
      presets ??= await loadPresets();
    } catch (err) {
      console.warn('Rigsmith: presets failed to load.', err);
      render(dialog.querySelector('[data-ref="cards"]'), html`<p class="callout callout--warn">The presets could not be loaded. Check your connection and try again.</p>`);
      return;
    }
    cards?.disconnect();
    cards = renderPresetCards(dialog.querySelector('[data-ref="cards"]'), {
      presets,
      catalog: app.catalog,
      actions: (s) => html`
        <button class="btn btn--sm btn--primary" type="button" data-action="open" data-preset="${s.preset.id}">Open in builder</button>
        <button class="btn btn--sm" type="button" data-action="watch" data-preset="${s.preset.id}">Watch it build</button>
        <a class="linkbtn preset__compare" href="${presetCompareUrl(s)}">Compare</a>`,
    });
    dialog.querySelector('[data-action="open"]')?.focus();
  }

  dialog.addEventListener('close', () => { cards?.disconnect(); resetArmed(); });
  return { open };
}
