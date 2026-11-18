// compare.html controller. Columns (up to three builds) come from the link (?b=…&n=…, one
// pair per column), or by default from the builder's current build and two presets. More
// can be added from saved builds, presets or the current build. The URL always holds the
// comparison, so "Copy link" shares exactly what is on screen. Swaps never touch the
// builder's own build.
import { loadCatalog } from './catalog.js?v=00a22f4faf';
import { BuildStore } from './state.js?v=00a22f4faf';
import { SavedBuilds } from './saved-builds.js?v=00a22f4faf';
import { loadPresets, presetBuild } from './presets.js?v=00a22f4faf';
import { encodeBuild, decodeBuild, buildFromIds, missingMessage, shareUrl, compareUrl, readShareParams } from './share.js?v=00a22f4faf';
import { allParts } from './compat/util.js?v=00a22f4faf';
import { renderCompare, linkScroll, MAX_COLUMNS } from './ui/compare-table.js?v=00a22f4faf';
import { mountSwapDialog, withPart } from './ui/swap-dialog.js?v=00a22f4faf';
import { copyWithFeedback, copyText, downloadCSV, printBuilds, wireMenus } from './ui/share-tools.js?v=00a22f4faf';
import { setPrintSheets, specSheet } from './ui/spec-sheet.js?v=00a22f4faf';
import { html, render } from './ui/dom.js?v=00a22f4faf';

const $ = (s) => document.querySelector(s);
const DEFAULT_PRESETS = ['mid-1440p', 'high-1440p'];

const app = { catalog: null, presets: [], cols: [], uid: 0 };

let toastTimer;
function toast(msg, level = 'ok') {
  const t = $('#toast');
  t.textContent = msg;
  t.dataset.level = level;
  t.dataset.show = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.dataset.show = 'false'; }, 3600);
}

function notices(list) {
  const el = $('#cmp-msg');
  render(el, list.length ? html`<div class="callout callout--warn"><p class="label">Some of the link could not be loaded</p>${list.map((m) => html`<p>${m}</p>`)}</div>` : '');
}

// ---------------------------------------------------------------- sources
function currentBuild() {
  const s = new BuildStore({ autosave: false });
  const { loaded } = s.load(app.catalog);
  return loaded && allParts(s.build).length ? s.build : null;
}
const saved = new SavedBuilds();
function savedBuild(entry) {
  const s = new BuildStore({ storage: null });
  s.fromJSON(entry.data, app.catalog);
  return s.build;
}

function column(name, build) {
  const link = shareUrl(location.href, { code: encodeBuild(build, app.catalog), name });
  return { uid: ++app.uid, name, build, original: build, link };
}
function refreshLink(col) {
  col.link = shareUrl(location.href, { code: encodeBuild(col.build, app.catalog), name: col.name });
}

function addSlot() {
  const cur = currentBuild();
  const list = saved.list();
  return html`
    <form class="cmp__add" data-form="add">
      <label class="field"><span class="field__label">Add a build</span>
        <select class="input" name="source" required>
          ${cur ? html`<option value="current">Current build in the builder</option>` : ''}
          ${list.length ? html`<optgroup label="Saved builds">${list.map((e) => html`<option value="saved:${e.id}">${e.name}</option>`)}</optgroup>` : ''}
          <optgroup label="Presets">${app.presets.map((p) => html`<option value="preset:${p.id}">${p.name}</option>`)}</optgroup>
        </select>
      </label>
      <button class="btn btn--sm btn--primary" type="submit">Add</button>
    </form>`;
}

function addSource(value) {
  if (app.cols.length >= MAX_COLUMNS) return;
  if (value === 'current') {
    const b = currentBuild();
    if (b) app.cols.push(column('Current build', b));
  } else if (value.startsWith('saved:')) {
    const e = saved.get(value.slice(6));
    if (e) app.cols.push(column(e.name, savedBuild(e)));
  } else if (value.startsWith('preset:')) {
    const p = app.presets.find((x) => x.id === value.slice(7));
    if (p) app.cols.push(column(p.name, presetBuild(p, app.catalog)));
  }
  update();
}

// ---------------------------------------------------------------- render + URL
const root = () => $('#cmp');
function syncUrl() {
  const url = compareUrl(location.href, app.cols.map((c) => ({ code: encodeBuild(c.build, app.catalog), name: c.name })));
  history.replaceState(null, '', url);
}
function update() {
  app.cols.forEach(refreshLink);
  renderCompare(root(), app.cols, { catalog: app.catalog, addSlot: addSlot() });
  root().hidden = false;
  $('#cmp-empty').hidden = app.cols.length > 0;
  syncUrl();
}

