#!/usr/bin/env node
// Checks data/presets.json against the catalogue and the compatibility engine: the eight
// required builds are there, every id exists in the right category, every preset has zero
// compatibility errors (and no warnings), a plain "who it is for" line, valid focus
// workloads, and the presets are distinct and ordered sensibly by price and performance.
// Usage: node tools/test-presets.mjs [-v]
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalog } from './test-builds.mjs';
import { presetBuild } from '../js/presets.js';
import { buildReport } from '../js/build-report.js';
import { CATEGORIES } from '../js/categories.js';
import { WORKLOADS } from '../js/perf.js';
import { encodeBuild } from '../js/share.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('-v');
let failures = 0;
let checks = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) { failures++; console.log(`  FAIL ${msg}`); } else if (VERBOSE) console.log(`  ok   ${msg}`);
  return cond;
}

const { presets } = JSON.parse(readFileSync(join(ROOT, 'data', 'presets.json'), 'utf8'));
const REQUIRED = ['Budget 1080p', 'Mid gaming 1440p', 'High-end 1440p', '4K flagship', 'Compact ITX', 'Creator workstation', 'AI / compute box', 'Silent office'];
const WORKLOAD_IDS = new Set(WORKLOADS.map((w) => w.id));
// Words that read as marketing rather than a plain description.
const HYPE = /\b(ultimate|insane|beast|monster|blazing|unleash|epic|next-level|dominate|crush)\b/i;

ok(presets.length >= 8, `at least 8 presets (${presets.length})`);
for (const name of REQUIRED) ok(presets.some((p) => p.name === name), `preset "${name}" exists`);
ok(new Set(presets.map((p) => p.id)).size === presets.length, 'preset ids are unique');

const reports = new Map();
for (const p of presets) {
  const where = `${p.id}:`;
  ok(/^[a-z0-9-]+$/.test(p.id), `${where} id is a URL-safe slug`);
  ok(typeof p.for === 'string' && p.for.length >= 60 && p.for.length <= 260, `${where} "for" line is a sentence or two (${p.for?.length} chars)`);
  ok(!HYPE.test(p.for), `${where} description is plain (no hype words)`);
  ok(Array.isArray(p.focus) && p.focus.length === 3 && p.focus.every((w) => WORKLOAD_IDS.has(w)), `${where} three valid focus workloads`);

  // Every id exists, in the category it is listed under.
  for (const c of CATEGORIES) {
    const v = p.parts[c.id];
    const ids = Array.isArray(v) ? v : v ? [v] : [];
    if (c.multiple) ok(Array.isArray(v), `${where} ${c.id} is a list`);
    for (const id of ids) ok(catalog.get(id)?.category === c.id, `${where} ${c.id} "${id}" is in the catalogue`);
  }
  ok(Object.keys(p.parts).every((k) => CATEGORIES.some((c) => c.id === k)), `${where} only known categories`);

  const build = presetBuild(p, catalog);
  const r = buildReport(build);
  reports.set(p.id, r);
  for (const c of CATEGORIES.filter((x) => x.essential)) ok(Array.isArray(build[c.id]) ? build[c.id].length > 0 : !!build[c.id], `${where} has a ${c.label.toLowerCase()}`);
  ok(r.counts.error === 0, `${where} zero compatibility errors${r.counts.error ? `: ${r.issues.filter((i) => i.level === 'error').map((i) => i.message).join(' | ')}` : ''}`);
  ok(r.counts.warn === 0, `${where} zero warnings${r.counts.warn ? `: ${r.issues.filter((i) => i.level === 'warn').map((i) => i.message).join(' | ')}` : ''}`);
  ok(r.psu.level === 'ok', `${where} PSU covers peak draw + 30% (${r.draw.watts} W on ${r.psu.wattage} W, ${r.psu.pct}% headroom)`);
  ok(r.size !== null, `${where} case size known (${r.size?.litres} L)`);
  ok(p.focus.every((w) => r.perf.scores[w] !== null), `${where} focus workloads have scores`);
  ok(encodeBuild(build, catalog).length < 80, `${where} share code is short (${encodeBuild(build, catalog)})`);
  console.log(`  ${p.name.padEnd(20)} ${String(r.price.total).padStart(7)} THB  ${String(r.draw.watts).padStart(4)} W  verified ${r.verification.verified}/${r.verification.total}  ${p.focus.map((w) => `${w} ${r.perf.scores[w]}`).join(', ')}`);
}

// Distinct builds, and the tiers make sense relative to each other.
const codes = presets.map((p) => encodeBuild(presetBuild(p, catalog), catalog));
ok(new Set(codes).size === codes.length, 'every preset is a different build');
const R = (id) => reports.get(id);
if (R('budget-1080p') && R('mid-1440p') && R('high-1440p') && R('4k-flagship')) {
  ok(R('budget-1080p').price.total < R('mid-1440p').price.total && R('mid-1440p').price.total < R('high-1440p').price.total && R('high-1440p').price.total < R('4k-flagship').price.total, 'gaming presets rise in price: budget < mid < high-end < flagship');
  ok(R('budget-1080p').perf.scores.gaming1440 < R('mid-1440p').perf.scores.gaming1440 && R('mid-1440p').perf.scores.gaming1440 < R('high-1440p').perf.scores.gaming1440 && R('high-1440p').perf.scores.gaming4k < R('4k-flagship').perf.scores.gaming4k, '... and in gaming performance');
}
if (R('compact-itx')) ok(R('compact-itx').size.litres < 25 && presetBuild(presets.find((p) => p.id === 'compact-itx'), catalog).motherboard.formFactor === 'ITX', `Compact ITX is small (${R('compact-itx').size.litres} L, ITX board)`);
if (R('creator')) ok(R('creator').perf.scores.video === Math.max(...presets.filter((p) => p.id !== '4k-flagship').map((p) => R(p.id).perf.scores.video)), 'Creator workstation has the best video score short of the flagship');
if (R('ai-compute')) ok((presetBuild(presets.find((p) => p.id === 'ai-compute'), catalog).gpu?.vramGB ?? 0) >= 24, 'AI box has 24 GB+ of VRAM');
if (R('silent-office')) {
  const b = presetBuild(presets.find((p) => p.id === 'silent-office'), catalog);
  ok(!b.gpu && b.cpu.igpu && R('silent-office').draw.watts < 250, `Silent office: no graphics card, integrated graphics, low draw (${R('silent-office').draw.watts} W)`);
}

console.log(failures ? `FAILED: ${failures} of ${checks} checks` : `OK: ${checks} checks`);
process.exit(failures ? 1 : 0);
