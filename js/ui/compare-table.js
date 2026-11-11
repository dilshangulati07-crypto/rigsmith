// compare.html table: a sticky header (3D thumbnail, name, total) over sections of rows,
// one column per build. Differences between columns are marked: parts and specs that
// differ, the best value per metric, and the change against the first column.
// Head and body scroll sideways together on narrow screens; the row labels stay put.
import { CATEGORIES } from '../categories.js';
import { buildReport } from '../build-report.js';
import { WORKLOADS, PERF_LABEL } from '../perf.js';
import { formatTHB, PRICE_NOTE } from '../pricing.js';
import { encodeBuild } from '../share.js';
import { partType } from './part-types/index.js';
import { html, render, num } from './dom.js';
import { fillThumb, thumbAlt } from './build-thumb.js';

export const MAX_COLUMNS = 3;

const sign = (n, fmt = String) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '±0');
const ids = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((p) => p.id);
const LEVEL_TEXT = { ok: 'ok', warn: 'tight', error: 'over' };

/** Parts swapped, added or removed since `original` (per category, as multisets). */
export function changedParts(original, build) {
  let n = 0;
  for (const c of CATEGORIES) {
    const left = ids(original[c.id]);
    let added = 0;
    for (const id of ids(build[c.id])) {
      const i = left.indexOf(id);
      if (i >= 0) left.splice(i, 1); else added++;
    }
    n += Math.max(added, left.length); // a swap is one added + one left over
  }
  return n;
}

/**
 * @param {HTMLElement} root  the .cmp element (role=table) with .cmp__head and .cmp__body children
 * @param {object[]} cols     [{ uid, name, build, original }]
 * @param {{catalog: object, sources: any}} ctx  sources = markup of the "add a build" picker (or null)
 */
