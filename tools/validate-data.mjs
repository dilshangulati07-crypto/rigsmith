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
  storageFormFactor: ['M.2 2280', '2.5in', '3.5in'],
  coolerType: ['air', 'aio'],
  modular: ['full', 'semi', 'none'],
  // Cybenetics values are used only when the maker lists no 80 PLUS rating.
  efficiency: ['80 PLUS Standard', '80 PLUS White', '80 PLUS Bronze', '80 PLUS Gold', '80 PLUS Platinum', '80 PLUS Titanium',
    'Cybenetics Bronze', 'Cybenetics Silver', 'Cybenetics Gold', 'Cybenetics Platinum', 'Cybenetics Titanium'],
  psuFormFactor: ['ATX', 'SFX', 'SFX-L'],
  gpuPower: ['6-pin', '8-pin', '16-pin'],
  cpuPower: ['8-pin', '4-pin'],
  chipMaker: ['NVIDIA', 'AMD', 'Intel'],
  caseType: ['full-tower', 'mid-tower', 'matx', 'itx'],
  sidePanel: ['glass', 'mesh', 'solid', 'acrylic'],
  frontPanel: ['mesh', 'glass', 'solid'],
  boardMount: ['io-down'],
  radiatorPosition: ['front', 'top', 'side', 'bottom', 'rear'],
  specSourceType: ['official', 'retailer', 'review'],
};

const PSU_CONNECTORS = ['atx24', 'eps8', 'pcie8', 'pcie16', 'sata', 'molex'];
const RADIATOR_SIZES = [92, 120, 140, 240, 280, 360, 420, 480];
const FAN_SIZES = ['80', '92', '120', '140', '160', '200'];
// Fan mounts also exist on top of the PSU shroud, where no radiator fits.
const FAN_POSITIONS = [...['front', 'top', 'side', 'bottom', 'rear'], 'shroud'];

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
// Spec syntax: 'string' | 'int' | 'number' | 'bool' | 'object' | 'enum:<name>' | 'url' | 'date' | 'id'
// '<spec>[]' = non-empty array, '<spec>[]*' = array that may be empty, '?' suffix = null allowed
// without affecting specsVerified. Any other null requires specsVerified:false.
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
  gpu: { lengthMM: 'int', slotWidth: 'number', tdp: 'int', recommendedPSU: 'int', powerConnectors: 'enum:gpuPower[]*', vramGB: 'int' },
  psu: { wattage: 'int', efficiency: 'enum:efficiency', modular: 'enum:modular', connectors: 'object' },
  case: {
    formFactorsSupported: 'enum:formFactor[]', maxGPULengthMM: 'int', maxCoolerHeightMM: 'int',
    radiatorSupport: 'object[]', fanMounts: 'object', drivebays: 'object', dimensionsMM: 'object',
  },
  cooler: { type: 'enum:coolerType', socketsSupported: 'enum:socket[]', heightMM: 'int', radiatorSizeMM: 'int', tdpRating: 'int' },
  storage: { type: 'enum:storageType', capacityGB: 'int', formFactor: 'enum:storageFormFactor' },
  fans: { sizeMM: 'int', thicknessMM: 'int', packCount: 'int', rgb: 'bool', rpmMax: 'int' },
};

// Optional on every part: where the specs were checked.
const COMMON_OPTIONAL = { specSource: 'url', specSourceType: 'enum:specSourceType', sku: 'string' };
// Categories that went through the source-checked pass: a verified part must cite its source.
const NEEDS_SOURCE = ['psu', 'case'];

