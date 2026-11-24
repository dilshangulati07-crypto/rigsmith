// gallery.html: builds visitors posted from the builder (Export → Post to the gallery) and
// you approved in the admin dashboard. Each card is decoded from its share code against the
// live catalogue, so prices, power and performance are always today's.
import { loadCatalog } from './catalog.js?v=4fbe99bdc0';
import { decodeBuild, buildFromIds, shareUrl, compareUrl } from './share.js?v=4fbe99bdc0';
import { buildReport } from './build-report.js?v=4fbe99bdc0';
import { WORKLOADS } from './perf.js?v=4fbe99bdc0';
import { formatTHB, PRICE_NOTE } from './pricing.js?v=4fbe99bdc0';
import { listPosts, likePost, hasLiked } from './gallery-api.js?v=4fbe99bdc0';
import { html, render, num } from './ui/dom.js?v=4fbe99bdc0';
import { fillThumb, thumbAlt } from './ui/build-thumb.js?v=4fbe99bdc0';
import { track } from './track.js?v=4fbe99bdc0';

const $ = (s) => document.querySelector(s);
const SHOWN = ['gaming1440', 'gaming4k', 'video'];
const LABEL = Object.fromEntries(WORKLOADS.map((w) => [w.id, w.label]));
let catalog = null;
let sort = 'top';
let io = null;

let toastTimer;
function toast(msg, level = 'ok') {
  const t = $('#toast');
  t.textContent = msg;
  t.dataset.level = level;
  t.dataset.show = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.dataset.show = 'false'; }, 3600);
}

