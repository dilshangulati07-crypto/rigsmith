// Right column: total price, power estimate, performance estimate, issues, verification.
import { CATEGORIES, getCategory } from '../categories.js?v=733eefba1e';
import { estimateDraw, getVerification, summarize, PSU_HEADROOM } from '../compat.js?v=733eefba1e';
import { priceBuild, pricePerPerformance, formatTHB, PRICE_NOTE } from '../pricing.js?v=733eefba1e';
import { estimatePerformance, WORKLOADS, PERF_LABEL } from '../perf.js?v=733eefba1e';
import { html, render, num } from './dom.js?v=733eefba1e';

const GROUPS = [
  { level: 'error', title: 'Errors', note: 'These parts will not work together.' },
  { level: 'warn', title: 'Warnings', note: 'Works, with a catch.' },
  { level: 'info', title: 'Notes', note: 'Good to know, including specs we cannot confirm.' },
];

export function mountSummary(el, app) {
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action="goto"]');
    if (b) app.setCategory(b.dataset.cat, { focusBrowser: true });
  });

  return {
    render(build, issues) {
      const price = priceBuild(build);
      const perf = estimatePerformance(build);
      const ppp = pricePerPerformance(build, perf);
      const draw = estimateDraw(build);
      const ver = getVerification(build);
      const counts = summarize(issues);
      const owner = (id) => app.catalog.get(id)?.category;

      render(el, html`
        <section class="sum" aria-labelledby="sum-total-h">
          <h2 class="label" id="sum-total-h">Total</h2>
          <p class="sum__total mono">${formatTHB(price.total)}</p>
          <p class="sum__note">${PRICE_NOTE}${price.priceUpdated ? ` · prices from ${price.priceUpdated}` : ''}</p>
          ${price.total ? html`
            <details class="sum__details" data-key="by-category">
              <summary>By category</summary>
              <table class="spec-table">
                <tbody>${CATEGORIES.filter((c) => price.byCategory[c.id].count).map((c) => html`
                  <tr><th scope="row">${c.label}${price.byCategory[c.id].count > 1 ? ` ×${price.byCategory[c.id].count}` : ''}</th><td>${formatTHB(price.byCategory[c.id].subtotal)}</td></tr>`)}</tbody>
              </table>
            </details>` : ''}
        </section>

        <section class="sum" aria-labelledby="sum-power-h">
          <h2 class="label" id="sum-power-h">Power <span class="tag">Estimate</span></h2>
          ${power(build, draw)}
        </section>

        <section class="sum" aria-labelledby="sum-perf-h">
          <h2 class="label" id="sum-perf-h">Performance <span class="tag">${PERF_LABEL}</span></h2>
          ${perfBars(perf, ppp)}
        </section>

        <section class="sum" aria-labelledby="sum-issues-h">
          <h2 class="label" id="sum-issues-h">Compatibility</h2>
          <p class="sum__counts">
            <span class="tag ${counts.error ? 'tag--error' : 'tag--ok'} tag--dot">${counts.error} error${counts.error === 1 ? '' : 's'}</span>
            <span class="tag ${counts.warn ? 'tag--warn' : ''} tag--dot">${counts.warn} warning${counts.warn === 1 ? '' : 's'}</span>
            <span class="tag tag--dot">${counts.info} note${counts.info === 1 ? '' : 's'}</span>
          </p>
          ${GROUPS.map((g) => group(g, issues.filter((i) => i.level === g.level), owner, counts))}
        </section>

        <section class="sum" aria-labelledby="sum-ver-h">
          <h2 class="label" id="sum-ver-h">Spec verification</h2>
          ${ver.total
            ? html`<p class="sum__ver"><span class="mono">${ver.verified} of ${ver.total}</span> parts fully verified against the maker's page.</p>
              ${ver.unverified.length ? html`<ul class="sum__list">${ver.unverified.map((p) => html`<li><span>${p.name}</span> <span class="muted mono">not confirmed: ${p.unknownFields.join(', ') || '—'}</span></li>`)}</ul>` : ''}`
            : html`<p class="muted">No parts chosen yet.</p>`}
        </section>`);
    },
  };
}

