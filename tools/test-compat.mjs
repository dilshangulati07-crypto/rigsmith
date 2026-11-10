#!/usr/bin/env node
// Tests for compat.js, state.js, pricing.js and perf.js using real parts from data/parts.
// Usage: node tools/test-compat.mjs [-v]   (-v prints every issue of every build)
// Exit code 1 if any test fails.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCatalog } from '../js/catalog.js';
import { CATEGORY_IDS } from '../js/categories.js';
import { checkBuild, isPartCompatible, getVerification, summarize, estimateDraw } from '../js/compat.js';
import { BuildStore, emptyBuild } from '../js/state.js';
import { priceBuild, pricePerPerformance, PRICE_NOTE } from '../js/pricing.js';
import { estimatePerformance, PERF_LABEL } from '../js/perf.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('-v');
const catalog = createCatalog(Object.fromEntries(CATEGORY_IDS.map((c) => [c, JSON.parse(readFileSync(join(ROOT, 'data', 'parts', `${c}.json`), 'utf8')).parts])));

// ---------------------------------------------------------------- helpers
const part = (id) => {
  const p = catalog.get(id);
  if (!p) throw new Error(`test uses unknown part id "${id}"`);
  return p;
};
// build({ cpu: 'id', ram: ['id'], ... }) -> build of part objects
function build(spec) {
  const b = emptyBuild();
  for (const [k, v] of Object.entries(spec)) b[k] = Array.isArray(v) ? v.map(part) : v ? part(v) : null;
  return b;
}
const errors = (issues) => issues.filter((i) => i.level === 'error');
const find = (issues, rule, level) => issues.filter((i) => i.rule === rule && (!level || i.level === level));
const expectRule = (issues, rule, level) => assert.ok(find(issues, rule, level).length, `expected ${level ?? 'any'} "${rule}", got: ${fmt(issues)}`);
const expectNoErrors = (issues) => assert.equal(errors(issues).length, 0, `expected no errors, got: ${fmt(errors(issues))}`);
const fmt = (issues) => (issues.length ? `\n      ${issues.map((i) => `[${i.level}] ${i.rule}: ${i.message}`).join('\n      ')}` : '(none)');

const results = [];
function test(name, fn) {
  try {
    const issues = fn();
    results.push({ name, ok: true, issues: Array.isArray(issues) ? issues : null });
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
  }
}

