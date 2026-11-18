// Renders the shared top bar and footer from CONFIG so every page stays in sync.
// Usage: <header id="site-header" data-page="builder"></header> ... <footer id="site-footer"></footer>
import { CONFIG } from '../config.js?v=00a22f4faf';

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
        ${page === 'builder' ? '' : `<div class="nav__end">
          <a class="btn btn--sm btn--primary" href="builder.html">Start building</a>
        </div>`}
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
          <p style="margin-top:14px;max-width:38ch">Pick real parts, check that they fit, and see the finished PC in 3D.
          Prices are reference prices, not live. Performance figures are estimates.</p>
        </div>
        <div>
          <p class="label">Build</p>
          <ul class="footer__list">
            <li><a href="builder.html">Builder</a></li>
            <li><a href="builder.html?mode=auto">Watch it build</a></li>
            <li><a href="compare.html">Compare</a></li>
            <li><a href="index.html#presets">Presets</a></li>
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
        <div class="footer__credits">
          <p class="label">Credits</p>
          <p style="margin:0 0 6px">3D parts are modelled in code from each product's real dimensions.</p>
          <p style="margin:0 0 6px">Studio lighting: <a href="https://polyhaven.com/a/studio_small_08" rel="noopener">Studio Small 08</a> by Sergej Majboroda, Poly Haven, CC0.</p>
          <p style="margin:0">Rendering: <a href="https://threejs.org" rel="noopener">three.js</a> r${esc(CONFIG.threeRevision)}, MIT. <a href="models/CREDITS.md">All credits</a></p>
        </div>
      </div>
      <div class="footer__base">
        <span>${esc(CONFIG.appName)} v${esc(CONFIG.version)}</span>
        <span>© ${year} ${esc(CONFIG.author)}</span>
      </div>
    </div>`;
}

const ICONS = {
  home: '<path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>',
  builder: '<rect x="6" y="3" width="12" height="18" rx="2"/><circle cx="12" cy="9" r="2.5"/><path d="M9 15.5h6M9 18h6"/>',
  auto: '<circle cx="12" cy="12" r="9"/><path d="m10 8.5 5.5 3.5-5.5 3.5z"/>',
  compare: '<rect x="3" y="5" width="7.5" height="14" rx="1.5"/><rect x="13.5" y="5" width="7.5" height="14" rx="1.5"/>',
};

// Phones: a bottom bar with the main destinations (the top bar's menu is hidden there).
function renderBottomNav(page) {
  const params = new URLSearchParams(location.search);
  const items = [
    { id: 'home', label: 'Home', href: 'index.html' },
    { id: 'builder', label: 'Build', href: 'builder.html' },
    { id: 'auto', label: 'Auto-build', href: 'builder.html?mode=auto' },
    { id: 'compare', label: 'Compare', href: 'compare.html' },
  ];
  const current = page === 'builder' && params.get('mode') === 'auto' ? 'auto' : page;
  const nav = document.createElement('nav');
  nav.className = 'bottom-nav';
  nav.setAttribute('aria-label', 'Main (mobile)');
  nav.innerHTML = items.map((i) => `<a class="bottom-nav__link" href="${i.href}"${i.id === current ? ' aria-current="page"' : ''}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[i.id]}</svg>${esc(i.label)}</a>`).join('');
  document.body.append(nav);
  document.body.classList.add('has-bottom-nav');
}

export function mountShell() {
  const header = document.getElementById('site-header');
  const footer = document.getElementById('site-footer');
  if (header) renderHeader(header);
  if (header) renderBottomNav(header.dataset.page || '');
  if (footer) renderFooter(footer);
  // Page titles in HTML use the working name; swap in the configured one.
  document.title = document.title.replace(/Rigsmith/g, CONFIG.appName);
  document.querySelectorAll('[data-app-name]').forEach((n) => { n.textContent = CONFIG.appName; });
}

mountShell();
