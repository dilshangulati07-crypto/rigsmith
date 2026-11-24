#!/usr/bin/env node
// Validates data/parts/*.json: required fields, types, enums, unique ids, sanity ranges
// and cross-file checks. Usage: node tools/validate-data.mjs [category ...]
// Exit code 1 if any error. Warnings never fail the run.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENUMS, SCHEMAS, unknownFields, validateParts } from './parts-rules.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'data', 'parts');

// The rules themselves live in tools/parts-rules.mjs.
export { ENUMS };

// ---------------------------------------------------------------- load
const requested = process.argv.slice(2);
const files = {};
for (const cat of requested.length ? requested : Object.keys(SCHEMAS)) {
  const file = join(DIR, `${cat}.json`);
  if (!SCHEMAS[cat] || !existsSync(file)) continue;
  try { files[cat] = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { files[cat] = e; }
}
const { errors, warnings, data } = validateParts(files, { categories: requested });
const { cpu, motherboard, ram, gpu, psu, storage, cooler } = data;
const pcCase = data.case;

// ---------------------------------------------------------------- report
const pad = (s, n) => String(s).padEnd(n);
const countBy = (arr, key, values) => values.map((v) => `${v} ${arr.filter((p) => p[key] === v).length}`).join(', ');

console.log('\nRigsmith data report');
console.log('─'.repeat(64));
console.log(`${pad('category', 13)}${pad('parts', 7)}${pad('unverified', 12)}tiers (budget/mid/high/flagship)`);
for (const [cat, parts] of Object.entries(data)) {
  const tiers = ENUMS.tier.map((t) => parts.filter((p) => p.tier === t).length).join('/');
  console.log(`${pad(cat, 13)}${pad(parts.length, 7)}${pad(parts.filter((p) => p.specsVerified === false).length, 12)}${tiers}`);
}
console.log('');
if (cpu) console.log(`CPUs by socket:   ${countBy(cpu, 'socket', ENUMS.socket)}`);
if (motherboard) {
  console.log(`Boards by socket: ${countBy(motherboard, 'socket', ENUMS.socket)}`);
  console.log(`Boards by size:   ${countBy(motherboard, 'formFactor', ENUMS.formFactor)}`);
}
if (ram) console.log(`RAM by type:      ${countBy(ram, 'type', ENUMS.memoryType)}`);
if (gpu) console.log(`GPU by maker:     ${countBy(gpu, 'chipMaker', ENUMS.chipMaker)}`);
if (storage) console.log(`Storage by type:  ${countBy(storage, 'type', ENUMS.storageType)}`);
if (psu) console.log(`PSU:              ${Math.min(...psu.map((p) => p.wattage))}-${Math.max(...psu.map((p) => p.wattage))} W; modular ${countBy(psu, 'modular', ENUMS.modular)}`);
if (pcCase) console.log(`Case by type:     ${countBy(pcCase, 'caseType', ENUMS.caseType)}`);
if (cooler) console.log(`Cooler:           air ${cooler.filter((c) => c.type === 'air').length}; AIO ${[120, 240, 280, 360].map((s) => `${s}mm ${cooler.filter((c) => c.radiatorSizeMM === s).length}`).join(', ')}`);

const unverified = Object.values(data).flat().filter((p) => p.specsVerified === false);
if (unverified.length) {
  console.log(`\nspecsVerified:false (${unverified.length})`);
  for (const p of unverified) console.log(`  ${pad(p.category, 12)} ${pad(p.id, 52)} null: ${unknownFields(p).join(', ') || '-'}`);
}
if (warnings.length) {
  console.log(`\nWarnings (${warnings.length})`);
  warnings.forEach((w) => console.log(`  ! ${w}`));
}
if (errors.length) {
  console.log(`\nErrors (${errors.length})`);
  errors.forEach((e) => console.log(`  x ${e}`));
  console.log('\nFAILED');
  process.exit(1);
}
console.log('\nOK: no errors');
