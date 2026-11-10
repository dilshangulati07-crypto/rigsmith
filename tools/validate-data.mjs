#!/usr/bin/env node
// Validates data/parts/*.json: required fields, types, enums, unique ids, sanity ranges
// and cross-file checks. Usage: node tools/validate-data.mjs [category ...]
// Exit code 1 if any error. Warnings never fail the run.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'data', 'parts');

// ---------------------------------------------------------------- enums
export const ENUMS = {
  tier: ['budget', 'mid', 'high', 'flagship'],
  socket: ['AM4', 'AM5', 'LGA1700', 'LGA1851'],
  memoryType: ['DDR4', 'DDR5'],
  formFactor: ['E-ATX', 'ATX', 'mATX', 'ITX'],
  wifi: ['none', 'wifi5', 'wifi6', 'wifi6e', 'wifi7'],
  storageType: ['nvme', 'sata', 'hdd'],
  coolerType: ['air', 'aio'],
  modular: ['full', 'semi', 'none'],
};

// Chipset -> socket, used to catch typos like an "X870" board on LGA1700.
const CHIPSET_SOCKET = {
  A520: 'AM4', B450: 'AM4', B550: 'AM4', X570: 'AM4',
  A620: 'AM5', B650: 'AM5', B650E: 'AM5', X670: 'AM5', X670E: 'AM5', B850: 'AM5', X870: 'AM5', X870E: 'AM5',
  H610: 'LGA1700', B660: 'LGA1700', H670: 'LGA1700', Z690: 'LGA1700', B760: 'LGA1700', H770: 'LGA1700', Z790: 'LGA1700',
  H810: 'LGA1851', B860: 'LGA1851', Z890: 'LGA1851',
};
// Memory generations each socket can run.
const SOCKET_MEMORY = { AM4: ['DDR4'], AM5: ['DDR5'], LGA1700: ['DDR4', 'DDR5'], LGA1851: ['DDR5'] };

// ---------------------------------------------------------------- schemas
// Spec syntax: 'string' | 'int' | 'number' | 'bool' | 'enum:<name>' | '<type>[]' | 'object[]' | 'url' | 'date' | 'id'
// '?' suffix = may be null (then specsVerified must be false). Common fields apply to every part.
const COMMON = {
  id: 'id', category: 'string', brand: 'string', name: 'string', tier: 'enum:tier',
  specsVerified: 'bool', refPriceTHB: 'int', priceUpdated: 'date', searchUrl: 'url',
};

const SCHEMAS = {
  cpu: {
    socket: 'enum:socket', tdp: 'int', cores: 'int', threads: 'int',
    baseClockGHz: 'number', boostClockGHz: 'number', memoryType: 'enum:memoryType[]', igpu: 'bool',
  },
  motherboard: {
    socket: 'enum:socket', chipset: 'string', formFactor: 'enum:formFactor', memoryType: 'enum:memoryType',
    memorySlots: 'int', maxMemoryGB: 'int', pcieSlots: 'object[]', m2Slots: 'int', sataPorts: 'int', wifi: 'enum:wifi',
  },
  ram: { type: 'enum:memoryType', capacityGB: 'int', kit: 'string', speedMTs: 'int', heightMM: 'number' },
  gpu: { lengthMM: 'int', slotWidth: 'number', tdp: 'int', recommendedPSU: 'int', powerConnectors: 'string[]', vramGB: 'int' },
  psu: { wattage: 'int', efficiency: 'string', modular: 'enum:modular', connectors: 'object' },
  case: {
    formFactorsSupported: 'enum:formFactor[]', maxGPULengthMM: 'int', maxCoolerHeightMM: 'int',
    radiatorSupport: 'object[]', fanMounts: 'object', drivebays: 'object', dimensionsMM: 'object',
  },
  cooler: { type: 'enum:coolerType', socketsSupported: 'enum:socket[]', heightMM: 'int', radiatorSizeMM: 'int', tdpRating: 'int' },
  storage: { type: 'enum:storageType', capacityGB: 'int', formFactor: 'string' },
  fans: {},
};