// ---------------------------------------------------------------- known-good builds (zero errors)
const GOOD = {
  'AM5 gaming: 9800X3D + RX 9070 XT, Lancool 216, 360 AIO': {
    cpu: 'amd-ryzen-7-9800x3d', motherboard: 'asus-tuf-gaming-b850-plus-wifi', ram: ['corsair-vengeance-ddr5-32gb-2x16gb-6000mt-s-cl30'],
    gpu: 'sapphire-pulse-amd-radeon-rx-9070-xt-16gb', storage: ['samsung-990-pro-2tb'], psu: 'corsair-rm850e',
    case: 'lian-li-lancool-216', cooler: 'arctic-liquid-freezer-iii-360',
  },
  'Budget LGA1700: 12400F + RTX 4060, DDR4, mATX, boxed cooler': {
    cpu: 'intel-core-i5-12400f', motherboard: 'gigabyte-h610m-s2h-ddr4', ram: ['kingston-fury-beast-ddr4-16gb-2x8gb-3200mt-s-cl16'],
    gpu: 'gigabyte-geforce-rtx-4060-windforce-oc-8g', storage: ['crucial-p3-plus-1tb'], psu: 'corsair-cx650', case: 'deepcool-ch370',
  },
  'ITX: Ryzen 7 7700 + RTX 4060 Ti in NR200P, SFX PSU': {
    cpu: 'amd-ryzen-7-7700', motherboard: 'asus-rog-strix-b650e-i-gaming-wifi', ram: ['g-skill-flare-x5-ddr5-32gb-2x16gb-6000mt-s-cl30'],
    gpu: 'asus-dual-geforce-rtx-4060-ti-oc-edition-8gb', storage: ['samsung-990-evo-plus-1tb'], psu: 'corsair-sf750',
    case: 'cooler-master-masterbox-nr200p', cooler: 'thermalright-assassin-x-120-refined-se',
  },
  'Flagship: 9950X + RTX 5090 FE, O11 EVO XL, two NVMe, fans': {
    cpu: 'amd-ryzen-9-9950x', motherboard: 'asus-rog-crosshair-x870e-hero', ram: ['corsair-vengeance-ddr5-64gb-2x32gb-6000mt-s-cl30'],
    gpu: 'nvidia-geforce-rtx-5090-founders-edition', storage: ['crucial-t705-2tb', 'samsung-990-pro-4tb'], psu: 'corsair-hx1200i',
    case: 'lian-li-o11-dynamic-evo-xl', cooler: 'lian-li-galahad-ii-trinity-360', fans: ['lian-li-uni-fan-tl120-3-pack', 'lian-li-uni-fan-tl120-3-pack'],
  },
  'LGA1851: Ultra 5 245K + RTX 5070 FE, Fractal North, 240 AIO': {
    cpu: 'intel-core-ultra-5-245k', motherboard: 'asus-tuf-gaming-b860-plus-wifi', ram: ['kingston-fury-beast-ddr5-32gb-2x16gb-5600mt-s-cl36'],
    gpu: 'nvidia-geforce-rtx-5070-founders-edition', storage: ['kingston-nv3-1tb'], psu: 'msi-mag-a750gl-pcie5',
    case: 'fractal-design-north', cooler: 'arctic-liquid-freezer-iii-240',
  },
  'Office: i5-12400 on integrated graphics, no GPU': {
    cpu: 'intel-core-i5-12400', motherboard: 'asus-prime-h610m-e-d4', ram: ['kingston-fury-beast-ddr4-16gb-2x8gb-3200mt-s-cl16'],
    storage: ['crucial-p3-1tb'], psu: 'msi-mag-a650bn', case: 'cooler-master-masterbox-q300l',
  },
};
for (const [name, spec] of Object.entries(GOOD)) {
  test(`good build: ${name}`, () => {
    const issues = checkBuild(build(spec));
    expectNoErrors(issues);
    assert.equal(find(issues, 'missing-part').length, 0, 'complete build reports a missing part');
    return issues;
  });
}

// ---------------------------------------------------------------- vertical-GPU case
test('vertical GPU case: 320 mm RX 7900 XTX fits Corsair 2000D (271 mm deep) via its 365 mm vertical mount', () => {
  const issues = checkBuild(build({
    cpu: 'amd-ryzen-7-7800x3d', motherboard: 'asus-rog-strix-x870-i-gaming-wifi', ram: ['g-skill-flare-x5-ddr5-32gb-2x16gb-6000mt-s-cl30'],
    gpu: 'sapphire-nitro-plus-amd-radeon-rx-7900-xtx-vapor-x-24gb', storage: ['western-digital-wd-black-sn850x-1tb'],
    psu: 'cooler-master-v850-sfx-gold', case: 'corsair-2000d-airflow', cooler: 'arctic-liquid-freezer-iii-360',
  }));
  expectNoErrors(issues);
  expectRule(issues, 'gpu-vertical', 'info');
  assert.equal(find(issues, 'gpu-length', 'error').length, 0);
  assert.equal(find(issues, 'gpu-board-slot').length, 0, 'vertical mount should not report covered board slots');
  return issues;
});
test('vertical GPU case: ATX board does not fit the ITX-only 2000D', () => {
  const issues = checkBuild(build({ motherboard: 'msi-mag-b550-tomahawk', case: 'corsair-2000d-airflow' }));
  expectRule(issues, 'board-case', 'error');
  return issues;
});

