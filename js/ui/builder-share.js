// Builder: share links in and out, and exports.
//   restore(): ?b= (build code), &h= (build-by-hand progress), &n= (name) or ?preset=<id>
//              [&play=1] on load. Unknown ids are reported and the rest loads. Unsaved work
//              in progress is kept in Saved builds before a link replaces it.
//   commands:  copy-link (L), csv, print, compare.
import { assemblyProgress } from '../state.js?v=00a22f4faf';
import { encodeBuild, decodeBuild, buildFromIds, missingMessage, shareUrl, compareUrl, readShareParams } from '../share.js?v=00a22f4faf';
import { encodeHand, decodeHand, plansFor } from '../share-hand.js?v=00a22f4faf';
import { loadPresets, findPreset, presetBuild } from '../presets.js?v=00a22f4faf';
import { allParts } from '../compat/util.js?v=00a22f4faf';
import { setPrintSheets, specSheet } from './spec-sheet.js?v=00a22f4faf';
import { copyWithFeedback, downloadCSV, printBuilds, wireMenus } from './share-tools.js?v=00a22f4faf';

const LINK_PARAMS = ['b', 'h', 'n', 'preset', 'play'];

export function mountBuilderShare(app) {
  const name = () => app.ui.current?.name ?? app.ui.suggestedName ?? 'Untitled build';

  /** Link to the current build, with the build-by-hand progress when there is any. */
  function currentLink() {
    const build = app.store.build;
    const code = encodeBuild(build, app.catalog);
    let hand = '';
    if (build.case && assemblyProgress.caseId === build.case.id) {
      try { hand = encodeHand(build, assemblyProgress); } catch { hand = ''; }
    }
    return shareUrl(location.href, { code, hand, name: app.ui.current?.name ?? app.ui.suggestedName ?? '' });
  }

  async function copyLink(button) {
    if (!allParts(app.store.build).length) return app.toast('Add some parts first: an empty build has nothing to share.', 'warn');
    const link = currentLink();
    const ok = await copyWithFeedback(button ?? document.querySelector('[data-cmd="copy-link"]'), link, document.getElementById('copy-status'));
    if (!ok) app.toast('Could not copy automatically. Select the link in the address bar instead.', 'warn');
    if (!ok) history.replaceState(null, '', link);
  }

  function sheet() {
    return { build: app.store.build, name: name(), link: allParts(app.store.build).length ? currentLink() : '' };
  }

  // Ctrl+P (or the browser menu) prints the current build too.
  addEventListener('beforeprint', () => {
    if (!document.querySelector('#print-sheet .sheet')) setPrintSheets([specSheet(app.store.build, sheet())]);
  });
  addEventListener('afterprint', () => setPrintSheets([]));

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]');
    if (!b) return;
    const cmd = b.dataset.cmd;
    if (cmd === 'copy-link') copyLink(b);
    if (cmd === 'csv') {
      if (!allParts(app.store.build).length) return app.toast('Add some parts first: the CSV lists the build’s parts.', 'warn');
      downloadCSV(app.store.build, sheet());
      app.toast('Parts list saved as CSV, with a search link for each part.');
    }
    if (cmd === 'print') printBuilds([sheet()]);
    if (cmd === 'compare') location.href = compareUrl(location.href, [{ code: encodeBuild(app.store.build, app.catalog) || '1', name: name() }]);
  });
  wireMenus();

  // Before a link replaces the build: keep unsaved parts as a saved build.
  function keepWorkInProgress(nextCode) {
    const parts = allParts(app.store.build);
    if (!parts.length || encodeBuild(app.store.build, app.catalog) === nextCode) return null;
    if (app.ui.current && !app.ui.dirty) return null; // already saved as it is
    const stamp = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    return app.saved.save(`${app.ui.current?.name ?? 'Unsaved build'} (kept ${stamp})`, app.store.toJSON());
  }

  function applyIds(ids, label) {
    app.store.fromJSON({ parts: ids }, app.catalog);
    app.store.save();
    app.ui.current = null;
    app.ui.dirty = true;
    app.ui.suggestedName = label || null;
  }

  function stripParams() {
    // Filter the raw pairs so flags like ?debug3d stay as written (URLSearchParams adds "=").
    const keep = location.search.slice(1).split('&').filter((kv) => kv && !LINK_PARAMS.includes(decodeURIComponent(kv.split('=')[0])));
    history.replaceState(null, '', location.pathname + (keep.length ? `?${keep.join('&')}` : '') + location.hash);
  }

  /** Read link params once at start-up. Returns { play } when the preset asked to auto-build. */
  async function restore() {
    const params = new URLSearchParams(location.search);
    const presetId = params.get('preset');
    const [link] = readShareParams(location.search);
    if (!presetId && !link) return { play: false };
    stripParams();
    const notes = [];
    let level = 'ok';

    if (presetId) {
      let preset = null;
      try { preset = findPreset(await loadPresets(), presetId); } catch { preset = null; }
      if (!preset) {
        app.toast(`There is no preset called “${presetId}”. Your build was left as it was.`, 'warn');
        return { play: false };
      }
      const build = presetBuild(preset, app.catalog);
      const kept = keepWorkInProgress(encodeBuild(build, app.catalog));
      applyIds(Object.fromEntries(Object.entries(build).map(([k, v]) => [k, Array.isArray(v) ? v.map((p) => p.id) : v?.id ?? null])), preset.name);
      notes.push(`Preset loaded: ${preset.name}.`);
      if (kept) notes.push(`Your previous build is in Builds as “${kept.name}”.`);
      app.toast(notes.join(' '));
      return { play: params.get('play') === '1' };
    }

    const d = decodeBuild(link.code, app.catalog);
    if (!d.ok) {
      app.toast(`${d.error} Your build was left as it was.`, 'error');
      return { play: false };
    }
    const kept = keepWorkInProgress(encodeBuild(buildFromIds(d.ids, app.catalog), app.catalog));
    applyIds(d.ids, link.name);
    notes.push(`Loaded a shared build${link.name ? `: ${link.name}` : ''}.`);
    if (d.missing.length) { notes.push(missingMessage(d.missing)); level = 'warn'; }

    if (link.hand) {
      const build = app.store.build;
      const h = decodeHand(link.hand, build, plansFor(build));
      if (h.ok) {
        assemblyProgress.sync(h.state.caseId, (k) => k);
        assemblyProgress.fill(h.state);
        assemblyProgress.setCableStyle(h.state.style);
        assemblyProgress.setMode('hand');
        const n = h.state.installed.length;
        notes.push(`Build by hand: ${n} piece${n === 1 ? '' : 's'} in and ${Object.keys(h.state.cables).length} cables connected, as shared.`);
      } else {
        notes.push(h.error);
        level = 'warn';
      }
    }
    if (kept) notes.push(`Your previous build is in Builds as “${kept.name}”.`);
    app.toast(notes.join(' '), level);
    return { play: false };
  }

  return { restore, currentLink, copyLink };
}
