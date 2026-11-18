// Share and export helpers shared by builder.html and compare.html: copy a link with a
// "Copied" confirmation, CSV download, printing spec sheets, and a small disclosure menu.
import { buildCSV, downloadText, fileSlug } from '../export.js?v=733eefba1e';
import { specSheet, printSheets } from './spec-sheet.js?v=733eefba1e';
import { CONFIG } from '../config.js?v=733eefba1e';

/** Copy text to the clipboard. Resolves true on success. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers or no permission: the hidden-textarea fallback.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

/**
 * Copy `text` and confirm on the button itself ("Copied" for 2 s) and in a polite status
 * region. On failure the caller gets false and can show the link another way.
 */
export async function copyWithFeedback(button, text, status) {
  const ok = await copyText(text);
  const label = button.querySelector('[data-copy-label]') ?? button;
  button.dataset.copied = ok ? 'true' : 'false';
  label.textContent = ok ? 'Copied' : 'Copy failed';
  if (status) status.textContent = ok ? 'Link copied to the clipboard.' : 'The link could not be copied automatically.';
  clearTimeout(button.copyTimer);
  button.copyTimer = setTimeout(() => {
    label.textContent = button.dataset.copyText || 'Copy link';
    delete button.dataset.copied;
  }, 2000);
  return ok;
}

export function downloadCSV(build, { name, link }) {
  const date = new Date().toISOString().slice(0, 10);
  downloadText(buildCSV(build, { name, link, date }), `${fileSlug(CONFIG.appName)}-${fileSlug(name)}-${date}.csv`);
}

/** Print one or more builds as spec sheets: [{ build, name, link }]. */
export function printBuilds(list) {
  printSheets(list.map(({ build, name, link }) => specSheet(build, { name, link })));
}

/** <details class="menu"> behaviour: closes on outside click, Escape and after choosing. */
export function wireMenus(root = document) {
  const menus = () => root.querySelectorAll('details.menu[open]');
  document.addEventListener('click', (e) => {
    for (const m of menus()) {
      if (!m.contains(e.target) || e.target.closest('.menu__list button, .menu__list a')) m.open = false;
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    for (const m of menus()) {
      m.open = false;
      m.querySelector('summary')?.focus();
    }
  });
}