// Optional fields that are type-checked when present.
const OPTIONAL = {
  cpu: {
    maxPowerW: 'int', igpuName: 'string?', coolerIncluded: 'bool?', generation: 'string',
    architecture: 'string', launchYear: 'int',
  },
  motherboard: { cpuPower: 'enum:cpuPower[]' },
  ram: { modules: 'int', moduleGB: 'int', casLatency: 'int', rgb: 'bool' },
  gpu: { chipMaker: 'enum:chipMaker', chip: 'string', launchYear: 'int', fans: 'int', thicknessMM: 'number' },
  psu: { formFactor: 'enum:psuFormFactor', atxVersion: 'string?' },
  // psuFormFactors null = the maker page gives only a PSU length, not a type.
  case: { caseType: 'enum:caseType', psuFormFactors: 'enum:psuFormFactor[]?', sidePanel: 'enum:sidePanel', frontPanel: 'enum:frontPanel?', boardMount: 'enum:boardMount?', frontIO: 'object' },
  cooler: { fans: 'int', fanSizeMM: 'int', rgb: 'bool' },
  storage: { interface: 'string', pcieGen: 'int', readMBs: 'int', writeMBs: 'int', rpm: 'int' },
  fans: { airflowCFM: 'number?', staticPressureMMH2O: 'number?', noiseDBA: 'number?' },
};

// Fields where null is a real answer, not "unknown": an F-series CPU has no iGPU name,
// an air cooler has no radiator, an AIO has no tower height, a maker publishes no TDP rating.
const NULL_MEANS_NONE = {
  cpu: (p, f) => f === 'igpuName',
  cooler: (p, f) => f === 'tdpRating' || (f === 'heightMM' && p.type === 'aio') || (f === 'radiatorSizeMM' && p.type === 'air'),
};
const nullIsNone = (p, f) => !!NULL_MEANS_NONE[p.category]?.(p, f);

// ---------------------------------------------------------------- helpers
const errors = [];
const warnings = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);
const known = (v) => v !== null && v !== undefined;

function checkType(spec, value) {
  if (spec.endsWith('[]*')) return Array.isArray(value) && value.length === 0 ? null : checkType(spec.slice(0, -1), value);
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
    if (!nullable && !nullIsNone(part, field) && part.specsVerified !== false) err(where, `"${field}" is null but specsVerified is not false`);
    return;
  }
  const e = checkType(s, v);
  if (e) err(where, `"${field}" ${e}`);
}

// Fields (and values one level down in objects) that are unknown nulls.
function unknownFields(p) {
  return Object.entries(p).flatMap(([k, v]) => {
    if (v === null) return nullIsNone(p, k) ? [] : [k];
    if (v && typeof v === 'object' && !Array.isArray(v)) return Object.entries(v).filter(([, x]) => x === null).map(([s]) => `${k}.${s}`);
    return [];
  });
}

