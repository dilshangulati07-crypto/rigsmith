// Renders the shared top bar and footer from CONFIG so every page stays in sync.
// Usage: <header id="site-header" data-page="builder"></header> ... <footer id="site-footer"></footer>
import { CONFIG } from '../config.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function wordmark() {
  return `<a class="wordmark" href="index.html" aria-label="${esc(CONFIG.appName)} home">
    <span class="wordmark__mark" aria-hidden="true"></span>${esc(CONFIG.appName)}</a>`;
}

function navItem(item, page) {
  if (item.soon || !item.href) {
    return `<li><a class="nav__link" aria-disabled="true" role="link" tabindex="0"
      data-tooltip="Not available yet">${esc(item.label)}<span class="tag nav__soon">Soon</span></a></li>`;
  }
  const current = item.id === page ? ' aria-current="page"' : '';
  return `<li><a class="nav__link" href="${esc(item.href)}"${current}>${esc(item.label)}</a></li>`;
}

function renderHeader(el) {
  const page = el.dataset.page || '';
  el.className = 'topbar';
  el.innerHTML = `
    <div class="container topbar__inner">
      ${wordmark()}
      <button class="btn btn--ghost btn--sm nav-toggle" type="button"
        aria-expanded="false" aria-controls="site-nav">Menu</button>
      <nav class="nav" id="site-nav" aria-label="Main">
        <ul class="nav__list">${CONFIG.nav.map((i) => navItem(i, page)).join('')}</ul>
        <div class="nav__end">
          <button class="btn btn--sm" type="button" aria-disabled="true"
            data-tooltip="Accounts are not available yet" data-tooltip-pos="left">Sign in</button>
        </div>
      </nav>
    </div>`;

  const toggle = el.querySelector('.nav-toggle');
  const nav = el.querySelector('.nav');
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    nav.dataset.open = String(open);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.dataset.open === 'true') {
      toggle.setAttribute('aria-expanded', 'false');
      nav.dataset.open = 'false';
      toggle.focus();
    }
  });
}

function renderFooter(el) {
  const year = new Date().getFullYear();
  el.className = 'footer';
  el.innerHTML = `
    <div class="container">
      <div class="footer__grid">
        <div>
          ${wordmark()}
          <p style="margin-top:12px;max-width:42ch">A 3D PC builder with live compatibility checks.
          Prices are reference prices, not live. Performance figures are estimates.</p>
        </div>
        <div>
          <p class="label">Build</p>
          <ul class="footer__list">
            <li><a href="builder.html">Builder</a></li>
            <li><a href="builder.html?mode=auto">Auto-build</a></li>
            <li><a href="compare.html">Compare</a></li>
          </ul>
        </div>
        <div>
          <p class="label">Data</p>
          <ul class="footer__list">
            <li>Real products only</li>
            <li>Unverified specs are marked</li>
            <li>Prices in ${esc(CONFIG.currency)}, not live</li>
          </ul>
        </div>
      </div>
      <div class="footer__base">
        <span>${esc(CONFIG.appName)} v${esc(CONFIG.version)} · three.js r${esc(CONFIG.threeRevision)}</span>
        <span>© ${year} ${esc(CONFIG.author)}</span>
      </div>
    </div>`;
}

export function mountShell() {
  const header = document.getElementById('site-header');
  const footer = document.getElementById('site-footer');
  if (header) renderHeader(header);
  if (footer) renderFooter(footer);
  // Page titles in HTML use the working name; swap in the configured one.
  document.title = document.title.replace(/Rigsmith/g, CONFIG.appName);
  document.querySelectorAll('[data-app-name]').forEach((n) => { n.textContent = CONFIG.appName; });
}

mountShell();
