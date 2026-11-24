// Builder: Export → Post to the gallery. Sends the build's share code with a name (and
// optionally the poster's name and a note) to /api/gallery; it appears on gallery.html once
// approved in the admin dashboard.
import { encodeBuild } from '../share.js?v=4fbe99bdc0';
import { allParts } from '../compat/util.js?v=4fbe99bdc0';
import { checkBuild } from '../compat.js?v=4fbe99bdc0';
import { postBuild } from '../gallery-api.js?v=4fbe99bdc0';
import { track } from '../track.js?v=4fbe99bdc0';
import { html, render } from './dom.js?v=4fbe99bdc0';

const NEEDED = { cpu: 'a processor', motherboard: 'a motherboard', ram: 'memory', storage: 'storage', psu: 'a power supply', case: 'a case' };

export function mountGalleryPost(dialog, app) {
  const missing = () => Object.entries(NEEDED).filter(([k]) => (Array.isArray(app.store.build[k]) ? !app.store.build[k].length : !app.store.build[k])).map(([, l]) => l);

  function open() {
    if (!allParts(app.store.build).length) return app.toast('Add some parts first: an empty build has nothing to post.', 'warn');
    const lacking = missing();
    if (lacking.length) return app.toast(`Finish the build before posting it: it still needs ${lacking.join(', ')}.`, 'warn');
    const errors = checkBuild(app.store.build).filter((i) => i.level === 'error').length;
    const name = app.ui.current?.name ?? app.ui.suggestedName ?? '';
    render(dialog, html`
      <form class="modal__inner" method="dialog" id="gp-form" novalidate>
        <header class="modal__head">
          <div><p class="label">Share with everyone</p><h2 id="gp-title">Post to the gallery</h2></div>
          <button class="btn btn--sm btn--ghost" type="button" data-gp="close">Close</button>
        </header>
        <p class="muted" style="margin-top:0">Your build goes on the <a href="gallery.html">Gallery</a> page once it has been checked, usually within a day. Only the parts, the name and what you write here are shared.</p>
        ${errors ? html`<div class="callout callout--warn" style="margin-bottom:var(--s-4)"><p class="label">This build has ${errors} compatibility error${errors === 1 ? '' : 's'}</p><p>You can still post it, but fixing it first makes a better example for others.</p></div>` : ''}
        <label class="field"><span class="field__label">Build name</span>
          <input class="input" name="name" required minlength="3" maxlength="60" value="${name === 'Untitled build' ? '' : name}" placeholder="e.g. White 1440p streaming rig" autocomplete="off"></label>
        <label class="field"><span class="field__label">Your name <span class="muted">(optional)</span></span>
          <input class="input" name="author" maxlength="40" placeholder="Shown as “by …”" autocomplete="nickname"></label>
        <label class="field"><span class="field__label">A note <span class="muted">(optional, <span data-gp="count">0</span>/280)</span></span>
          <textarea class="input gp-note" name="note" maxlength="280" rows="3" placeholder="What it's for, what you'd change…"></textarea></label>
        <label class="gp-hp" aria-hidden="true">Website <input name="website" tabindex="-1" autocomplete="off"></label>
        <p class="gp-msg" role="status" aria-live="polite"></p>
        <div class="modal__foot">
          <button class="btn btn--sm" type="button" data-gp="close">Cancel</button>
          <button class="btn btn--sm btn--primary" type="submit">Post it</button>
        </div>
      </form>`);
    dialog.setAttribute('aria-labelledby', 'gp-title');
    dialog.showModal();
    dialog.querySelector('[name=name]').focus();
  }

  dialog.addEventListener('click', (e) => {
    if (e.target.closest('[data-gp="close"]')) dialog.close();
  });
  dialog.addEventListener('input', (e) => {
    if (e.target.name === 'note') dialog.querySelector('[data-gp="count"]').textContent = e.target.value.length;
  });
  dialog.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const f = new FormData(form);
    const msg = form.querySelector('.gp-msg');
    if (String(f.get('name')).trim().length < 3) {
      msg.textContent = 'Give your build a name (at least 3 characters).';
      form.elements.name.focus();
      return;
    }
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    button.textContent = 'Posting…';
    msg.textContent = '';
    try {
      await postBuild({ code: encodeBuild(app.store.build, app.catalog), name: f.get('name'), author: f.get('author'), note: f.get('note'), website: f.get('website') });
      track('gallery_post');
      dialog.close();
      app.toast('Posted. It shows on the Gallery page once it has been checked.');
    } catch (err) {
      msg.textContent = err.message;
      button.disabled = false;
      button.textContent = 'Post it';
    }
  });

  return { open };
}
