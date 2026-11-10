#!/usr/bin/env node
// Runs auto-fill across budgets, uses and sizes and checks every result:
// zero compat errors, total within budget, every essential part present.
// Usage: node tools/test-autobuild.mjs [-v]   (-v prints parts and reasons)
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCatalog } from '../js/catalog.js';
import { CATEGORY_IDS } from '../js/categories.js';
import { autoBuild } from '../js/autobuild.js';
import { missingCategories } from '../js/compat.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('-v');
const catalog = createCatalog(Object.fromEntries(CATEGORY_IDS.map((c) => [c, JSON.parse(readFileSync(join(ROOT, 'data', 'parts', `${c}.json`), 'utf8')).parts])));

const BUDGETS = [20000, 30000, 45000, 60000, 80000, 100000, 150000];
const CASES = [
  ...BUDGETS.map((b) => ['gaming', 'full', b]),
  ...BUDGETS.map((b) => ['gaming', 'compact', b]),
  ...[20000, 45000, 100000, 150000].map((b) => ['creator', 'full', b]),
  ...[20000, 45000].map((b) => ['office', 'full', b]),
  ...[45000, 100000, 150000].map((b) => ['ai', 'full', b]),
  ['creator', 'compact', 60000],
  ['ai', 'compact', 80000],
  ['gaming', 'full', 12000], // too low: must fail cleanly, not return a broken build
];

const short = (p) => (p ? p.name.replace(/^(AMD|Intel|NVIDIA|ASUS|MSI|Gigabyte|Sapphire|PowerColor|XFX|ASRock|Zotac)\s+/i, '').replace(/\s+(Founders Edition|OC Edition|Edition)$/i, '') : 'iGPU');
const pad = (s, n) => String(s).slice(0, n).padEnd(n);
const num = (n) => n.toLocaleString('en-US');

let failed = 0;
const rows = [];
for (const [use, size, budget] of CASES) {
  const r = autoBuild(catalog, { budget, use, size });
  const problems = [];
  if (r.ok) {
    if (r.summary.error) problems.push(`${r.summary.error} compat errors`);
    if (r.total > budget) problems.push('over budget');
    const missing = missingCategories(r.build);
    if (missing.length) problems.push(`missing ${missing.join(', ')}`);
  } else if (budget >= 20000) problems.push(`no build: ${r.message}`);
  if (problems.length) failed++;
  rows.push({ use, size, budget, r, problems });
}

console.log('\nRigsmith auto-fill results (reference prices, not live; scores are estimates)');
console.log('─'.repeat(150));
console.log(`${pad('use', 8)}${pad('size', 8)}${pad('budget', 9)}${pad('total', 9)}${pad('score', 6)}${pad('CPU', 24)}${pad('GPU', 30)}${pad('board', 12)}${pad('RAM', 6)}${pad('case', 22)}${pad('PSU W', 6)}${pad('E/W/I', 8)}ms`);
for (const { use, size, budget, r, problems } of rows) {
  if (!r.ok) {
    console.log(`${pad(use, 8)}${pad(size, 8)}${pad(num(budget), 9)}${problems.length ? 'FAIL ' : ''}${r.message}`);
    continue;
  }
  const b = r.build;
  console.log(`${pad(use, 8)}${pad(size, 8)}${pad(num(budget), 9)}${pad(num(r.total), 9)}${pad(r.score, 6)}${pad(short(b.cpu), 24)}${pad(short(b.gpu), 30)}${pad(b.motherboard.chipset + ' ' + b.motherboard.formFactor, 12)}${pad(b.ram.reduce((n, k) => n + k.capacityGB, 0) + 'GB', 6)}${pad(short(b.case), 22)}${pad(b.psu.wattage, 6)}${pad(`${r.summary.error}/${r.summary.warn}/${r.summary.info}`, 8)}${r.ms}${problems.length ? `  FAIL: ${problems.join('; ')}` : ''}`);
  if (VERBOSE) {
    for (const [k, v] of Object.entries(r.reasons)) console.log(`      ${pad(k, 12)}${v}`);
    for (const i of r.issues.filter((x) => x.level !== 'info')) console.log(`      [${i.level}] ${i.message}`);
  }
}
console.log('─'.repeat(150));
console.log(`${rows.length - failed}/${rows.length} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