// Optional fields that are type-checked when present.
const OPTIONAL = {
  cpu: {
    maxPowerW: 'int', igpuName: 'string?', coolerIncluded: 'bool?', generation: 'string',
    architecture: 'string', launchYear: 'int',
  },
  ram: { modules: 'int', moduleGB: 'int', casLatency: 'int', rgb: 'bool' },
};

// Fields that may legitimately be null even when verified (e.g. "no integrated GPU").
const NULL_MEANS_NONE = { cpu: ['igpuName'], cooler: ['radiatorSizeMM'] };

// ---------------------------------------------------------------- helpers
const errors = [];
const warnings = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);

function checkType(spec, value) {
  if (spec.endsWith('[]')) {
    if (!Array.isArray(value)) return 'expected an array';
    if (value.length === 0) return 'array is empty';
    const inner = spec.slice(0, -2);
    for (const v of value) {
      const e = checkType(inner, v);
      if (e) return `item ${JSON.stringify(v)}: ${e}`;
    }
    return null;
  }
  if (spec.startsWith('enum:')) {
    const list = ENUMS[spec.slice(5)];
    return list.includes(value) ? null : `"${value}" not in [${list.join(', ')}]`;
  }
  switch (spec) {
    case 'string': return typeof value === 'string' && value.trim() ? null : 'expected non-empty string';
    case 'int': return Number.isInteger(value) ? null : 'expected integer';
    case 'number': return typeof value === 'number' && Number.isFinite(value) ? null : 'expected number';
    case 'bool': return typeof value === 'boolean' ? null : 'expected boolean';
    case 'object': return value && typeof value === 'object' && !Array.isArray(value) ? null : 'expected object';
    case 'id': return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value) ? null : 'id must be lowercase kebab-case';
    case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? null : 'expected YYYY-MM-DD';
    case 'url': try { return new URL(value).protocol === 'https:' ? null : 'expected https URL'; } catch { return 'invalid URL'; }
    default: return `unknown spec ${spec}`;
  }
}

function checkField(where, part, field, spec, required) {
  const nullable = spec.endsWith('?');
  const s = nullable ? spec.slice(0, -1) : spec;
  if (!(field in part)) {
    if (required) err(where, `missing required field "${field}"`);
    return;
  }
  const v = part[field];
  if (v === null) {
    const okNull = nullable || NULL_MEANS_NONE[part.category]?.includes(field);
    if (!okNull && part.specsVerified !== false) err(where, `"${field}" is null but specsVerified is not false`);
    return;
  }
  const e = checkType(s, v);
  if (e) err(where, `"${field}" ${e}`);
}

const range = (where, field, v, min, max) => {
  if (typeof v === 'number' && (v < min || v > max)) err(where, `"${field}" = ${v} outside ${min}..${max}`);
};

