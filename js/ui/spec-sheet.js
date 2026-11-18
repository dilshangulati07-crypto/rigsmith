// Printable one-page spec sheet for a build (shown only by css/print.css): parts with key
// specs and reference prices, estimates, power, size, compatibility and verification, and
// a QR code of the share link (drawn by js/qr.js; left out if it can't be drawn).
import { CONFIG } from '../config.js?v=00a22f4faf';
import { buildReport, partRows, WORKLOADS } from '../build-report.js?v=00a22f4faf';
import { formatTHB, PRICE_NOTE } from '../pricing.js?v=00a22f4faf';
import { PERF_LABEL } from '../perf.js?v=00a22f4faf';
import { partType } from './part-types/index.js?v=00a22f4faf';
import { qrSvg } from '../qr.js?v=00a22f4faf';
import { html, raw, num } from './dom.js?v=00a22f4faf';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Markup for one sheet. `link` = share link (optional), `date` = YYYY-MM-DD. */
export function specSheet(build, { name = 'Untitled build', link = '', date = new Date().toISOString().slice(0, 10) } = {}) {
  const r = buildReport(build);
  const rows = partRows(build);
  let qr = '';
  if (link) {
    try { qr = raw(qrSvg(link, { label: 'QR code of the share link' })); } catch { qr = ''; }
  }
  const status = r.counts.error ? 'error' : r.counts.warn ? 'warn' : 'ok';
  return html`
    <article class="sheet">
      <header class="sheet__head">
        <div class="sheet__title">
          <p class="sheet__brand">${CONFIG.appName} · build spec sheet</p>
          <h1>${name}</h1>
          <p class="sheet__meta">${date} · ${plural(rows.reduce((n, x) => n + x.qty, 0), 'part')} · ${formatTHB(r.price.total)} (${PRICE_NOTE.toLowerCase()})</p>
        </div>
        ${link ? html`<div class="sheet__link">
          ${qr ? html`<div class="sheet__qr">${qr}</div>` : ''}
          <p class="sheet__url">${link}</p>
        </div>` : ''}
      </header>

      <table class="sheet__parts">
        <thead><tr><th scope="col">Part</th><th scope="col">Model</th><th scope="col">Key specs</th><th scope="col" class="num">Qty</th><th scope="col" class="num">Reference price</th></tr></thead>
        <tbody>${rows.map(({ category, part, qty }) => html`
          <tr>
            <th scope="row">${category.label}</th>
            <td>${part.name}${part.specsVerified ? '' : html` <span class="sheet__unv">specs not fully verified</span>`}</td>
            <td class="sheet__specs">${partType(part.category).keySpecs(part).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${k} ${v}`).join(' · ')}</td>
            <td class="num">${qty}</td>
            <td class="num">${formatTHB((part.refPriceTHB ?? 0) * qty)}</td>
          </tr>`)}</tbody>
        <tfoot><tr><th scope="row" colspan="4">Total · ${PRICE_NOTE.toLowerCase()}${r.price.priceUpdated ? `, prices from ${r.price.priceUpdated}` : ''}</th><td class="num">${formatTHB(r.price.total)}</td></tr></tfoot>
      </table>

      <div class="sheet__grid">
        <section>
          <h2>Performance <span>${PERF_LABEL.toLowerCase()}</span></h2>
          ${r.perf.missing.includes('CPU') ? html`<p>Needs a CPU for estimates.</p>` : html`
          <ul class="sheet__bars">${WORKLOADS.map((w) => {
            const s = r.perf.scores[w.id];
            const per = r.ppp.workloads[w.id].thbPerPoint;
            return html`<li><span>${w.label}</span><span class="sheet__bar"><span style="width:${s ?? 0}%"></span></span><span class="num">${s ?? '—'}</span><span class="num sheet__ppp">${per ? `${formatTHB(per)}/pt` : ''}</span></li>`;
          })}</ul>
          ${r.perf.bottleneck.primary ? html`<p class="sheet__note">${r.perf.bottleneck.primary}</p>` : ''}`}
        </section>
        <section>
          <h2>Build facts</h2>
          <table class="sheet__facts"><tbody>
            <tr><th scope="row">Est. peak power</th><td>${r.draw.watts ? `${num(r.draw.watts)} W` : '—'}</td></tr>
            <tr><th scope="row">PSU</th><td>${r.psu.wattage ? `${num(r.psu.wattage)} W · ${r.psu.pct === null ? '—' : r.psu.pct >= 0 ? `${r.psu.pct}% headroom` : 'over capacity'}` : 'none chosen'}</td></tr>
            <tr><th scope="row">Case size</th><td>${r.size ? `${r.size.depth} × ${r.size.width} × ${r.size.height} mm · ${r.size.litres} L` : '—'}</td></tr>
            <tr><th scope="row">Compatibility</th><td class="sheet__status sheet__status--${status}">${plural(r.counts.error, 'error')} · ${plural(r.counts.warn, 'warning')} · ${plural(r.counts.info, 'note')}</td></tr>
            <tr><th scope="row">Verified specs</th><td>${r.verification.verified} of ${r.verification.total} parts</td></tr>
          </tbody></table>
          ${r.issues.filter((i) => i.level !== 'info').slice(0, 3).map((i) => html`<p class="sheet__issue sheet__issue--${i.level}">${i.message}</p>`)}
        </section>
      </div>

      <footer class="sheet__foot">
        Prices are ${PRICE_NOTE.toLowerCase()}: hand-entered THB figures, so search each part for today's price. Performance figures are a heuristic ${PERF_LABEL.toLowerCase()} from specs (100 = the strongest parts in the catalogue), not benchmarks. Power is an estimated peak; the PSU target is peak + 30%.
      </footer>
    </article>`;
}

/** Put sheets in the page's .print-sheet holder (created on first use). */
export function setPrintSheets(sheets) {
  let holder = document.getElementById('print-sheet');
  if (!holder) {
    holder = document.createElement('section');
    holder.id = 'print-sheet';
    holder.className = 'print-sheet';
    holder.setAttribute('aria-hidden', 'true');
    document.body.append(holder);
  }
  holder.innerHTML = sheets.map(String).join('');
  return holder;
}

/** Fill the sheets and open the browser's print dialog. */
export function printSheets(sheets) {
  setPrintSheets(sheets);
  window.print();
}