// Null values inside an object field must also come with specsVerified:false.
function nestedNulls(w, p, field) {
  const obj = p[field];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
  for (const [k, v] of Object.entries(obj)) {
    if (v === null) { if (p.specsVerified !== false) err(w, `${field}.${k} is null but specsVerified is not false`); }
    else if (typeof v !== 'number' || v < 0) err(w, `${field}.${k} must be a non-negative number`);
  }
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
    if (known(p.maxPowerW) && p.maxPowerW < p.tdp) err(w, 'maxPowerW below tdp');
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
    if (known(p.maxMemoryGB)) range(w, 'maxMemoryGB', p.maxMemoryGB, 16, 512);
    range(w, 'm2Slots', p.m2Slots, 0, 8);
    range(w, 'sataPorts', p.sataPorts, 0, 10);
    if (Array.isArray(p.pcieSlots)) {
      p.pcieSlots.forEach((s, i) => {
        if (!/^x(1|4|8|16)$/.test(s.size)) err(w, `pcieSlots[${i}].size "${s.size}" invalid`);
        if (![1, 2, 4, 8, 16].includes(s.lanes)) err(w, `pcieSlots[${i}].lanes invalid`);
        if (![2, 3, 4, 5].includes(s.gen)) err(w, `pcieSlots[${i}].gen invalid`);
        if (s.lanes > Number(s.size.slice(1))) err(w, `pcieSlots[${i}] has more lanes than its physical size`);
        if ('from' in s && !['cpu', 'chipset'].includes(s.from)) err(w, `pcieSlots[${i}].from "${s.from}" invalid`);
      });
      if (!p.pcieSlots.some((s) => s.size === 'x16')) warn(w, 'no x16 slot listed');
    }
    if (Array.isArray(p.cpuPower)) {
      if (p.cpuPower[0] !== '8-pin') err(w, 'cpuPower: the first CPU power socket is an 8-pin');
      if (p.cpuPower.length > 3) err(w, 'cpuPower: more than 3 sockets');
    }
  },
  ram(p, w) {
    const m = /^(\d+)x(\d+)$/.exec(p.kit || '');
    if (!m) err(w, `kit "${p.kit}" must look like "2x16"`);
    else {
      if (+m[1] * +m[2] !== p.capacityGB) err(w, `kit ${p.kit} does not add up to ${p.capacityGB} GB`);
      if (known(p.modules) && p.modules !== +m[1]) err(w, 'modules does not match kit');
      if (known(p.moduleGB) && p.moduleGB !== +m[2]) err(w, 'moduleGB does not match kit');
    }
    if (p.type === 'DDR4') range(w, 'speedMTs', p.speedMTs, 2133, 5333);
    if (p.type === 'DDR5') range(w, 'speedMTs', p.speedMTs, 4000, 9000);
    if (known(p.heightMM)) range(w, 'heightMM', p.heightMM, 28, 70);
    if (p.name && p.type && !p.name.includes(p.type)) warn(w, `name does not mention ${p.type}`);
  },
  gpu(p, w) {
    if (known(p.lengthMM)) range(w, 'lengthMM', p.lengthMM, 120, 380);
    if (known(p.slotWidth)) range(w, 'slotWidth', p.slotWidth, 1, 4.5);
    if (known(p.tdp)) range(w, 'tdp', p.tdp, 30, 700);
    if (known(p.recommendedPSU)) range(w, 'recommendedPSU', p.recommendedPSU, 300, 1600);
    if (known(p.tdp) && known(p.recommendedPSU) && p.recommendedPSU < p.tdp * 1.5) warn(w, 'recommendedPSU looks low for its tdp');
    range(w, 'vramGB', p.vramGB, 2, 48);
    if (Array.isArray(p.powerConnectors) && p.powerConnectors.length === 0 && p.tdp > 75) err(w, 'over 75 W but no power connector');
  },
  psu(p, w) {
    range(w, 'wattage', p.wattage, 300, 2000);
    const c = p.connectors || {};
    for (const k of PSU_CONNECTORS) if (!(k in c)) err(w, `connectors.${k} missing`);
    for (const k of Object.keys(c)) if (!PSU_CONNECTORS.includes(k)) err(w, `unknown connector "${k}"`);
    nestedNulls(w, p, 'connectors');
    if (c.atx24 !== 1) err(w, 'every PSU has exactly one 24-pin');
    if (p.atxVersion && !/^[23]\.\d+$/.test(p.atxVersion)) err(w, `atxVersion "${p.atxVersion}" invalid`);
    if (p.atxVersion?.startsWith('3') && c.pcie16 === 0) warn(w, 'ATX 3.x unit without a 16-pin connector');
  },
  case(p, w) {
    if (known(p.maxGPULengthMM)) range(w, 'maxGPULengthMM', p.maxGPULengthMM, 150, 600);
    if (known(p.maxCoolerHeightMM)) range(w, 'maxCoolerHeightMM', p.maxCoolerHeightMM, 30, 220);
    // radiatorSupport: [{ position, maxMM, sizesMM? }]; sizesMM is the full list when the maker prints one.
    (p.radiatorSupport || []).forEach((r, i) => {
      const at = `radiatorSupport[${i}]`;
      if (!ENUMS.radiatorPosition.includes(r.position)) err(w, `${at}.position "${r.position}" invalid`);
      if (!RADIATOR_SIZES.includes(r.maxMM)) err(w, `${at}.maxMM ${r.maxMM} invalid`);
      if ('sizesMM' in r) {
        if (!Array.isArray(r.sizesMM) || !r.sizesMM.length || r.sizesMM.some((s) => !RADIATOR_SIZES.includes(s))) err(w, `${at}.sizesMM invalid`);
        else if (Math.max(...r.sizesMM) !== r.maxMM) err(w, `${at}.maxMM is not the largest of sizesMM`);
      }
    });
    if (p.radiatorSupport && new Set(p.radiatorSupport.map((r) => r.position)).size !== p.radiatorSupport.length) err(w, 'radiatorSupport repeats a position');
    // fanMounts: { position: { "120": n, "140": n } }; a position missing = no mount there.
    if (p.fanMounts) {
      for (const [pos, sizes] of Object.entries(p.fanMounts)) {
        if (!FAN_POSITIONS.includes(pos)) err(w, `fan position "${pos}" invalid`);
        if (!sizes || typeof sizes !== 'object' || !Object.keys(sizes).length) { err(w, `fanMounts.${pos} must be an object of size: count`); continue; }
        for (const [s, n] of Object.entries(sizes)) {
          if (!FAN_SIZES.includes(s)) err(w, `fanMounts.${pos} fan size "${s}" invalid`);
          if (!Number.isInteger(n) || n < 1 || n > 4) err(w, `fanMounts.${pos}.${s} count ${n} invalid`);
        }
      }
    }
    if (p.frontIO) {
      for (const k of Object.keys(p.frontIO)) if (!['usbC', 'usbA'].includes(k)) err(w, `frontIO.${k} unknown`);
      for (const k of ['usbC', 'usbA']) if (!Number.isInteger(p.frontIO[k]) || p.frontIO[k] < 0 || p.frontIO[k] > 4) err(w, `frontIO.${k} must be 0..4`);
    }
    nestedNulls(w, p, 'drivebays');
    nestedNulls(w, p, 'dimensionsMM');
    if (p.drivebays) for (const k of Object.keys(p.drivebays)) if (!['3.5', '2.5'].includes(k)) err(w, `drive bay size "${k}" invalid`);
    const d = p.dimensionsMM;
    if (d) {
      for (const k of ['depth', 'width', 'height']) range(w, `dimensionsMM.${k}`, d[k], 100, 800);
      // Some small cases (e.g. Corsair 2000D) mount the GPU vertically, so compare with the longest side.
      if (known(p.maxGPULengthMM) && d.depth && p.maxGPULengthMM > Math.max(d.depth, d.height || 0)) err(w, 'max GPU length is longer than the case');
      if (known(p.maxCoolerHeightMM) && d.width && p.maxCoolerHeightMM > d.width) err(w, 'max cooler height exceeds case width');
    }
    if (p.caseType === 'itx' && p.formFactorsSupported?.some((f) => f !== 'ITX')) err(w, 'ITX case lists a larger board');
  },
  cooler(p, w) {
    if (p.type === 'air') {
      if (known(p.heightMM)) range(w, 'heightMM', p.heightMM, 25, 200);
      if (known(p.radiatorSizeMM)) err(w, 'air cooler with a radiator size');
    }
    if (p.type === 'aio') {
      if (known(p.radiatorSizeMM) && ![120, 140, 240, 280, 360, 420].includes(p.radiatorSizeMM)) err(w, 'radiatorSizeMM invalid');
      if (known(p.heightMM)) warn(w, 'AIO with heightMM; case height checks only apply to air coolers');
    }
    if (known(p.tdpRating)) range(w, 'tdpRating', p.tdpRating, 50, 400);
  },
  storage(p, w) {
    if (p.type === 'nvme' && p.formFactor !== 'M.2 2280') err(w, 'NVMe drive should be M.2');
    if (p.type === 'nvme' && ![3, 4, 5].includes(p.pcieGen)) err(w, 'NVMe needs pcieGen 3, 4 or 5');
    if (p.type !== 'nvme' && 'pcieGen' in p) err(w, 'pcieGen only applies to NVMe');
    if (p.type === 'hdd' && !p.rpm) err(w, 'HDD needs rpm');
    range(w, 'capacityGB', p.capacityGB, 120, 24000);
    const max = p.type === 'nvme' ? { 3: 3600, 4: 7500, 5: 15000 }[p.pcieGen] : { sata: 600, hdd: 300 }[p.type];
    if (max && known(p.readMBs) && p.readMBs > max) err(w, `readMBs ${p.readMBs} too fast for this interface`);
  },
  fans(p, w) {
    if (![80, 92, 120, 140, 200].includes(p.sizeMM)) err(w, `sizeMM ${p.sizeMM} unusual`);
    range(w, 'thicknessMM', p.thicknessMM, 10, 40);
    range(w, 'packCount', p.packCount, 1, 10);
    if (known(p.rpmMax)) range(w, 'rpmMax', p.rpmMax, 300, 4000);
  },
};