// ---------------------------------------------------------------- per-type sanity
const SANITY = {
  cpu(p, w) {
    range(w, 'cores', p.cores, 2, 64);
    range(w, 'tdp', p.tdp, 35, 400);
    range(w, 'baseClockGHz', p.baseClockGHz, 1, 6.5);
    range(w, 'boostClockGHz', p.boostClockGHz, 1, 6.5);
    if (p.threads < p.cores || p.threads > p.cores * 2) err(w, `threads ${p.threads} inconsistent with cores ${p.cores}`);
    if (p.boostClockGHz < p.baseClockGHz) err(w, 'boost clock below base clock');
    if (p.maxPowerW != null && p.maxPowerW < p.tdp) err(w, 'maxPowerW below tdp');
    if (p.igpu && !p.igpuName) warn(w, 'igpu is true but igpuName is empty');
    if (!p.igpu && p.igpuName) err(w, 'igpuName set but igpu is false');
    const allowed = SOCKET_MEMORY[p.socket] || [];
    for (const m of p.memoryType || []) if (!allowed.includes(m)) err(w, `${m} not possible on ${p.socket}`);
  },
  motherboard(p, w) {
    const expected = CHIPSET_SOCKET[p.chipset];
    if (!expected) warn(w, `unknown chipset "${p.chipset}"`);
    else if (expected !== p.socket) err(w, `chipset ${p.chipset} belongs to ${expected}, not ${p.socket}`);
    if (p.memoryType && !(SOCKET_MEMORY[p.socket] || []).includes(p.memoryType)) err(w, `${p.memoryType} not possible on ${p.socket}`);
    if (![2, 4, 8].includes(p.memorySlots)) err(w, `memorySlots ${p.memorySlots} unusual`);
    if (p.formFactor === 'ITX' && p.memorySlots > 2) err(w, 'ITX board with more than 2 memory slots');
    if (p.maxMemoryGB != null) range(w, 'maxMemoryGB', p.maxMemoryGB, 16, 512);
    range(w, 'm2Slots', p.m2Slots, 0, 8);
    range(w, 'sataPorts', p.sataPorts, 0, 10);
    if (Array.isArray(p.pcieSlots)) {
      p.pcieSlots.forEach((s, i) => {
        if (!/^x(1|4|8|16)$/.test(s.size)) err(w, `pcieSlots[${i}].size "${s.size}" invalid`);
        if (![1, 2, 4, 8, 16].includes(s.lanes)) err(w, `pcieSlots[${i}].lanes invalid`);
        if (![2, 3, 4, 5].includes(s.gen)) err(w, `pcieSlots[${i}].gen invalid`);
        if (s.lanes > Number(s.size.slice(1))) err(w, `pcieSlots[${i}] has more lanes than its physical size`);
      });
      if (!p.pcieSlots.some((s) => s.size === 'x16')) warn(w, 'no x16 slot listed');
    }
  },
  ram(p, w) {
    const m = /^(\d+)x(\d+)$/.exec(p.kit || '');
    if (!m) err(w, `kit "${p.kit}" must look like "2x16"`);
    else {
      if (+m[1] * +m[2] !== p.capacityGB) err(w, `kit ${p.kit} does not add up to ${p.capacityGB} GB`);
      if (p.modules != null && p.modules !== +m[1]) err(w, 'modules does not match kit');
      if (p.moduleGB != null && p.moduleGB !== +m[2]) err(w, 'moduleGB does not match kit');
    }
    if (p.type === 'DDR4') range(w, 'speedMTs', p.speedMTs, 2133, 5333);
    if (p.type === 'DDR5') range(w, 'speedMTs', p.speedMTs, 4000, 9000);
    if (p.heightMM != null) range(w, 'heightMM', p.heightMM, 28, 70);
    if (p.name && p.type && !p.name.includes(p.type)) warn(w, `name does not mention ${p.type}`);
  },
};

// ---------------------------------------------------------------- run
const requested = process.argv.slice(2);
const categories = requested.length ? requested : Object.keys(SCHEMAS);
const data = {};
const ids = new Map();