const ago = (sqlTime) => {
  const t = Date.parse(`${String(sqlTime).replace(' ', 'T')}Z`);
  const days = Math.floor((Date.now() - t) / 86400000);
  if (!Number.isFinite(days)) return '';
  if (days < 1) return 'today';
  if (days < 2) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** A post plus everything its card shows; null when the build no longer decodes cleanly. */
function summarise(post) {
  const d = decodeBuild(post.code, catalog);
  if (!d.ok) return null;
  const build = buildFromIds(d.ids, catalog);
  return { post, build, report: buildReport(build), missing: d.missing.length };
}

function card({ post, build, report: r, missing }) {
  const liked = hasLiked(post.id);
  const link = shareUrl(location.href, { code: post.code, name: post.name });
  return html`
    <li class="preset gpost" data-id="${post.id}">
      <div class="thumb" data-thumb-code="${post.code}"><p class="thumb__msg">3D preview</p></div>
      <div class="preset__body">
        <div class="gpost__top">
          <h2 class="preset__name">${post.name}</h2>
          ${post.featured ? html`<span class="tag tag--accent">Pinned</span>` : ''}
        </div>
        <p class="gpost__by">${post.author ? html`by <b>${post.author}</b> · ` : ''}${ago(post.created_at)}</p>
        ${post.note ? html`<p class="preset__for">${post.note}</p>` : ''}
        <ul class="gpost__parts">
          ${build.cpu ? html`<li><span class="label">CPU</span>${build.cpu.name}</li>` : ''}
          ${build.gpu ? html`<li><span class="label">GPU</span>${build.gpu.name}</li>` : html`<li><span class="label">GPU</span>Integrated graphics</li>`}
          ${build.case ? html`<li><span class="label">Case</span>${build.case.name}</li>` : ''}
        </ul>
        <ul class="bars preset__bars" aria-label="Estimated performance">${SHOWN.map((w) => html`
          <li class="gauge gauge--accent" style="--value: ${r.perf.scores[w] ?? 0}">
            <div class="gauge__head"><span>${LABEL[w]}</span><span class="gauge__value">${r.perf.scores[w] ?? '—'}</span></div>
            <div class="gauge__track" aria-hidden="true"><div class="gauge__fill"></div></div>
          </li>`)}</ul>
        <dl class="preset__facts">
          <div><dt class="label">Total</dt><dd class="mono">${formatTHB(r.price.total)}</dd></div>
          <div><dt class="label">Est. peak</dt><dd class="mono">${num(r.draw.watts)} W</dd></div>
          <div><dt class="label">Fit</dt><dd class="mono">${r.counts.error ? `${r.counts.error} issue${r.counts.error === 1 ? '' : 's'}` : 'All fits'}</dd></div>
        </dl>
        <p class="preset__note">${PRICE_NOTE}, at today's prices${missing ? ` · ${missing} part${missing === 1 ? ' is' : 's are'} no longer sold here` : ''}</p>
        <div class="preset__actions">
          <a class="btn btn--primary btn--sm" href="${link}" data-open="${post.id}">Open in builder</a>
          <button class="btn btn--sm gpost__like" type="button" data-like="${post.id}" aria-pressed="${liked}" ${liked ? 'disabled' : ''}>
            <span aria-hidden="true">${liked ? '♥' : '♡'}</span> <span data-count>${num(post.likes)}</span><span class="visually-hidden"> likes${liked ? ', you liked this' : ''}</span>
          </button>
          <a class="preset__compare" href="${compareUrl(location.href, [{ code: post.code, name: post.name }])}">Compare</a>
        </div>
      </div>
    </li>`;
}

async function show() {
  const list = $('#gallery-list');
  $('#gallery-loading').hidden = false;
  let posts;
  try {
    posts = await listPosts(sort);
  } catch (err) {
    $('#gallery-loading').hidden = true;
    render($('#gallery-msg'), html`<div class="callout callout--warn"><p class="label">The gallery didn't load</p><p>${err.message}</p></div>`);
    return;
  }
  render($('#gallery-msg'), '');
  $('#gallery-loading').hidden = true;
  const items = posts.map(summarise).filter(Boolean);
  if (!items.length) {
    render(list, html`<div class="gallery__empty"><p class="label">No builds yet</p><p>Be the first: make a build in the <a href="builder.html">builder</a>, then choose <b>Export → Post to the gallery</b>.</p></div>`);
    return;
  }
  render(list, html`<ul class="presets gallery__grid" role="list">${items.map(card)}</ul>`);

  io?.disconnect();
  const byCode = new Map(items.map((s) => [s.post.code, s]));
  io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const s = byCode.get(e.target.dataset.thumbCode);
      if (s) fillThumb(e.target, s.build, s.post.code, thumbAlt(s.build, s.post.name));
    }
  }, { rootMargin: '200px' });
  for (const t of list.querySelectorAll('.thumb')) io.observe(t);
}

document.addEventListener('click', async (e) => {
  const sortBtn = e.target.closest('[data-sort]');
  if (sortBtn && sortBtn.dataset.sort !== sort) {
    sort = sortBtn.dataset.sort;
    for (const b of document.querySelectorAll('[data-sort]')) b.setAttribute('aria-pressed', String(b === sortBtn));
    show();
    return;
  }
  const open = e.target.closest('[data-open]');
  if (open) track('gallery_open', open.dataset.open);
  const like = e.target.closest('[data-like]');
  if (like && !like.disabled) {
    like.disabled = true;
    try {
      const n = await likePost(like.dataset.like);
      like.querySelector('[aria-hidden]').textContent = '♥';
      like.querySelector('[data-count]').textContent = num(n);
      like.setAttribute('aria-pressed', 'true');
      track('gallery_like', like.dataset.like);
    } catch (err) {
      like.disabled = false;
      toast(err.message, 'warn');
    }
  }
});

try {
  catalog = await loadCatalog();
  track('gallery_view', '', { oncePerPage: true });
  await show();
} catch (err) {
  $('#gallery-loading').hidden = true;
  render($('#gallery-msg'), html`<div class="callout callout--warn"><p class="label">The parts catalogue didn't load</p><p>${err.message}</p></div>`);
}
