// Preset cards for the landing page and the builder's Presets dialog: a cached 3D thumbnail,
// who the build is for, reference total, estimated draw and the preset's three focus
// workloads as bars. Buttons come from the caller (links on the landing page, buttons in
// the builder).
import { presetBuild } from '../presets.js';
import { buildReport } from '../build-report.js';
import { WORKLOADS, PERF_LABEL } from '../perf.js';
import { formatTHB, PRICE_NOTE } from '../pricing.js';
import { encodeBuild, compareUrl } from '../share.js';
import { html, render, num } from './dom.js';
import { fillThumb, thumbAlt } from './build-thumb.js';

const LABEL = Object.fromEntries(WORKLOADS.map((w) => [w.id, w.label]));

/** Everything a card shows, from the shared engines. */
export function presetSummary(preset, catalog) {
  const build = presetBuild(preset, catalog);
  const r = buildReport(build);
  return { preset, build, report: r, code: encodeBuild(build, catalog) };
}

/**
 * @param {HTMLElement} el container (gets a <ul class="presets">)
 * @param {{presets: object[], catalog: object, actions: (s) => any, heading?: 'h2'|'h3'}} opts
 *   actions(summary) returns the card's button markup (html``).
 */
export function renderPresetCards(el, { presets, catalog, actions, heading = 'h3' }) {
  const items = presets.map((p) => presetSummary(p, catalog));
  const H = heading === 'h2' ? (s) => html`<h2 class="preset__name">${s}</h2>` : (s) => html`<h3 class="preset__name">${s}</h3>`;
  render(el, html`
    <ul class="presets" role="list">${items.map(({ preset, report: r, code }, i) => html`
      <li class="preset" data-preset-id="${preset.id}">
        <div class="thumb brackets" data-thumb-code="${code}"><p class="thumb__msg mono">3D preview</p></div>
        <div class="preset__body">
          <p class="preset__idx mono muted">${String(i + 1).padStart(2, '0')}</p>
          ${H(preset.name)}
          <p class="preset__for">${preset.for}</p>
          <ul class="bars preset__bars" aria-label="${PERF_LABEL}: ${preset.focus.map((w) => `${LABEL[w]} ${r.perf.scores[w]}`).join(', ')}">${preset.focus.map((w) => html`
            <li class="gauge gauge--accent" style="--value: ${r.perf.scores[w] ?? 0}">
              <div class="gauge__head"><span>${LABEL[w]}</span><span class="gauge__value">${r.perf.scores[w] ?? '—'}</span></div>
              <div class="gauge__track" aria-hidden="true"><div class="gauge__fill"></div></div>
            </li>`)}</ul>
          <dl class="preset__facts">
            <div><dt class="label">Total</dt><dd class="mono">${formatTHB(r.price.total)}</dd></div>
            <div><dt class="label">Est. peak</dt><dd class="mono">${num(r.draw.watts)} W</dd></div>
            <div><dt class="label">Case</dt><dd class="mono">${r.size ? `${r.size.litres} L` : '—'}</dd></div>
          </dl>
          <p class="preset__note">${PRICE_NOTE} · performance is an ${PERF_LABEL.toLowerCase()}, 100 = strongest in the catalogue</p>
          <div class="preset__actions">${actions({ preset, report: r, code })}</div>
        </div>
      </li>`)}
    </ul>`);

  // Render thumbnails only once a card is near the screen.
  const byCode = new Map(items.map((s) => [s.code, s]));
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const s = byCode.get(e.target.dataset.thumbCode);
      if (s) fillThumb(e.target, s.build, s.code, thumbAlt(s.build, s.preset.name));
    }
  }, { rootMargin: '200px' });
  for (const t of el.querySelectorAll('.thumb')) io.observe(t);
  return { items, disconnect: () => io.disconnect() };
}

/** Compare link for one preset (opens compare.html with it as the first column). */
export const presetCompareUrl = (s) => compareUrl(location.href, [{ code: s.code, name: s.preset.name }]);