// ---------------------------------------------------------------- load + per-part checks
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
    for (const [f, s] of Object.entries(COMMON_OPTIONAL)) checkField(w, p, f, s, false);
    if (NEEDS_SOURCE.includes(cat) && p.specsVerified === true && !p.specSource) err(w, 'specsVerified is true but specSource is missing');
    if (p.specSourceType && !p.specSource) err(w, 'specSourceType without specSource');
    if (p.category !== cat) err(w, `category "${p.category}" should be "${cat}"`);
    if (known(p.refPriceTHB) && (p.refPriceTHB < 100 || p.refPriceTHB > 300000)) err(w, `refPriceTHB ${p.refPriceTHB} looks wrong`);
    if (p.brand && p.name && !p.name.toLowerCase().startsWith(p.brand.toLowerCase())) warn(w, 'name does not start with brand');
    if (ids.has(p.id)) err(w, `duplicate id (also in ${ids.get(p.id)})`);
    ids.set(p.id, cat);
    if (names.has(p.name)) err(w, `duplicate name "${p.name}"`);
    names.add(p.name);
    if (p.specsVerified === false && !unknownFields(p).length) warn(w, 'specsVerified is false but no field is null');
    SANITY[cat]?.(p, w);
  });
}

// ---------------------------------------------------------------- cross-file checks
const { cpu, motherboard, ram, gpu, psu, storage, cooler, fans } = data;
const pcCase = data.case;

