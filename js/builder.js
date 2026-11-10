// Builder page controller: loads the catalogue, owns UI state (not build state, which
// lives in js/state.js), routes actions between panels and re-renders on every change.
import { loadCatalog } from './catalog.js';
import { CATEGORIES, getCategory } from './categories.js';
import { buildStore } from './state.js';
import { checkBuild, summarize } from './compat.js';
import { priceBuild, formatTHB } from './pricing.js';
import { SavedBuilds } from './saved-builds.js';
import { allParts } from './compat/util.js';
import { mountCategoryList } from './ui/category-list.js';
import { mountPartBrowser } from './ui/part-browser.js';
import { mountPartDetail } from './ui/part-detail.js';
import { mountSummary } from './ui/summary.js';
import { mountAutofill } from './ui/autofill-dialog.js';
import { mountBuildsDialog } from './ui/builds-dialog.js';

const $ = (s) => document.querySelector(s);
const UI_KEY = 'rigsmith.ui.v1';

// Per-viewer conveniences only (open category, last auto-fill inputs, which save is open).
function loadUiPrefs() {
  try { return JSON.parse(localStorage.getItem(UI_KEY) ?? '{}') ?? {}; } catch { return {}; }
}
function saveUiPrefs(ui) {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify({ category: ui.category, autofill: ui.autofill, current: ui.current, dirty: ui.dirty }));
  } catch { /* storage blocked: preferences just don't persist */ }
}

const prefs = loadUiPrefs();
const app = {
  catalog: null,
  store: buildStore,
  saved: new SavedBuilds(),
  ui: {
    category: CATEGORIES.some((c) => c.id === prefs.category) ? prefs.category : 'cpu',
    browse: {},
    showIncompatible: true,
    swap: null,
    tab: 'parts',
    view: 'parts',
    autofill: { budget: 40000, use: 'gaming', size: 'full', ...prefs.autofill },
    current: prefs.current ?? null,
    dirty: prefs.dirty ?? false,
  },
};

// ---------------------------------------------------------------- actions
const adds = (cat) => cat.multiple && cat.pickMode === 'add';

app.select = (part) => {
  const cat = getCategory(part.category);
  const swap = app.ui.swap?.category === cat.id ? app.ui.swap : null;
  if (swap && swap.id === part.id) {
    app.cancelSwap();
    app.toast(`Kept ${part.name}.`);
  } else if (swap) {
    const old = app.catalog.get(swap.id);
    app.ui.swap = null;
    app.store.replace(swap.id, part);
    app.toast(`Swapped ${old?.name ?? 'part'} for ${part.name}.`);
  } else if (cat.multiple && !adds(cat)) {
    app.store.set(cat.id, [part]);
    app.toast(`${cat.label}: ${part.name}.`);
  } else {
    const previous = app.store.add(part);
    app.toast(previous ? `Replaced ${previous.name} with ${part.name}.` : `Added ${part.name}.`);
  }
};

app.remove = (category, id) => {
  const part = app.catalog.get(id);
  if (app.store.remove(category, id)) app.toast(`Removed ${part?.name ?? 'part'}.`);
  if (app.ui.swap?.id === id) app.ui.swap = null;
};

app.startSwap = (category, id) => {
  const cat = getCategory(category);
  app.ui.swap = adds(cat) ? { category, id } : null;
  app.setCategory(category, { focusBrowser: true });
};
app.cancelSwap = () => {
  app.ui.swap = null;
  renderNow();
};

app.setCategory = (category, { focusBrowser = false } = {}) => {
  app.ui.category = category;
  if (app.ui.swap && app.ui.swap.category !== category) app.ui.swap = null;
  app.ui.tab = 'parts';
  setView('parts');
  renderNow();
  if (focusBrowser) browser.focusTitle();
};

app.openDetail = (part) => detail.open(part);

app.applyBuild = (build, label) => {
  for (const c of CATEGORIES) app.store.set(c.id, build[c.id]);
  app.ui.current = null;
  app.ui.dirty = true;
  app.toast(`${label}: applied. Save it from Builds to keep it.`);
};

app.loadSaved = (id) => {
  const entry = app.saved.get(id);
  if (!entry) return;
  const { missing } = app.store.fromJSON(entry.data, app.catalog);
  app.store.save();
  app.ui.current = { id: entry.id, name: entry.name };
  app.ui.dirty = false;
  renderNow();
  app.toast(`Loaded “${entry.name}”.${missing.length ? ` ${missing.length} part(s) are no longer in the catalogue and were left out.` : ''}`);
};

app.saveCurrent = (name, asNew) => {
  const id = !asNew && app.ui.current ? app.ui.current.id : null;
  const entry = app.saved.save(name, app.store.toJSON(), id);
  if (!entry) return app.toast('Could not save: browser storage is full or blocked.', 'error');
  app.ui.current = { id: entry.id, name: entry.name };
  app.ui.dirty = false;
  renderNow();
  app.toast(`Saved “${entry.name}”.`);
};

app.refreshTitle = () => {
  const cur = app.ui.current;
  $('#build-name').textContent = cur ? cur.name : 'Untitled build';
  $('#build-state').textContent = cur ? (app.ui.dirty ? 'Unsaved changes' : 'Saved') : allParts(app.store.build).length ? 'Not saved' : '';
  saveUiPrefs(app.ui);
};