for (const cat of categories) {
  if (!SCHEMAS[cat]) { err(cat, 'unknown category'); continue; }
  const file = join(DIR, `${cat}.json`);
  if (!existsSync(file)) { if (requested.length) err(cat, 'file not found'); continue; }
  let json;
  try { json = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { err(`${cat}.json`, `invalid JSON: ${e.message}`); continue; }
  if (json.category !== cat) err(`${cat}.json`, `top-level category is "${json.category}"`);
  if (!Array.isArray(json.parts)) { err(`${cat}.json`, 'missing "parts" array'); continue; }
  data[cat] = json.parts;

  const names = new Set();
  json.parts.forEach((p, i) => {
    const w = `${cat}[${i}] ${p.id ?? '(no id)'}`;
    for (const [f, s] of Object.entries(COMMON)) checkField(w, p, f, s, true);
    for (const [f, s] of Object.entries(SCHEMAS[cat])) checkField(w, p, f, s, true);
    for (const [f, s] of Object.entries(OPTIONAL[cat] || {})) checkField(w, p, f, s, false);
    if (p.category !== cat) err(w, `category "${p.category}" should be "${cat}"`);
    if (p.refPriceTHB != null && (p.refPriceTHB < 100 || p.refPriceTHB > 300000)) err(w, `refPriceTHB ${p.refPriceTHB} looks wrong`);
    if (p.brand && p.name && !p.name.toLowerCase().startsWith(p.brand.toLowerCase())) warn(w, 'name does not start with brand');
    if (ids.has(p.id)) err(w, `duplicate id (also in ${ids.get(p.id)})`);
    ids.set(p.id, cat);
    if (names.has(p.name)) err(w, `duplicate name "${p.name}"`);
    names.add(p.name);
    if (p.specsVerified === false && !Object.values(p).includes(null)) warn(w, 'specsVerified is false but no field is null');
    SANITY[cat]?.(p, w);
  });
}

// ---------------------------------------------------------------- cross-file checks
const { cpu, motherboard, ram } = data;
if (cpu && motherboard) {
  for (const socket of new Set(cpu.map((c) => c.socket))) {
    const n = motherboard.filter((b) => b.socket === socket).length;
    if (n < 3) err('cross', `socket ${socket} has ${n} motherboards (need at least 3)`);
  }
  for (const socket of new Set(motherboard.map((b) => b.socket))) {
    if (!cpu.some((c) => c.socket === socket)) err('cross', `motherboards for ${socket} but no CPU`);
  }
  for (const b of motherboard) {
    if (!cpu.some((c) => c.socket === b.socket && c.memoryType.includes(b.memoryType))) {
      err('cross', `${b.id}: no CPU can run its ${b.memoryType}`);
    }
  }
}
if (motherboard && ram) {
  for (const b of motherboard) {
    const fits = ram.filter((r) => r.type === b.memoryType && r.modules <= b.memorySlots && (b.maxMemoryGB == null || r.capacityGB <= b.maxMemoryGB));
    if (!fits.length) err('cross', `${b.id}: no RAM kit fits (${b.memoryType}, ${b.memorySlots} slots)`);
  }
  for (const t of ENUMS.memoryType) {
    if (motherboard.some((b) => b.memoryType === t) && ram.filter((r) => r.type === t).length < 3) {
      err('cross', `fewer than 3 ${t} kits for ${t} boards`);
    }
  }
}
if (cpu) {
  for (const t of ENUMS.tier) if (!cpu.some((c) => c.tier === t)) warn('cross', `no CPU in tier ${t}`);
}

// ---------------------------------------------------------------- report
const pad = (s, n) => String(s).padEnd(n);
console.log('\nRigsmith data report');
console.log('─'.repeat(64));
console.log(`${pad('category', 13)}${pad('parts', 7)}${pad('unverified', 12)}tiers (budget/mid/high/flagship)`);
for (const [cat, parts] of Object.entries(data)) {
  const tiers = ENUMS.tier.map((t) => parts.filter((p) => p.tier === t).length).join('/');
  const unv = parts.filter((p) => p.specsVerified === false).length;
  console.log(`${pad(cat, 13)}${pad(parts.length, 7)}${pad(unv, 12)}${tiers}`);
}
if (data.cpu) {
  const bySocket = (arr) => Object.entries(arr.reduce((a, p) => ((a[p.socket] = (a[p.socket] || 0) + 1), a), {})).map(([k, v]) => `${k} ${v}`).join(', ');
  console.log(`\nCPUs by socket:   ${bySocket(data.cpu)}`);
  if (data.motherboard) console.log(`Boards by socket: ${bySocket(data.motherboard)}`);
}
if (data.motherboard) {
  const ff = ENUMS.formFactor.map((f) => `${f} ${data.motherboard.filter((b) => b.formFactor === f).length}`).join(', ');
  console.log(`Boards by size:   ${ff}`);
}
if (data.ram) {
  console.log(`RAM by type:      ${ENUMS.memoryType.map((t) => `${t} ${data.ram.filter((r) => r.type === t).length}`).join(', ')}`);
}

const unverified = Object.values(data).flat().filter((p) => p.specsVerified === false);
if (unverified.length) {
  console.log(`\nspecsVerified:false (${unverified.length})`);
  for (const p of unverified) {
    const nulls = Object.entries(p)
      .filter(([k, v]) => v === null && !NULL_MEANS_NONE[p.category]?.includes(k))
      .map(([k]) => k).join(', ');
    console.log(`  ${pad(p.category, 12)} ${pad(p.id, 52)} null: ${nulls || '-'}`);
  }
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