if (cpu && motherboard) {
  for (const socket of new Set(cpu.map((c) => c.socket))) {
    const n = motherboard.filter((b) => b.socket === socket).length;
    if (n < 3) err('cross', `socket ${socket} has ${n} motherboards (need at least 3)`);
  }
  for (const socket of new Set(motherboard.map((b) => b.socket))) {
    if (!cpu.some((c) => c.socket === socket)) err('cross', `motherboards for ${socket} but no CPU`);
  }
  for (const b of motherboard) {
    if (!cpu.some((c) => c.socket === b.socket && c.memoryType.includes(b.memoryType))) err('cross', `${b.id}: no CPU can run its ${b.memoryType}`);
  }
}
if (motherboard && ram) {
  for (const b of motherboard) {
    const fits = ram.filter((r) => r.type === b.memoryType && r.modules <= b.memorySlots && (!known(b.maxMemoryGB) || r.capacityGB <= b.maxMemoryGB));
    if (!fits.length) err('cross', `${b.id}: no RAM kit fits (${b.memoryType}, ${b.memorySlots} slots)`);
  }
  for (const t of ENUMS.memoryType) {
    if (motherboard.some((b) => b.memoryType === t) && ram.filter((r) => r.type === t).length < 3) err('cross', `fewer than 3 ${t} kits for ${t} boards`);
  }
}
if (cpu) for (const t of ENUMS.tier) if (!cpu.some((c) => c.tier === t)) warn('cross', `no CPU in tier ${t}`);