let toastTimer;
app.toast = (msg, level = 'ok') => {
  const t = $('#toast');
  t.textContent = msg;
  t.dataset.level = level;
  t.dataset.show = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.dataset.show = 'false'; }, 3200);
};

// ---------------------------------------------------------------- panels
let catList; let browser; let detail; let summary; let autofill; let builds;

function setView(view) {
  app.ui.view = view;
  $('#view-parts').hidden = view !== 'parts';
  $('#view-3d').hidden = view !== '3d';
  for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
}

function setTab(tab) {
  app.ui.tab = tab;
  $('#builder-grid').dataset.tab = tab;
  for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-pressed', String(b.dataset.tab === tab));
}

let frame = 0;
function scheduleRender() {
  if (frame) return;
  frame = requestAnimationFrame(renderNow);
}

function renderNow() {
  cancelAnimationFrame(frame);
  frame = 0;
  const build = app.store.build;
  const issues = checkBuild(build);
  catList.render(build, issues);
  browser.render(build);
  summary.render(build, issues);
  detail.refresh(build);
  setTab(app.ui.tab);

  // Mobile bar: total and status at a glance.
  const s = summarize(issues);
  const total = priceBuild(build).total;
  $('#mbar-total').textContent = formatTHB(total);
  const status = $('#mbar-status');
  status.className = `tag tag--dot ${s.error ? 'tag--error' : s.warn ? 'tag--warn' : total ? 'tag--ok' : ''}`;
  status.textContent = s.error ? `${s.error} error${s.error > 1 ? 's' : ''}` : s.warn ? `${s.warn} warning${s.warn > 1 ? 's' : ''}` : total ? 'No errors' : 'Empty';
  app.refreshTitle();
}

// ---------------------------------------------------------------- keyboard
const typing = (el) => el.closest('input, select, textarea, [contenteditable="true"]');

function onKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || document.querySelector('dialog[open]')) return;
  const i = CATEGORIES.findIndex((c) => c.id === app.ui.category);
  const go = (n) => app.setCategory(CATEGORIES[(n + CATEGORIES.length) % CATEGORIES.length].id);
  if (e.key === '/') { e.preventDefault(); setTab('parts'); setView('parts'); browser.focusSearch(); }
  else if (e.key === ']') go(i + 1);
  else if (e.key === '[') go(i - 1);
  else if (/^[1-9]$/.test(e.key) && CATEGORIES[Number(e.key) - 1]) app.setCategory(CATEGORIES[Number(e.key) - 1].id);
  else if (e.key === 'a' || e.key === 'A') autofill.open();
  else if (e.key === 'b' || e.key === 'B') builds.open();
  else if (e.key === 'v' || e.key === 'V') setView(app.ui.view === 'parts' ? '3d' : 'parts');
  else if (e.key === '?') $('#shortcuts-dialog').showModal();
  else return;
}

// ---------------------------------------------------------------- start
let clearArmed = null;

async function init() {
  const loader = $('#loader');
  try {
    app.catalog = await loadCatalog();
  } catch (err) {
    console.warn('Rigsmith: parts data failed to load.', err);
    $('#loader-step').textContent = 'Could not load the parts data. If you opened this file directly, serve the folder instead (e.g. python -m http.server).';
    return;
  }
  const { missing } = app.store.load(app.catalog);

  catList = mountCategoryList($('#cat-list'), app);
  browser = mountPartBrowser($('#view-parts'), app);
  summary = mountSummary($('#summary'), app);
  detail = mountPartDetail($('#part-drawer'), app);
  autofill = mountAutofill($('#autofill-dialog'), app);
  builds = mountBuildsDialog($('#builds-dialog'), app);

  app.store.addEventListener('change', (e) => {
    if (e.detail.action !== 'load') app.ui.dirty = true;
    scheduleRender();
  });

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]');
    if (!b) return;
    const cmd = b.dataset.cmd;
    if (cmd === 'autofill') autofill.open();
    if (cmd === 'builds') builds.open();
    if (cmd === 'shortcuts') $('#shortcuts-dialog').showModal();
    if (cmd === 'close-dialog') b.closest('dialog').close();
    if (cmd === 'clear') {
      if (!allParts(app.store.build).length) return;
      if (clearArmed) {
        clearTimeout(clearArmed);
        clearArmed = null;
        b.textContent = 'Clear';
        app.store.clear();
        app.ui.current = null;
        app.ui.dirty = false;
        app.toast('Build cleared.');
      } else {
        b.textContent = 'Confirm clear';
        clearArmed = setTimeout(() => { clearArmed = null; b.textContent = 'Clear'; }, 4000);
      }
    }
  });
  for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => setView(b.dataset.view));
  for (const b of document.querySelectorAll('[data-tab]')) b.addEventListener('click', () => setTab(b.dataset.tab));
  $('#shortcuts-dialog').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  document.addEventListener('keydown', onKey);

  setView('parts');
  renderNow();
  loader.dataset.done = 'true';
  loader.setAttribute('aria-busy', 'false');
  if (missing.length) app.toast(`${missing.length} saved part(s) are no longer in the catalogue and were left out.`, 'warn');
  if (new URLSearchParams(location.search).get('mode') === 'auto') autofill.open();
}

init();
