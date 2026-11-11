// Three real builds shared by tools/test-assembly.mjs and tools/test-browser.mjs: an ATX
// tower, an mATX build with an AIO, and an ITX build. Parts are picked from data/parts by
// rule (first compatible match), so the builds follow the catalogue as it changes.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCatalog } from '../js/catalog.js';
import { CATEGORY_IDS } from '../js/categories.js';
import { isPartCompatible } from '../js/compat.js';
import { emptyBuild } from '../js/state.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const catalog = createCatalog(Object.fromEntries(CATEGORY_IDS.map((c) => [c, JSON.parse(readFileSync(join(ROOT, 'data', 'parts', `${c}.json`), 'utf8')).parts])));

// Fill a build with the first compatible part of each category from a rule or an id.
export function makeBuild(spec) {
  const b = emptyBuild();
  for (const [cat, pick] of spec) {
    const list = typeof pick === 'function' ? catalog.list(cat).filter(pick) : [catalog.get(pick)].filter(Boolean);
    const part = list.find((p) => isPartCompatible(p, b, { mode: 'add' }).ok);
    if (!part) throw new Error(`No compatible ${cat} for this build`);
    if (Array.isArray(b[cat])) b[cat].push(part); else b[cat] = part;
  }
  return b;
}

export const BUILDS = [
  {
    id: 'atx',
    name: 'ATX tower, air cooler, 2 NVMe + SATA, fan pack',
    build: makeBuild([
      ['case', 'corsair-4000d-airflow'],
      ['motherboard', (p) => p.formFactor === 'ATX' && p.socket === 'AM5' && p.memorySlots === 4 && p.m2Slots >= 3 && (p.pcieSlots?.length ?? 0) >= 3],
      ['cpu', (p) => p.socket === 'AM5'],
      ['ram', (p) => p.type === 'DDR5' && p.kit === '2x16'],
      ['gpu', (p) => p.lengthMM && p.lengthMM < 320],
      ['cooler', (p) => p.type === 'air' && p.heightMM >= 150],
      ['psu', (p) => p.formFactor === 'ATX' && p.wattage >= 850],
      ['storage', (p) => p.formFactor === 'M.2 2280'],
      ['storage', (p) => p.formFactor === 'M.2 2280'],
      ['storage', (p) => p.formFactor === '2.5in'],
      ['fans', (p) => p.packCount === 3 && p.sizeMM === 120],
    ]),
  },
  {
    id: 'matx',
    name: 'mATX, LGA1700, 240 mm AIO',
    build: makeBuild([
      ['case', (p) => p.caseType === 'matx' && p.radiatorSupport?.some((r) => r.maxMM >= 240)],
      ['motherboard', (p) => p.formFactor === 'mATX' && p.socket === 'LGA1700' && p.memorySlots === 4 && p.memoryType === 'DDR5'],
      ['cpu', (p) => p.socket === 'LGA1700'],
      ['ram', (p) => p.type === 'DDR5' && p.kit === '2x16'],
      ['gpu', (p) => p.lengthMM && p.lengthMM < 300],
      ['cooler', (p) => p.type === 'aio' && p.radiatorSizeMM === 240],
      ['psu', (p) => p.formFactor === 'ATX' && p.wattage >= 750],
      ['storage', (p) => p.formFactor === 'M.2 2280'],
      ['fans', (p) => p.packCount === 1 && p.sizeMM === 120],
    ]),
  },
  {
    id: 'itx',
    name: 'ITX, SFX PSU, low-profile cooler',
    build: makeBuild([
      ['case', 'cooler-master-masterbox-nr200p'],
      ['motherboard', (p) => p.formFactor === 'ITX' && p.socket === 'AM5'],
      ['cpu', (p) => p.socket === 'AM5'],
      ['ram', (p) => p.type === 'DDR5' && p.kit === '2x16'],
      ['gpu', (p) => p.lengthMM && p.lengthMM < 300],
      ['cooler', (p) => p.type === 'air' && p.heightMM < 75],
      ['psu', (p) => p.formFactor === 'SFX' && p.wattage >= 750],
      ['storage', (p) => p.formFactor === 'M.2 2280'],
    ]),
  },
];

/** A build as part ids per category (the shape BuildStore saves). */
export const idsOf = (build) => Object.fromEntries(Object.entries(build).map(([k, v]) => [k, Array.isArray(v) ? v.map((p) => p.id) : v?.id ?? null]));