// ---------------------------------------------------------------- known incompatible combos
const BAD = [
  ['AM5 CPU on an LGA1700 board', { cpu: 'amd-ryzen-7-9800x3d', motherboard: 'asus-prime-z790-p-wifi' }, 'cpu-socket'],
  ['DDR4 kit on a DDR5 board', { motherboard: 'asus-tuf-gaming-b650-plus-wifi', ram: ['corsair-vengeance-lpx-ddr4-32gb-2x16gb-3200mt-s-cl16'] }, 'ram-type'],
  ['DDR4 and DDR5 kits together', { ram: ['corsair-vengeance-lpx-ddr4-32gb-2x16gb-3200mt-s-cl16', 'corsair-vengeance-ddr5-32gb-2x16gb-6000mt-s-cl30'] }, 'ram-mixed-type'],
  ['Four modules on a 2-slot ITX board', { motherboard: 'asus-rog-strix-b650e-i-gaming-wifi', ram: ['g-skill-flare-x5-ddr5-32gb-2x16gb-6000mt-s-cl30', 'g-skill-flare-x5-ddr5-32gb-2x16gb-6000mt-s-cl30'] }, 'ram-slots'],
  ['RTX 4090 Strix (358 mm) in Lian Li A4-H2O (322 mm)', { gpu: 'asus-rog-strix-geforce-rtx-4090-oc-edition', case: 'lian-li-a4-h2o' }, 'gpu-length'],
  ['Noctua NH-D15 G2 (168 mm) in Fractal North (145 mm)', { cooler: 'noctua-nh-d15-g2', case: 'fractal-design-north' }, 'cooler-height'],
  ['360 mm AIO in Fractal Terra (120 mm only)', { cooler: 'arctic-liquid-freezer-iii-360', case: 'fractal-design-terra' }, 'radiator-fit'],
  ['360 mm AIO in NZXT H5 Flow (front 280, top 240)', { cooler: 'deepcool-lt720', case: 'nzxt-h5-flow' }, 'radiator-fit'],
  ['AM-only Noctua NH-L9a-AM5 on LGA1700', { cpu: 'intel-core-i5-13600k', cooler: 'noctua-nh-l9a-am5' }, 'cooler-socket'],
  ['i9-14900K + RTX 4090 on a 650 W PSU', { cpu: 'intel-core-i9-14900k', gpu: 'nvidia-geforce-rtx-4090-founders-edition', psu: 'corsair-cx650' }, 'psu-wattage'],
  ['3x 8-pin RX 7900 XTX Nitro+ on a 2x 8-pin PSU', { gpu: 'sapphire-nitro-plus-amd-radeon-rx-7900-xtx-vapor-x-24gb', psu: 'corsair-cx650' }, 'gpu-power'],
  ['16-pin RTX 5090 on a PSU with no 16-pin and 3x 8-pin', { gpu: 'nvidia-geforce-rtx-5090-founders-edition', psu: 'deepcool-pm750d' }, 'gpu-power'],
  ['ATX PSU in SFX-only Lian Li A4-H2O', { psu: 'corsair-rm850e', case: 'lian-li-a4-h2o' }, 'psu-form-factor'],
  ['Two NVMe drives on a 1-slot A520 board', { motherboard: 'gigabyte-a520m-s2h', storage: ['crucial-p3-plus-1tb', 'samsung-980-1tb'] }, 'm2-slots'],
  ['Three SATA drives on a 2-port X870 board', { motherboard: 'asus-tuf-gaming-x870-plus-wifi', storage: ['samsung-870-evo-1tb', 'crucial-mx500-1tb', 'seagate-barracuda-2tb-st2000dm008'] }, 'sata-ports'],
  ['3.5in hard drive in Fractal Terra (no 3.5in bay)', { case: 'fractal-design-terra', storage: ['seagate-barracuda-4tb-st4000dm004'] }, 'drive-bays'],
];
for (const [name, spec, rule] of BAD) {
  test(`incompatible: ${name}`, () => {
    const issues = checkBuild(build(spec));
    expectRule(issues, rule, 'error');
    return issues;
  });
}

test('incompatible: F-series CPU, no GPU, rest of build complete -> no display output error', () => {
  const issues = checkBuild(build({ ...GOOD['Budget LGA1700: 12400F + RTX 4060, DDR4, mATX, boxed cooler'], gpu: null }));
  expectRule(issues, 'display-output', 'error');
  return issues;
});
test('partial build: F-series CPU with no GPU yet is a warning, not an error', () => {
  const issues = checkBuild(build({ cpu: 'intel-core-i5-12400f' }));
  expectRule(issues, 'display-output', 'warn');
  expectNoErrors(issues);
  return issues;
});