export function renderCompare(root, cols, { catalog, addSlot }) {
  const reports = cols.map((c) => buildReport(c.build));
  const codes = cols.map((c) => encodeBuild(c.build, catalog));
  const n = cols.length;
  const extra = n < MAX_COLUMNS ? 1 : 0;
  root.style.setProperty('--cols', String(n + extra));
  const empty = extra ? html`<div class="cmp__cell cmp__cell--pad" role="cell"></div>` : '';

  // ---- metric rows: best cell marked, change against column 1
  function metric(label, values, { fmt, better = null, delta = null, note = null, cell = null }) {
    const known = values.filter((v) => v !== null && v !== undefined);
    const best = better && n > 1 && known.length > 1 && new Set(known).size > 1
      ? (better === 'low' ? Math.min(...known) : Math.max(...known)) : null;
    return html`
      <div class="cmp__row" role="row">
        <div class="cmp__label" role="rowheader">${label}${note ? html`<span class="cmp__note">${note}</span>` : ''}</div>
        ${values.map((v, i) => html`
          <div class="cmp__cell ${v !== null && v === best ? 'is-best' : ''}" role="cell">
            ${cell ? cell(v, i) : html`<span class="cmp__value mono">${v === null || v === undefined ? '—' : fmt(v)}</span>`}
            ${v !== null && v === best ? html`<span class="cmp__best">Best</span>` : ''}
            ${delta && i > 0 && v !== null && values[0] !== null && values[0] !== undefined ? html`<span class="cmp__delta mono">${sign(v - values[0], delta)} vs A</span>` : ''}
          </div>`)}
        ${empty}
      </div>`;
  }
  const section = (title, sub) => html`<div class="cmp__row cmp__row--section" role="row"><h2 class="cmp__section" role="rowheader">${title}${sub ? html` <span class="cmp__sub">${sub}</span>` : ''}</h2></div>`;

  // ---- parts rows: a cell per column, marked where columns differ
  function partsRow(c) {
    const lists = cols.map((col) => {
      const v = col.build[c.id];
      return Array.isArray(v) ? v : v ? [v] : [];
    });
    const sigs = lists.map((l) => l.map((p) => p.id).sort().join('|'));
    const same = n > 1 && sigs.every((s) => s === sigs[0]);
    // Single-part slots: mark the key specs whose value differs between columns.
    const specs = lists.map((l) => (l.length === 1 && !c.multiple ? partType(c.id).keySpecs(l[0]) : null));
    const specDiff = (k, v) => n > 1 && specs.some((s) => s && s.find(([kk]) => kk === k)?.[1] !== v);
    return html`
      <div class="cmp__row cmp__row--part" role="row" ${same ? html`data-same="true"` : ''}>
        <div class="cmp__label" role="rowheader">${c.label}${same ? html`<span class="cmp__note">Same in all</span>` : ''}</div>
        ${lists.map((list, i) => html`
          <div class="cmp__cell" role="cell" ${!same && n > 1 ? html`data-diff="true"` : ''}>
            ${list.length ? html`<ul class="cmp__parts">${list.map((p, k) => html`
              <li class="cmp__part">
                <p class="cmp__part-name">${p.name}${p.specsVerified ? '' : html` <span class="tag" title="Some specs are not confirmed">Unverified</span>`}</p>
                <p class="cmp__part-specs mono">${partType(c.id).keySpecs(p).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v], j) => html`${j ? ' · ' : ''}<span ${specs[i] && specDiff(k, v) ? html`class="is-diff"` : ''}>${k} ${v}</span>`)}</p>
                <p class="cmp__part-foot"><span class="mono">${formatTHB(p.refPriceTHB ?? 0)}</span>
                  <button class="linkbtn" type="button" data-act="swap" data-col="${i}" data-cat="${c.id}" data-index="${k}" aria-label="Swap ${p.name} in ${cols[i].name}">Swap this part</button></p>
              </li>`)}</ul>`
              : html`<p class="cmp__none muted">None</p>`}
            ${!list.length || (c.multiple && c.pickMode === 'add') ? html`<button class="linkbtn" type="button" data-act="swap" data-col="${i}" data-cat="${c.id}" data-index="${list.length}">${list.length ? 'Add another' : 'Add one'}</button>` : ''}
          </div>`)}
        ${empty}
      </div>`;
  }

  // ---- head
  const head = html`
    <div class="cmp__track" role="row">
      <div class="cmp__corner" role="columnheader"><span class="label">${n} build${n === 1 ? '' : 's'}</span></div>
      ${cols.map((col, i) => {
        const changed = changedParts(col.original, col.build);
        const d = reports[i].price.total - buildReport(col.original).price.total;
        return html`
          <div class="cmp__colhead" role="columnheader" data-col="${i}">
            <div class="thumb brackets cmp__thumb" data-thumb-col="${i}"></div>
            <div class="cmp__colmeta">
              <p class="cmp__letter mono">${'ABC'[i]}</p>
              <p class="cmp__name">${col.name}</p>
              <p class="cmp__total mono">${formatTHB(reports[i].price.total)}</p>
              ${changed ? html`<p class="cmp__changed">${changed} part${changed === 1 ? '' : 's'} swapped · <span class="mono">${sign(d, formatTHB)}</span> <button class="linkbtn" type="button" data-act="undo" data-col="${i}">Undo</button></p>` : ''}
            </div>
          </div>`;
      })}
      ${extra ? html`<div class="cmp__colhead cmp__colhead--add" role="columnheader">${addSlot}</div>` : ''}
    </div>`;

  // ---- body
  const actions = html`
    <div class="cmp__row cmp__row--actions" role="row">
      <div class="cmp__label" role="rowheader">Build</div>
      ${cols.map((col, i) => html`
        <div class="cmp__cell" role="cell">
          <div class="cmp__actions">
            <a class="btn btn--sm" href="${col.link}">Open in builder</a>
            <details class="menu">
              <summary class="btn btn--sm btn--ghost" aria-label="More for ${col.name}">More</summary>
              <div class="menu__list">
                <button type="button" data-act="copy" data-col="${i}">Copy link to this build</button>
                <button type="button" data-act="csv" data-col="${i}">Parts list (CSV)</button>
                <button type="button" data-act="print" data-col="${i}">Print spec sheet</button>
                <button type="button" data-act="remove" data-col="${i}">Remove from comparison</button>
              </div>
            </details>
          </div>
        </div>`)}
      ${empty}
    </div>`;

  const r = reports;
  const body = html`
    <div class="cmp__track">
      ${actions}
      ${section('Overview', `prices: ${PRICE_NOTE.toLowerCase()}`)}
      ${metric('Total price', r.map((x) => x.price.total), { fmt: formatTHB, better: 'low', delta: formatTHB })}
      ${metric('Est. peak power', r.map((x) => x.draw.watts || null), { fmt: (v) => `${num(v)} W`, delta: (v) => `${num(v)} W`, note: 'Estimate' })}
      ${metric('PSU headroom', r.map((x) => x.psu.pct), {
        better: 'high',
        note: 'Target: peak + 30%',
        cell: (v, i) => (r[i].psu.wattage
          ? html`<span class="cmp__value mono"><span class="dot dot--${r[i].psu.level ?? 'none'}" aria-hidden="true"></span>${num(r[i].psu.wattage)} W · ${v === null ? '—' : v >= 0 ? `${v}%` : 'over capacity'}</span><span class="visually-hidden"> (${LEVEL_TEXT[r[i].psu.level] ?? 'unknown'})</span>`
          : html`<span class="cmp__value muted">No PSU</span>`),
      })}
      ${metric('Size (case)', r.map((x) => x.size?.litres ?? null), {
        note: 'D × W × H',
        cell: (v, i) => (r[i].size ? html`<span class="cmp__value mono">${r[i].size.depth} × ${r[i].size.width} × ${r[i].size.height} mm</span><span class="cmp__sub mono">${r[i].size.litres} L</span>` : html`<span class="cmp__value muted">—</span>`),
      })}
      ${metric('Compatibility', r.map((x) => x.counts.error * 100 + x.counts.warn), {
        cell: (v, i) => {
          const c = r[i].counts;
          const level = c.error ? 'error' : c.warn ? 'warn' : 'ok';
          return html`<span class="tag tag--${level} tag--dot">${c.error} error${c.error === 1 ? '' : 's'}</span> <span class="cmp__sub mono">${c.warn} warning${c.warn === 1 ? '' : 's'} · ${c.info} note${c.info === 1 ? '' : 's'}</span>
            ${r[i].issues.filter((x) => x.level === 'error').slice(0, 2).map((x) => html`<span class="cmp__issue">${x.message}</span>`)}`;
        },
      })}
      ${metric('Verified parts', r.map((x) => (x.verification.total ? x.verification.verified / x.verification.total : null)), {
        better: 'high',
        note: "Specs checked on the maker's page",
        cell: (v, i) => html`<span class="cmp__value mono">${r[i].verification.verified} of ${r[i].verification.total}</span>`,
      })}

      ${section('Performance', `${PERF_LABEL.toLowerCase()} · 100 = strongest parts in the catalogue`)}
      ${WORKLOADS.map((w) => metric(w.label, r.map((x) => x.perf.scores[w.id]), {
        better: 'high',
        delta: String,
        cell: (v) => html`<span class="gauge gauge--accent cmp__gauge" style="--value: ${v ?? 0}"><span class="gauge__head"><span class="gauge__value">${v ?? '—'}</span></span><span class="gauge__track" aria-hidden="true"><span class="gauge__fill"></span></span></span>`,
      }))}

      ${section('Price per performance', 'reference price per estimated point · lower is better')}
      ${WORKLOADS.map((w) => metric(w.label, r.map((x) => x.ppp.workloads[w.id].thbPerPoint), { fmt: (v) => `${formatTHB(v)}/pt`, better: 'low' }))}

      ${section('Parts', 'differences highlighted · swap one to see what changes')}
      ${CATEGORIES.map(partsRow)}
    </div>`;

  const headEl = root.querySelector('.cmp__head');
  const bodyEl = root.querySelector('.cmp__body');
  const x = bodyEl.scrollLeft;
  render(headEl, head);
  render(bodyEl, body);
  bodyEl.scrollLeft = x;
  headEl.scrollLeft = x;

  // Thumbnails: rendered once per build code, cached.
  cols.forEach((col, i) => {
    const el = headEl.querySelector(`[data-thumb-col="${i}"]`);
    if (el) fillThumb(el, col.build, codes[i], thumbAlt(col.build, col.name));
  });
  return { reports, codes };
}

/** Keep the sticky head and the body scrolled sideways together. Call once. */
export function linkScroll(root) {
  const headEl = root.querySelector('.cmp__head');
  const bodyEl = root.querySelector('.cmp__body');
  let lock = false;
  const follow = (from, to) => () => {
    if (lock) return;
    lock = true;
    to.scrollLeft = from.scrollLeft;
    requestAnimationFrame(() => { lock = false; });
  };
  bodyEl.addEventListener('scroll', follow(bodyEl, headEl), { passive: true });
  headEl.addEventListener('scroll', follow(headEl, bodyEl), { passive: true });
}
