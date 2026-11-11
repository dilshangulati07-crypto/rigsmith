// Exports: CSV parts list (pure, testable in Node) and the browser download helper.
import { CONFIG } from './config.js';
import { partRows } from './build-report.js';
import { priceBuild, PRICE_NOTE } from './pricing.js';
import { partType } from './ui/part-types/index.js';

// RFC 4180 quoting; a leading = + - @ gets a ' so spreadsheets don't run it as a formula.
const cell = (v) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const line = (cells) => cells.map(cell).join(',');

const keySpecText = (p) => partType(p.category).keySpecs(p).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${k}: ${v}`).join('; ');

/**
 * CSV of a build's parts with "search this part" links. Returns the text (CRLF, no BOM).
 * @param {object} build parts per category
 * @param {{name?: string, link?: string, date?: string}} meta
 */
export function buildCSV(build, { name = 'Build', link = '', date = new Date().toISOString().slice(0, 10) } = {}) {
  const price = priceBuild(build);
  const rows = partRows(build);
  const out = [
    line(['Category', 'Part', 'Brand', 'Qty', `Reference price each (${CONFIG.currency})`, `Reference price total (${CONFIG.currency})`, 'Price updated', 'Key specs', 'Specs verified', 'Search this part']),
    ...rows.map(({ category, part, qty }) => line([
      category.label, part.name, part.brand, qty, part.refPriceTHB ?? '', (part.refPriceTHB ?? 0) * qty, part.priceUpdated ?? '',
      keySpecText(part), part.specsVerified ? 'yes' : 'no', part.searchUrl ?? '',
    ])),
    line(['Total', '', '', rows.reduce((n, r) => n + r.qty, 0), '', price.total, price.priceUpdated ?? '', '', '', '']),
    '',
    line([`${name} · exported ${date} from ${CONFIG.appName}`]),
    line([`Prices: ${PRICE_NOTE.toLowerCase()}. Check the "Search this part" link for today's price.`]),
  ];
  if (link) out.push(line([`Share link: ${link}`]));
  return `${out.join('\r\n')}\r\n`;
}

export const fileSlug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'build';

/** Browser: save text as a file. */
export function downloadText(text, filename, type = 'text/csv;charset=utf-8') {
  // A BOM so Excel reads the UTF-8 (Thai baht sign, brand names) correctly.
  const blob = new Blob([type.startsWith('text/csv') ? '﻿' : '', text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