// ---------------------------------------------------------------- warnings and notes
test('warn: Ryzen 9000 on a B650 board needs a BIOS update; B850 does not', () => {
  const old = checkBuild(build({ cpu: 'amd-ryzen-7-9800x3d', motherboard: 'asus-tuf-gaming-b650-plus-wifi' }));
  expectRule(old, 'bios-update', 'warn');
  const fresh = checkBuild(build({ cpu: 'amd-ryzen-7-9800x3d', motherboard: 'asus-tuf-gaming-b850-plus-wifi' }));
  assert.equal(find(fresh, 'bios-update').length, 0);
  return old;
});
test('warn: 14th-gen CPU on B760 needs BIOS; note that B760 cannot overclock a K CPU', () => {
  const issues = checkBuild(build({ cpu: 'intel-core-i7-14700k', motherboard: 'asus-tuf-gaming-b760-plus-wifi' }));
  expectRule(issues, 'bios-update', 'warn');
  expectRule(issues, 'chipset-oc', 'info');
  return issues;
});
test('warn: PSU with less than 30% headroom (7800X3D + RX 7900 XTX on 750 W)', () => {
  const b = build({ cpu: 'amd-ryzen-7-7800x3d', motherboard: 'asus-tuf-gaming-b650-plus-wifi', ram: ['corsair-vengeance-ddr5-32gb-2x16gb-6000mt-s-cl30'], gpu: 'amd-radeon-rx-7900-xtx', storage: ['samsung-990-pro-1tb'], psu: 'corsair-rm750e' });
  const issues = checkBuild(b);
  const draw = estimateDraw(b);
  assert.ok(draw.watts <= 750 && draw.watts * 1.3 > 750, `draw ${draw.watts} W should sit between 577 and 750 W`);
  expectRule(issues, 'psu-headroom', 'warn');
  expectNoErrors(issues);
  return issues;
});
test('info: 16-pin RTX 4090 on a PSU without 16-pin but 4x 8-pin runs from the adapter', () => {
  const issues = checkBuild(build({ gpu: 'nvidia-geforce-rtx-4090-founders-edition', psu: 'cooler-master-mwe-gold-850-v2-full-modular' }));
  expectRule(issues, 'gpu-power', 'info');
  assert.equal(find(issues, 'gpu-power', 'error').length, 0);
  return issues;
});
test('info: SFX PSU in an ATX case needs a bracket', () => {
  const issues = checkBuild(build({ psu: 'corsair-sf750', case: 'corsair-4000d-airflow' }));
  expectRule(issues, 'psu-form-factor', 'info');
  expectNoErrors(issues);
  return issues;
});
test('warn: 360 AIO that only fits the front plus a long GPU (Fractal North)', () => {
  const issues = checkBuild(build({ gpu: 'asus-tuf-gaming-geforce-rtx-4070-ti-super-oc-edition', case: 'fractal-design-north', cooler: 'arctic-liquid-freezer-iii-360' }));
  expectRule(issues, 'gpu-length-radiator', 'warn');
  return issues;
});
test('warn: too many fans for the case mounts (2x Arctic P14 5-packs in NR200P)', () => {
  const issues = checkBuild(build({ case: 'cooler-master-masterbox-nr200p', fans: ['arctic-p14-pwm-pst-5-pack', 'arctic-p14-pwm-pst-5-pack'] }));
  expectRule(issues, 'fan-mounts', 'warn');
  return issues;
});
test('warn: low-profile cooler with no rating on a 230 W Ryzen 9 7950X', () => {
  const issues = checkBuild(build({ cpu: 'amd-ryzen-9-7950x', cooler: 'noctua-nh-l12s' }));
  expectRule(issues, 'cooler-capacity', 'warn');
  return issues;
});