function power(build, draw) {
  if (!draw.watts) return html`<p class="muted">Add parts to estimate power draw.</p>`;
  const psu = build.psu;
  const target = Math.round(draw.watts * PSU_HEADROOM);
  if (!psu) {
    return html`
      <div class="gauge gauge--accent" style="--value: ${Math.min(100, (draw.watts / draw.recommendedW) * 100)}">
        <div class="gauge__head"><span>Est. peak ${num(draw.watts)} W</span><span class="gauge__value">PSU: ${num(draw.recommendedW)} W or more</span></div>
        <div class="gauge__track"><div class="gauge__fill"></div></div>
      </div>
      ${draw.unknown.length ? html`<p class="sum__small">Leaves out ${draw.unknown.join(', ')} (power not confirmed).</p>` : ''}`;
  }
  const load = draw.watts / psu.wattage;
  const level = draw.watts > psu.wattage ? 'error' : target > psu.wattage ? 'warn' : 'ok';
  const headroom = Math.round(((psu.wattage - draw.watts) / draw.watts) * 100);
  return html`
    <div class="gauge gauge--${level} gauge--marked" style="--value: ${Math.min(100, load * 100)}; --mark: ${(100 / PSU_HEADROOM).toFixed(1)}">
      <div class="gauge__head"><span>Est. peak ${num(draw.watts)} W of ${num(psu.wattage)} W</span><span class="gauge__value">${headroom >= 0 ? `${headroom}% headroom` : 'over capacity'}</span></div>
      <div class="gauge__track" role="img" aria-label="Estimated peak draw ${draw.watts} watts on a ${psu.wattage} watt power supply"><div class="gauge__fill"></div></div>
    </div>
    <p class="sum__small">Target: ${num(target)} W (peak + 30%). The tick on the bar marks it.${draw.unknown.length ? ` Leaves out ${draw.unknown.join(', ')} (power not confirmed).` : ''}</p>
    <details class="sum__details" data-key="power-lines">
      <summary>How this is estimated</summary>
      <table class="spec-table"><tbody>${draw.lines.map((l) => html`<tr><th scope="row">${l.label}</th><td>${l.watts} W</td></tr>`)}</tbody></table>
    </details>`;
}

function perfBars(perf, ppp) {
  if (perf.missing.includes('CPU')) return html`<p class="muted">Choose a CPU to see estimates.</p>`;
  return html`
    <ul class="bars">${WORKLOADS.map((w) => {
      const s = perf.scores[w.id];
      const per = ppp.workloads[w.id].thbPerPoint;
      return html`
        <li class="gauge ${s === null ? '' : 'gauge--accent'}" style="--value: ${s ?? 0}">
          <div class="gauge__head"><span>${w.label}</span><span class="gauge__value">${s ?? '—'}${per ? html` <span class="muted">· ${formatTHB(per)}/pt</span>` : ''}</span></div>
          <div class="gauge__track" role="img" aria-label="${w.label}: ${s === null ? 'not available' : `${s} out of 100`}"><div class="gauge__fill"></div></div>
        </li>`;
    })}</ul>
    ${perf.bottleneck.hints.length ? html`<ul class="sum__hints">${perf.bottleneck.hints.map((h) => html`<li>${h}</li>`)}</ul>` : ''}
    ${perf.missing.length ? html`<p class="sum__small">Missing: ${perf.missing.join(', ')}.</p>` : ''}
    ${perf.assumptions.length ? html`<p class="sum__small">${perf.assumptions.join(' ')}</p>` : ''}
    <p class="sum__small">Heuristic from specs, 100 = strongest parts in the catalogue. ฿/pt = reference total per point.</p>`;
}

function group(g, list, owner, counts) {
  if (!list.length) return '';
  const items = html`<ul class="issues">${list.map((i) => {
    const cat = i.category ?? owner(i.parts[0]);
    return html`<li class="issue issue--${i.level}">
      <p class="issue__msg">${i.message}</p>
      ${i.fix ? html`<p class="issue__fix">${i.fix}</p>` : ''}
      ${cat ? html`<button class="linkbtn" type="button" data-action="goto" data-cat="${cat}">Go to ${getCategory(cat).label.toLowerCase()}</button>` : ''}
    </li>`;
  })}</ul>`;
  // Notes start folded once there is something more urgent to read.
  if (g.level === 'info') {
    return html`<details class="issues-group" data-key="notes" ${counts.error + counts.warn ? '' : 'open'}><summary>${g.title} (${list.length})</summary>${items}</details>`;
  }
  return html`<div class="issues-group"><h3 class="issues-group__h issues-group__h--${g.level}">${g.title} (${list.length})</h3>${items}</div>`;
}