if (pcCase && motherboard) {
  const boardSizes = new Set(motherboard.map((b) => b.formFactor));
  for (const c of pcCase) {
    if (c.formFactorsSupported && !c.formFactorsSupported.some((f) => boardSizes.has(f))) err('cross', `${c.id}: supports no board size that exists in motherboard.json`);
  }
  for (const f of boardSizes) if (!pcCase.some((c) => c.formFactorsSupported?.includes(f))) err('cross', `no case takes ${f} boards`);
}
if (pcCase && gpu) {
  const maxLimit = Math.max(...pcCase.map((c) => c.maxGPULengthMM).filter(known));
  for (const g of gpu) {
    if (known(g.lengthMM) && g.lengthMM > maxLimit) err('cross', `${g.id}: ${g.lengthMM} mm is longer than every case (max ${maxLimit} mm)`);
  }
  const itxLimit = Math.max(0, ...pcCase.filter((c) => c.caseType === 'itx').map((c) => c.maxGPULengthMM).filter(known));
  if (itxLimit && !gpu.some((g) => known(g.lengthMM) && g.lengthMM <= itxLimit)) err('cross', 'no GPU fits any ITX case');
}
if (pcCase && cooler) {
  const maxH = Math.max(...pcCase.map((c) => c.maxCoolerHeightMM).filter(known));
  for (const k of cooler.filter((x) => x.type === 'air' && known(x.heightMM))) {
    if (k.heightMM > maxH) err('cross', `${k.id}: ${k.heightMM} mm is taller than every case allows (max ${maxH} mm)`);
  }
  const radSizes = pcCase.flatMap((c) => (c.radiatorSupport || []).map((r) => r.maxMM));
  for (const k of cooler.filter((x) => x.type === 'aio' && known(x.radiatorSizeMM))) {
    if (!radSizes.some((s) => s >= k.radiatorSizeMM)) err('cross', `${k.id}: no case lists a ${k.radiatorSizeMM} mm radiator mount`);
  }
  const itxHeights = pcCase.filter((c) => c.caseType === 'itx').map((c) => c.maxCoolerHeightMM).filter(known);
  const tightest = Math.min(...itxHeights);
  if (itxHeights.length && !cooler.some((k) => k.type === 'air' && known(k.heightMM) && k.heightMM <= tightest)) {
    warn('cross', `no air cooler low enough (${tightest} mm) for the tightest ITX case`);
  }
}
if (cooler && cpu) {
  for (const socket of new Set(cpu.map((c) => c.socket))) {
    const n = cooler.filter((k) => k.socketsSupported.includes(socket)).length;
    if (n < 3) err('cross', `socket ${socket} has ${n} coolers (need at least 3)`);
  }
  for (const k of cooler) for (const s of k.socketsSupported) if (!cpu.some((c) => c.socket === s)) warn('cross', `${k.id}: lists socket ${s} with no CPU in data`);
}
if (gpu && psu) {
  const maxW = Math.max(...psu.map((p) => p.wattage));
  for (const g of gpu) {
    if (known(g.recommendedPSU) && g.recommendedPSU > maxW) err('cross', `${g.id}: recommends ${g.recommendedPSU} W, above every PSU`);
    if (!Array.isArray(g.powerConnectors)) continue;
    const need8 = g.powerConnectors.filter((c) => c !== '16-pin').length;
    const need16 = g.powerConnectors.filter((c) => c === '16-pin').length;
    // A PSU "could" power the card unless a known connector count rules it out.
    const could = psu.some((p) => p.wattage >= (g.recommendedPSU || 0)
      && (!known(p.connectors.pcie16) || p.connectors.pcie16 >= need16)
      && (!known(p.connectors.pcie8) || p.connectors.pcie8 >= need8));
    if (!could) err('cross', `${g.id}: no PSU has the wattage and connectors it needs`);
  }
}
if (pcCase && psu) {
  for (const c of pcCase.filter((x) => x.psuFormFactors)) {
    if (!psu.some((p) => c.psuFormFactors.includes(p.formFactor))) err('cross', `${c.id}: no PSU in a supported form factor (${c.psuFormFactors.join('/')})`);
  }
}
if (storage) {
  for (const t of ENUMS.storageType) if (!storage.some((s) => s.type === t)) err('cross', `no ${t} storage`);
  for (const g of [3, 4, 5]) if (!storage.some((s) => s.pcieGen === g)) warn('cross', `no PCIe Gen ${g} NVMe drive`);
}
if (fans && !fans.some((f) => f.sizeMM === 120)) err('cross', 'no 120 mm fans');

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
