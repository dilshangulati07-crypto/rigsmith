// Saved builds dialog: save the current build under a name; load, rename, duplicate, delete.
import { priceBuild, formatTHB } from '../pricing.js?v=5b4c14becb';
import { BuildStore } from '../state.js?v=5b4c14becb';
import { allParts } from '../compat/util.js?v=5b4c14becb';
import { html, render } from './dom.js?v=5b4c14becb';

const ARM_MS = 4000; // a destructive button stays armed this long after the first click

export function mountBuildsDialog(dialog, app) {
  let renaming = null;
  let armed = null;
  let disarm = null;

  // Resolve a saved entry into parts without touching the app's build.
  const preview = (entry) => {
    const s = new BuildStore({ storage: null });
    const { missing } = s.fromJSON(entry.data, app.catalog);
    const b = s.build;
    return { total: priceBuild(b).total, count: allParts(b).length, missing };
  };

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) return dialog.close();
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const { action, id } = b.dataset;
    if (action === 'close') return dialog.close();
    if (action === 'rename') { renaming = id; return draw(`name-${id}`); }
    if (action === 'cancel-rename') { renaming = null; return draw(`rename-${id}`); }
    if (action === 'duplicate') {
      const e2 = app.saved.duplicate(id);
      app.toast(e2 ? `Saved “${e2.name}”.` : 'Could not save: browser storage is full or blocked.', e2 ? 'ok' : 'error');
      return draw(`dup-${id}`);
    }
    // Two-step confirm for anything that throws work away.
    if (b.dataset.confirm && armed !== `${action}-${id}`) {
      armed = `${action}-${id}`;
      clearTimeout(disarm);
      disarm = setTimeout(() => { armed = null; if (dialog.open) draw(); }, ARM_MS);
      return draw(`${action}-${id}`);
    }
    armed = null;
    if (action === 'load') {
      app.loadSaved(id);
      dialog.close();
    }
    if (action === 'delete') {
      const name = app.saved.get(id)?.name;
      app.saved.remove(id);
      if (app.ui.current?.id === id) app.ui.current = null;
      app.toast(`Deleted “${name}”.`);
      draw();
      dialog.querySelector('input[name="name"]')?.focus();
    }
  });

  dialog.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const f = new FormData(form);
    if (form.dataset.form === 'save') {
      const asNew = e.submitter?.value === 'new';
      app.saveCurrent(f.get('name'), asNew);
      draw('save-name');
    }
    if (form.dataset.form === 'rename') {
      const entry = app.saved.rename(renaming, f.get('name'));
      if (entry && app.ui.current?.id === entry.id) app.ui.current = { id: entry.id, name: entry.name };
      const id = renaming;
      renaming = null;
      app.refreshTitle();
      draw(`rename-${id}`);
    }
  });

  function draw(focusKey) {
    const list = app.saved.list();
    const cur = app.ui.current;
    const defaultName = cur?.name ?? app.ui.suggestedName ?? `Build ${list.length + 1}`;
    // Loading replaces the open build; ask twice only if that would lose unsaved parts.
    const loadRisk = app.ui.dirty && allParts(app.store.build).length > 0;
    render(dialog, html`
      <div class="modal__inner">
        <header class="modal__head">
          <h2 id="builds-title">Saved builds</h2>
          <button class="btn btn--sm btn--ghost" type="button" data-action="close">Close</button>
        </header>
        ${app.saved.available ? '' : html`<p class="callout callout--warn">Browser storage is blocked, so builds can't be saved on this device.</p>`}
        <form class="save-form" data-form="save">
          <label class="field field--grow">
            <span class="field__label">Name for the current build</span>
            <input class="input" name="name" maxlength="60" value="${defaultName}" required data-focus-key="save-name" autocomplete="off">
          </label>
          ${cur ? html`<button class="btn" type="submit" value="update">Update “${cur.name}”</button>` : ''}
          <button class="btn ${cur ? '' : 'btn--primary'}" type="submit" value="new">Save${cur ? ' as new' : ''}</button>
        </form>

        ${list.length ? html`
          <ul class="saved">${list.map((entry) => {
            const p = preview(entry);
            const isCur = cur?.id === entry.id;
            return html`
              <li class="saved__row" ${isCur ? html`data-current="true"` : ''}>
                ${renaming === entry.id
                  ? html`<form class="saved__rename" data-form="rename">
                      <label class="visually-hidden" for="rn-${entry.id}">New name</label>
                      <input class="input" id="rn-${entry.id}" name="name" maxlength="60" value="${entry.name}" required data-focus-key="name-${entry.id}">
                      <button class="btn btn--sm btn--primary" type="submit">Save</button>
                      <button class="btn btn--sm btn--ghost" type="button" data-action="cancel-rename" data-id="${entry.id}">Cancel</button>
                    </form>`
                  : html`<div class="saved__info">
                      <span class="saved__name">${entry.name}${isCur ? html` <span class="tag tag--accent">Open</span>` : ''}</span>
                      <span class="mono muted saved__meta">${p.count} parts · ${formatTHB(p.total)} · ${new Date(entry.savedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}${p.missing.length ? ` · ${p.missing.length} part(s) no longer in catalogue` : ''}</span>
                    </div>
                    <div class="saved__actions">
                      ${btn('load', entry.id, armed === `load-${entry.id}` ? 'Replace unsaved build?' : 'Load', loadRisk)}
                      ${btn('rename', entry.id, 'Rename')}
                      ${btn('duplicate', entry.id, 'Duplicate')}
                      ${btn('delete', entry.id, armed === `delete-${entry.id}` ? 'Confirm delete' : 'Delete', true)}
                    </div>`}
              </li>`;
          })}</ul>`
          : html`<p class="muted">No saved builds yet.</p>`}
        <p class="sum__small">Saved in this browser only. Prices come from the current catalogue when you load: reference prices, not live.</p>
      </div>`);
    if (focusKey) dialog.querySelector(`[data-focus-key="${focusKey}"]`)?.focus();
  }

  const btn = (action, id, label, confirm = false) => html`<button class="btn btn--sm ${action === 'delete' ? 'btn--danger' : 'btn--ghost'}" type="button"
    data-action="${action}" data-id="${id}" data-focus-key="${action}-${id}" ${confirm ? html`data-confirm="true"` : ''}>${label}</button>`;

  return {
    open() {
      renaming = null;
      armed = null;
      draw('save-name');
      dialog.setAttribute('aria-labelledby', 'builds-title');
      if (!dialog.open) dialog.showModal();
      dialog.querySelector('input[name="name"]')?.select();
    },
  };
}