// ---------------------------------------------------------------- missing data (null = unknown -> info, never pass/fail)
const UNKNOWN = [
  ['GPU with null length (Gigabyte RTX 5070 SFF) in a small case', { gpu: 'gigabyte-geforce-rtx-5070-windforce-oc-sff-12g', case: 'lian-li-a4-h2o' }, 'gpu-length'],
  ['GPU with null power connectors', { gpu: 'asrock-intel-arc-b580-challenger-12gb-oc', psu: 'corsair-cx650' }, 'gpu-power'],
  ['GPU with null board power: wattage estimate leaves it out', { cpu: 'intel-core-i7-14700k', gpu: 'asus-rog-astral-geforce-rtx-5090-oc-edition', psu: 'corsair-hx1200i' }, 'psu-wattage'],
  ['Case with null board sizes (Corsair 3000D)', { motherboard: 'msi-mag-b550-tomahawk', case: 'corsair-3000d-airflow' }, 'board-case'],
  ['Board with null max memory', { motherboard: 'msi-b450m-pro-vdh-max', ram: ['kingston-fury-beast-ddr4-64gb-2x32gb-3200mt-s-cl16'] }, 'ram-capacity'],
  ['Board with null M.2 count', { motherboard: 'gigabyte-b850-aorus-elite-wifi7', storage: ['samsung-990-pro-1tb'] }, 'm2-slots'],
  ['PSU with null PCIe 8-pin count', { gpu: 'sapphire-pulse-amd-radeon-rx-7800-xt-16gb', psu: 'thermaltake-smart-500w' }, 'gpu-power'],
  ['Case with null radiator support (HYTE Y60)', { cooler: 'nzxt-kraken-240', case: 'hyte-y60' }, 'radiator-fit'],
  ['Case with null PSU sizes (Phanteks NV7)', { psu: 'corsair-rm1000x-2024', case: 'phanteks-nv7' }, 'psu-form-factor'],
  ['GPU slot width derived from thickness (MSI 5070 Ti, 49 mm -> 2.5 slots)', { gpu: 'msi-geforce-rtx-5070-ti-16g-ventus-3x-oc', motherboard: 'asus-tuf-gaming-b650-plus-wifi' }, 'gpu-board-slot'],
];
for (const [name, spec, rule] of UNKNOWN) {
  test(`missing data: ${name}`, () => {
    const issues = checkBuild(build(spec));
    expectNoErrors(issues);
    expectRule(issues, rule, 'info');
    return issues;
  });
}
test('missing data: unknown spec never makes a part incompatible', () => {
  const b = build({ case: 'lian-li-a4-h2o' });
  const r = isPartCompatible(part('gigabyte-geforce-rtx-5070-windforce-oc-sff-12g'), b);
  assert.equal(r.ok, true);
  assert.ok(r.issues.some((i) => i.level === 'info' && /Can't confirm/.test(i.message)));
});

// ---------------------------------------------------------------- empty and missing parts
test('empty build: every essential part reported missing, no errors', () => {
  const issues = checkBuild(emptyBuild());
  expectNoErrors(issues);
  const missing = find(issues, 'missing-part').map((i) => i.category).sort();
  assert.deepEqual(missing, ['case', 'cooler', 'cpu', 'motherboard', 'psu', 'ram', 'storage']);
  return issues;
});
test('missing cooler: CPU without a boxed cooler needs one, CPU with one does not', () => {
  assert.ok(find(checkBuild(build({ cpu: 'amd-ryzen-7-9800x3d' })), 'missing-part').some((i) => i.category === 'cooler'));
  const boxed = checkBuild(build({ cpu: 'intel-core-i5-12400f' }));
  assert.ok(!find(boxed, 'missing-part').some((i) => i.category === 'cooler'));
  expectRule(boxed, 'boxed-cooler', 'info');
});

// ---------------------------------------------------------------- isPartCompatible
test('isPartCompatible: greys out wrong-socket CPUs and oversize boards, with a reason', () => {
  const b = build({ motherboard: 'asus-tuf-gaming-b650-plus-wifi', case: 'cooler-master-masterbox-nr200p' });
  const intel = isPartCompatible(part('intel-core-i5-13600k'), b);
  assert.equal(intel.ok, false);
  assert.match(intel.reason, /LGA1700/);
  assert.equal(isPartCompatible(part('amd-ryzen-5-7600'), b).ok, true);
  const atx = isPartCompatible(part('msi-mag-b550-tomahawk'), build({ case: 'cooler-master-masterbox-nr200p' }));
  assert.equal(atx.ok, false);
  assert.ok(atx.fix);
});
test('isPartCompatible: F-series CPU is not greyed out just because no GPU is picked yet', () => {
  assert.equal(isPartCompatible(part('intel-core-i5-12400f'), build({ motherboard: 'gigabyte-h610m-s2h-ddr4' })).ok, true);
});
test('isPartCompatible: RAM replaces the current kit, storage adds a drive', () => {
  const b = build({ motherboard: 'asus-rog-strix-b650e-i-gaming-wifi', ram: ['g-skill-flare-x5-ddr5-32gb-2x16gb-6000mt-s-cl30'], storage: ['samsung-990-pro-1tb', 'samsung-990-pro-2tb'] });
  assert.equal(isPartCompatible(part('corsair-vengeance-ddr5-32gb-2x16gb-6000mt-s-cl30'), b).ok, true);
  assert.equal(isPartCompatible(part('corsair-vengeance-ddr5-32gb-2x16gb-6000mt-s-cl30'), b, { mode: 'add' }).ok, false);
  assert.equal(isPartCompatible(part('crucial-p3-plus-1tb'), b).ok, false); // 3rd NVMe, 2 M.2 slots
});

// ---------------------------------------------------------------- verification
test('getVerification: counts fully verified parts, lists unknown fields of the rest', () => {
  const v = getVerification(build({ cpu: 'amd-ryzen-7-9800x3d', motherboard: 'msi-mag-b650-tomahawk-wifi', ram: ['corsair-vengeance-ddr5-32gb-2x16gb-6000mt-s-cl30'], storage: ['samsung-990-pro-1tb', 'samsung-990-pro-1tb'], psu: 'seasonic-focus-gx-850-atx-3-0' }));
  assert.equal(v.total, 5); // duplicate drive counted once
  assert.equal(v.verified, 3);
  assert.deepEqual(v.unverified.map((p) => p.id).sort(), ['msi-mag-b650-tomahawk-wifi', 'seasonic-focus-gx-850-atx-3-0']);
  assert.ok(v.unverified.find((p) => p.category === 'motherboard').unknownFields.includes('pcieSlots'));
  assert.equal(v.allVerified, false);
});

// ---------------------------------------------------------------- state.js
test('state: add / replace / remove fire change events; save + load round-trips by id', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  const s = new BuildStore({ storage, storageKey: 'test' });
  const events = [];
  s.addEventListener('change', (e) => events.push(e.detail.action));
  s.add(part('amd-ryzen-5-7600'));
  s.add(part('amd-ryzen-7-7700')); // single slot -> replace
  s.add(part('samsung-990-pro-1tb'));
  s.add(part('crucial-p3-plus-1tb'));
  assert.equal(s.replace('samsung-990-pro-1tb', part('samsung-990-pro-2tb')), true);
  assert.equal(s.remove('storage', 'crucial-p3-plus-1tb'), true);
  assert.deepEqual(events, ['add', 'replace', 'add', 'add', 'replace', 'remove']);
  assert.equal(s.get('cpu').id, 'amd-ryzen-7-7700');
  assert.deepEqual(s.get('storage').map((p) => p.id), ['samsung-990-pro-2tb']);

  const copy = s.build;
  copy.storage.push(part('crucial-p3-1tb'));
  assert.equal(s.get('storage').length, 1, 'snapshot must not leak internal arrays');

  const s2 = new BuildStore({ storage, storageKey: 'test' });
  const res = s2.load(catalog);
  assert.equal(res.loaded, true);
  assert.equal(s2.get('cpu').id, 'amd-ryzen-7-7700');
  assert.deepEqual(s2.get('storage').map((p) => p.id), ['samsung-990-pro-2tb']);

  // Unknown ids from an old save are dropped and reported, broken JSON is ignored.
  mem.set('test', JSON.stringify({ version: 1, parts: { cpu: 'no-such-cpu', ram: [] } }));
  assert.deepEqual(new BuildStore({ storage, storageKey: 'test' }).load(catalog).missing, ['no-such-cpu']);
  mem.set('test', '{broken');
  assert.equal(new BuildStore({ storage, storageKey: 'test' }).load(catalog).loaded, false);
  s.clear();
  assert.equal(s.get('cpu'), null);
});
test('state: works with no storage at all (private mode / Node)', () => {
  const s = new BuildStore({ storage: null });
  s.add(part('amd-ryzen-5-7600'));
  assert.equal(s.save(), false);
  assert.equal(s.load(catalog).loaded, false);
});

// ---------------------------------------------------------------- pricing + perf
test('pricing: total = sum of refPriceTHB, per-category subtotals, labelled reference price', () => {
  const b = build(GOOD['Flagship: 9950X + RTX 5090 FE, O11 EVO XL, two NVMe, fans']);
  const p = priceBuild(b);
  const sum = Object.values(b).flatMap((v) => (Array.isArray(v) ? v : v ? [v] : [])).reduce((s, x) => s + x.refPriceTHB, 0);
  assert.equal(p.total, sum);
  assert.equal(p.byCategory.storage.count, 2);
  assert.equal(p.byCategory.fans.subtotal, part('lian-li-uni-fan-tl120-3-pack').refPriceTHB * 2);
  assert.equal(p.note, 'Reference price, not live');
  assert.equal(PRICE_NOTE, 'Reference price, not live');
  const ppp = pricePerPerformance(b);
  assert.ok(ppp.workloads.gaming1440.thbPerPoint > 0);
  assert.match(ppp.note, /not live/);
});
test('perf: labelled estimate, 0-100, faster GPU scores higher, CPU bottleneck hint', () => {
  const base = { cpu: 'intel-core-i5-12400f', ram: ['kingston-fury-beast-ddr4-16gb-2x8gb-3200mt-s-cl16'], storage: ['crucial-p3-plus-1tb'] };
  const slow = estimatePerformance(build({ ...base, gpu: 'gigabyte-geforce-rtx-4060-windforce-oc-8g' }));
  const fast = estimatePerformance(build({ ...base, gpu: 'nvidia-geforce-rtx-4090-founders-edition' }));
  assert.equal(fast.label, PERF_LABEL);
  assert.equal(PERF_LABEL, 'Estimate');
  for (const s of Object.values(fast.scores)) assert.ok(s >= 0 && s <= 100);
  assert.ok(fast.scores.gaming1440 > slow.scores.gaming1440);
  assert.match(fast.bottleneck.primary, /limits .* at 1080p/);
  assert.doesNotMatch(slow.bottleneck.primary, /limits/);
  const none = estimatePerformance(build({}));
  assert.equal(none.scores.gaming1080, null);
  assert.deepEqual(none.missing, ['CPU']);
  const igpu = estimatePerformance(build({ cpu: 'amd-ryzen-7-8700g' }));
  assert.ok(igpu.scores.gaming1080 > 0 && igpu.scores.gaming1080 < 20);
  assert.equal(igpu.assumptions.length, 2); // no RAM, no storage
});

// ---------------------------------------------------------------- report
const pad = (s, n) => String(s).padEnd(n);
console.log('\nRigsmith compatibility tests');
console.log('─'.repeat(72));
for (const r of results) {
  const s = r.issues ? summarize(r.issues) : null;
  const counts = s ? `  [${s.error}E ${s.warn}W ${s.info}I]` : '';
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${pad(r.name, 0)}${counts}`);
  if (!r.ok) console.log(`      ${r.error}`);
  if (VERBOSE && r.issues) console.log(`      ${fmt(r.issues).trim()}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log('─'.repeat(72));
console.log(`${results.length - failed}/${results.length} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