// ---------------------------------------------------------------- actions
let swap;
function onClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const i = Number(b.dataset.col);
  const col = app.cols[i];
  const act = b.dataset.act;
  if (act === 'swap' && col) swap.open({ col: i, name: col.name, build: col.build, category: b.dataset.cat, index: Number(b.dataset.index) });
  if (act === 'undo' && col) {
    col.build = col.original;
    update();
    toast(`${col.name}: back to how it was added.`);
  }
  if (act === 'remove' && col) {
    app.cols.splice(i, 1);
    update();
    toast(`Removed ${col.name} from the comparison.`);
  }
  if (act === 'copy' && col) copyText(col.link).then((ok) => toast(ok ? `Link to ${col.name} copied.` : 'Could not copy the link.', ok ? 'ok' : 'warn'));
  if (act === 'csv' && col) {
    downloadCSV(col.build, { name: col.name, link: col.link });
    toast(`Parts list for ${col.name} saved as CSV.`);
  }
  if (act === 'print' && col) printBuilds([{ build: col.build, name: col.name, link: col.link }]);
}

async function init() {
  try {
    [app.catalog, app.presets] = await Promise.all([loadCatalog(), loadPresets()]);
  } catch (err) {
    console.warn('Rigsmith: compare data failed to load.', err);
    $('#cmp-loading').textContent = 'Could not load the parts data. If you opened this file directly, serve the folder instead (e.g. python -m http.server).';
    return;
  }
  $('#cmp-loading').hidden = true;

  // Columns from the link, reporting anything that didn't resolve.
  const msgs = [];
  for (const [k, p] of readShareParams(location.search).slice(0, MAX_COLUMNS).entries()) {
    const d = decodeBuild(p.code, app.catalog);
    const name = p.name || `Build ${'ABC'[k]}`;
    if (!d.ok) { msgs.push(`${name}: ${d.error}`); continue; }
    if (d.missing.length) msgs.push(`${name}: ${missingMessage(d.missing)}`);
    app.cols.push(column(name, buildFromIds(d.ids, app.catalog)));
  }
  if (readShareParams(location.search).length > MAX_COLUMNS) msgs.push(`The link had more than ${MAX_COLUMNS} builds; the first ${MAX_COLUMNS} are shown.`);
  notices(msgs);
  // No link: the current build next to two presets.
  if (!readShareParams(location.search).length) {
    const cur = currentBuild();
    if (cur) app.cols.push(column('Current build', cur));
    for (const id of DEFAULT_PRESETS) {
      const p = app.presets.find((x) => x.id === id);
      if (p && app.cols.length < 2 + (cur ? 1 : 0) && app.cols.length < MAX_COLUMNS) app.cols.push(column(p.name, presetBuild(p, app.catalog)));
    }
  }

  linkScroll(root());
  swap = mountSwapDialog($('#swap-dialog'), {
    catalog: app.catalog,
    onChoose: ({ col, category, index, part }) => {
      const c = app.cols[col];
      if (!c) return;
      c.build = withPart(c.build, category, index, part);
      update();
      toast(`${c.name}: now with ${part.name}.`);
    },
  });
  document.addEventListener('click', onClick);
  document.addEventListener('submit', (e) => {
    if (e.target.dataset.form !== 'add') return;
    e.preventDefault();
    addSource(new FormData(e.target).get('source'));
  });
  wireMenus();

  $('[data-cmd="copy-link"]').addEventListener('click', async (e) => {
    syncUrl();
    const ok = await copyWithFeedback(e.currentTarget, location.href, $('#copy-status'));
    if (!ok) toast('Could not copy automatically. Select the link in the address bar instead.', 'warn');
  });
  const sheets = () => app.cols.map((c) => ({ build: c.build, name: c.name, link: c.link }));
  $('[data-cmd="print-all"]').addEventListener('click', () => {
    if (app.cols.length) printBuilds(sheets());
  });
  // Ctrl+P: one spec sheet per build.
  addEventListener('beforeprint', () => {
    if (!document.querySelector('#print-sheet .sheet')) setPrintSheets(sheets().map((s) => specSheet(s.build, s)));
  });
  addEventListener('afterprint', () => setPrintSheets([]));

  update();
}

init();
