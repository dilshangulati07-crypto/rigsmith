#!/usr/bin/env node
// Share links, exports and the QR encoder, in Node:
// - build codes: round trip for every preset, the test builds and random builds; short and
//   URL-safe; unknown or wrong-category ids are reported and the rest still loads; damaged,
//   empty and future-version codes fail cleanly; hash clashes fall back to full ids;
// - link params (b / h / n pairing for builder and compare links);
// - build-by-hand state: round trip at every stage of an install, cables with moved
//   waypoints and other ports, closed panel and cable style, through AssemblyProgress;
//   damaged codes are refused, out-of-order pieces are dropped;
// - CSV export: columns, quoting, totals, search links, formula guard;
// - QR: every symbol is read back by an independent decoder in this file (format BCH,
//   version BCH, Reed-Solomon syndromes, byte-mode payload).
// Usage: node tools/test-share.mjs [-v]
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalog, BUILDS, idsOf } from './test-builds.mjs';
import { createCatalog } from '../js/catalog.js';
import { CATEGORIES, CATEGORY_IDS } from '../js/categories.js';
import { encodeBuild, decodeBuild, buildFromIds, shortId, shareUrl, compareUrl, readShareParams, missingMessage } from '../js/share.js';
import { encodeHand, decodeHand, plansFor } from '../js/share-hand.js';
import { AssemblyProgress, emptyBuild } from '../js/state.js';
import { presetBuild } from '../js/presets.js';
import { buildCSV } from '../js/export.js';
import { priceBuild } from '../js/pricing.js';
import { qrMatrix, qrSvg, alignmentPositions, blockInfo } from '../js/qr.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('-v');
let failures = 0;
let checks = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) { failures++; console.log(`  FAIL ${msg}`); } else if (VERBOSE) console.log(`  ok   ${msg}`);
  return cond;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const { presets } = JSON.parse(readFileSync(join(ROOT, 'data', 'presets.json'), 'utf8'));

// ---------------------------------------------------------------- build codes
console.log('Build codes');
const allIds = CATEGORY_IDS.flatMap((c) => catalog.list(c).map((p) => p.id));
ok(allIds.every((id) => /^[a-z0-9-]+$/.test(id)), 'every part id is [a-z0-9-] (safe inside a code)');
let clashes = 0;
for (const c of CATEGORY_IDS) {
  const s = catalog.list(c).map((p) => shortId(p.id));
  clashes += s.length - new Set(s).size;
}
ok(true, `short-code clashes in the catalogue: ${clashes} (fall back to full ids)`);
ok(shortId('amd-ryzen-7-9800x3d') === shortId('amd-ryzen-7-9800x3d') && /^[0-9a-z]{4}$/.test(shortId('x')), 'short ids are stable 4-character base-36');

const named = [
  ...presets.map((p) => ({ name: `preset ${p.id}`, build: presetBuild(p, catalog) })),
  ...BUILDS.map((b) => ({ name: `test build ${b.id}`, build: b.build })),
];
// Random builds: any part per category, repeats in the multi slots, some slots empty.
let seed = 7;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n; };
for (let i = 0; i < 200; i++) {
  const b = emptyBuild();
  for (const c of CATEGORIES) {
    const list = catalog.list(c.id);
    if (rnd(5) === 0) continue;
    if (c.multiple) {
      const n = 1 + rnd(4);
      for (let k = 0; k < n; k++) b[c.id].push(list[rnd(3) === 0 && b[c.id].length ? list.indexOf(b[c.id][b[c.id].length - 1]) : rnd(list.length)]);
    } else b[c.id] = list[rnd(list.length)];
  }
  named.push({ name: `random ${i}`, build: b });
}
let longest = 0;
let roundTrips = 0;
for (const { name, build } of named) {
  const code = encodeBuild(build, catalog);
  longest = Math.max(longest, code.length);
  const d = decodeBuild(code, catalog);
  const good = d.ok && !d.missing.length && same(d.ids, idsOf(build)) && encodeURIComponent(code) === code && new URLSearchParams(`b=${code}`).toString() === `b=${code}`;
  if (good) roundTrips++;
  else ok(false, `${name}: round trip (${code})`);
}
ok(roundTrips === named.length, `round trip for ${named.length} builds (presets, test builds, random), longest code ${longest} chars`);
const full = presetBuild(presets.find((p) => p.id === '4k-flagship'), catalog);
const code4k = encodeBuild(full, catalog);
ok(code4k.length <= 60, `a full build is a short code (${code4k}, ${code4k.length} chars)`);
ok(encodeBuild(emptyBuild(), catalog) === '', 'an empty build encodes to an empty code');
const twoKits = { ...emptyBuild(), ram: [catalog.list('ram')[3], catalog.list('ram')[3]], fans: [catalog.list('fans')[0], catalog.list('fans')[0], catalog.list('fans')[0], catalog.list('fans')[1]] };
const twoCode = encodeBuild(twoKits, catalog);
ok(/\*2/.test(twoCode) && /\*3_/.test(twoCode) && same(decodeBuild(twoCode, catalog).ids, idsOf(twoKits)), `repeats are run-length coded (${twoCode})`);

// Bad and partial codes: clear errors, and load what can be loaded.
const parts = code4k.split('.');
const withBad = [...parts];
withBad[1] = 'zzzz';             // cpu: unknown short code
withBad[3] = `${parts[3]}_qqqq`; // ram: one good kit, one unknown
withBad[7] = parts[2];           // case field holds a motherboard code
const bad = decodeBuild(withBad.join('.'), catalog);
ok(bad.ok && bad.missing.length === 3, `unknown and wrong-category tokens are reported (${bad.missing.map((m) => `${m.category}:${m.token}`).join(', ')})`);
ok(bad.ids.cpu === null && bad.ids.case === null && bad.ids.ram.length === 1 && bad.ids.gpu === full.gpu.id && bad.ids.motherboard === full.motherboard.id, '... and everything else still loads');
const msg = missingMessage(bad.missing);
ok(/^3 parts in this link \(processor, memory, case\) are not in the parts catalogue and were left out\. Everything else loaded\.$/.test(msg), `plain message: "${msg}"`);
ok(missingMessage([]) === '' && /^One part .* \(graphics card\) is not/.test(missingMessage([{ label: 'Graphics card', token: 'x' }])), 'singular wording');
const fullIds = decodeBuild(`1.${full.cpu.id}.${full.motherboard.id}`, catalog);
ok(fullIds.ok && fullIds.ids.cpu === full.cpu.id && fullIds.ids.motherboard === full.motherboard.id, 'full part ids are accepted in place of short codes');
for (const [code, why] of [['', 'empty'], ['2.abcd', 'future version'], ['1.ab cd', 'space'], ['1.<script>', 'markup'], [`1${'.a'.repeat(12)}`, 'too many fields'], ['hello', 'not a code']]) {
  const r = decodeBuild(code, catalog);
  ok(!r.ok && typeof r.error === 'string' && r.error.length > 10 && !r.missing.length, `${why} code fails with a message: "${r.error}"`);
}
ok(decodeBuild('1.abcd*99', catalog).missing.length === 1, 'nonsense repeat counts do not crash');
const resolved = buildFromIds(bad.ids, catalog);
ok(resolved.gpu === full.gpu && Array.isArray(resolved.fans) && resolved.cpu === null, 'buildFromIds gives part objects');

// Hash clash: two ids with one short code in a category are written as full ids.
const byShort = new Map();
let pair = null;
for (let i = 0; !pair && i < 200000; i++) {
  const id = `test-cpu-${i}`;
  const s = shortId(id);
  if (byShort.has(s)) pair = [byShort.get(s), id];
  byShort.set(s, id);
}
const fake = createCatalog({ cpu: pair.map((id) => ({ id, category: 'cpu', name: id })) });
const clashCode = encodeBuild({ cpu: { id: pair[1] } }, fake);
ok(clashCode === `1.${pair[1]}` && decodeBuild(clashCode, fake).ids.cpu === pair[1], `a hash clash (${pair.join(' / ')}) uses the full id`);

// ---------------------------------------------------------------- link params
console.log('Link params');
const base = 'https://example.netlify.app/sub/compare.html?x=1#y';
const link = shareUrl(base, { code: code4k, hand: '1.abc.de.02', name: '4K flagship & co' });
ok(link.startsWith('https://example.netlify.app/sub/builder.html?b=') && !link.includes('#') && !link.includes('x=1'), `builder link: ${link}`);
const back = readShareParams(new URL(link).search);
ok(back.length === 1 && back[0].code === code4k && back[0].hand === '1.abc.de.02' && back[0].name === '4K flagship & co', 'builder link params read back');
const cmp = compareUrl(base, [{ code: code4k, name: 'A' }, { code: '', name: '' }, { code: encodeBuild(BUILDS[0].build, catalog), name: 'C, with comma' }, { code: 'x', name: 'dropped' }]);
const cols = readShareParams(new URL(cmp).search);
ok(cols.length === 3 && cols[0].name === 'A' && cols[1].code === '1' && cols[1].name === '' && cols[2].name === 'C, with comma', `compare link keeps three columns in order: ${cmp}`);
ok(decodeBuild(cols[1].code, catalog).ok && !Object.values(decodeBuild(cols[1].code, catalog).ids).some((v) => (Array.isArray(v) ? v.length : v)), 'an empty column round-trips as an empty build');
ok(readShareParams('?n=orphan&h=x').length === 0, 'n and h without b are ignored');

// ---------------------------------------------------------------- build-by-hand state
console.log('Build-by-hand state');
for (const { id, build } of BUILDS) {
  const plans = plansFor(build);
  const keys = plans.aplan.groups.flatMap((g) => g.pieces); // install order
  const items = plans.cplan.items.filter((i) => !i.unavailable);
  ok(keys.length > 5 && items.length > 5, `${id}: plans have pieces (${keys.length}) and cables (${items.length})`);
  // Every stage of an install, in plan order.
  let stagesOk = true;
  for (let n = 0; n <= keys.length; n++) {
    const prog = { installed: keys.slice(0, n), cables: {}, closed: false, cableStyle: { kind: 'black', color: '#ff5a1f' } };
    const code = encodeHand(build, prog, plans);
    if (n === 0) { if (code !== '') stagesOk = false; continue; }
    const d = decodeHand(code, build, plans);
    if (!d.ok || !same(d.state.installed, keys.slice(0, n)) || d.state.caseId !== build.case.id) stagesOk = false;
  }
  ok(stagesOk, `${id}: installed pieces round-trip at all ${keys.length + 1} stages`);

  // Everything in, every cable, a moved route, a swapped port, closed, custom colour.
  const cables = Object.fromEntries(items.map((i) => [i.id, { pts: null, src: null, dst: null }]));
  cables[items[0].id] = { pts: [[1.25, 2.5, -3], [4, 5.75, 6]], src: null, dst: null };
  cables[items[1].id] = { pts: null, src: items[1].from, dst: items[1].to };
  const prog = { installed: keys, cables, closed: true, cableStyle: { kind: 'custom', color: '#3ddc97' } };
  const code = encodeHand(build, prog, plans);
  const d = decodeHand(code, build, plans);
  ok(d.ok && same(d.state.installed, keys) && same(d.state.cables, cables) && d.state.closed && same(d.state.style, { kind: 'custom', color: '#3ddc97' }), `${id}: full progress with routes, ports, closed panel and style round-trips (${code.length} chars)`);
  ok(/^[0-9a-zA-Z._-]+$/.test(code), `${id}: hand code is URL-safe`);

  // Through AssemblyProgress, as the builder restores it, and back.
  const ap = new AssemblyProgress({ storage: null });
  ap.sync(d.state.caseId, (k) => k);
  ap.fill(d.state);
  ap.setCableStyle(d.state.style);
  ok(encodeHand(build, ap, plans) === code, `${id}: AssemblyProgress restored from the link encodes to the same code`);

  // Damage: pieces without their support are dropped; bad flags or extras are refused.
  const noBoard = keys.filter((k) => !k.startsWith('motherboard:'));
  const d2 = decodeHand(encodeHand(build, { installed: noBoard, cables: {} }, plans), build, plans);
  ok(d2.ok && !d2.state.installed.some((k) => ['cpu', 'cooler', 'ram', 'm2', 'gpu'].includes(plans.aplan.pieces.get(k).stage)), `${id}: CPU, cooler, memory, M.2 and card are dropped when the board is missing (kept ${d2.state.installed.map((k) => plans.aplan.pieces.get(k).stage).join(', ')})`);
  ok(!decodeHand('9.abc.de.00', build, plans).ok && !decodeHand('1.abc.de.7z', build, plans).ok && !decodeHand('1.a!c.de.00', build, plans).ok && !decodeHand(`${code.split('.').slice(0, 4).join('.')}.%%%`, build, plans).ok, `${id}: damaged codes are refused`);
}
const noCase = decodeHand('1.f.f.00', { ...BUILDS[0].build, case: null });
ok(!noCase.ok && /case/.test(noCase.error), 'progress without a case in the build is refused');

// ---------------------------------------------------------------- CSV
console.log('CSV export');
const csvBuild = { ...BUILDS[0].build, ram: [BUILDS[0].build.ram[0], BUILDS[0].build.ram[0]] };
const csv = buildCSV(csvBuild, { name: 'Test, "quoted"', link: 'https://x/builder.html?b=1', date: '2026-11-12' });
const lines = csv.trimEnd().split('\r\n');
const header = lines[0].split(',');
ok(header.length === 10 && header[0] === 'Category' && header.at(-1) === 'Search this part' && /Reference price/.test(lines[0]), 'header row with reference prices and search links');
const ramLine = lines.find((l) => l.startsWith('Memory,'));
ok(/,2,/.test(ramLine), 'repeated parts fold into one row with qty 2');
const total = lines.find((l) => l.startsWith('Total,'));
ok(total.split(',')[5] === String(priceBuild(csvBuild).total), `total matches priceBuild (${priceBuild(csvBuild).total})`);
ok(lines.filter((l) => /https:\/\/www\.google\.com\/search\?tbm=shop/.test(l)).length === lines.filter((l) => /^(Processor|Motherboard|Memory|Graphics card|Storage|Power supply|Case|CPU cooler|Case fans),/.test(l)).length, 'every part row has its search link');
ok(lines.some((l) => l === '"Test, ""quoted"" · exported 2026-11-12 from Rigsmith"') && lines.some((l) => /reference price, not live/.test(l)) && lines.some((l) => /Share link: https:\/\/x\/builder/.test(l)), 'name quoted, price note and share link included');
const evil = buildCSV({ cpu: { ...catalog.list('cpu')[0], name: '=HYPERLINK("x")' } });
ok(evil.includes(`"'=HYPERLINK(""x"")"`), 'cells starting with = are defused');

// ---------------------------------------------------------------- QR
console.log('QR codes');
// Independent reader: GF tables, format/version BCH, unmask, zigzag, de-interleave, RS syndromes.
const EXP = new Array(512);
const LOG = new Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
const bchRem = (v, poly, deg) => { for (let i = 31 - Math.clz32(v); i >= deg; i--) if ((v >>> i) & 1) v ^= poly << (i - deg); return v; };
const MASK = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0];

function readQR(m) {
  const n = m.length;
  const v = (n - 17) / 4;
  const at = (x, y) => m[y][x];
  // Finder patterns: dark 7x7 ring, light ring, dark 3x3 centre.
  for (const [ox, oy] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
      const d = Math.max(Math.abs(x - 3), Math.abs(y - 3));
      if (at(ox + x, oy + y) !== (d !== 2)) throw new Error('finder pattern');
    }
  }
  for (let i = 8; i < n - 8; i++) if (at(i, 6) !== (i % 2 === 0) || at(6, i) !== (i % 2 === 0)) throw new Error('timing pattern');
  if (!at(8, n - 8)) throw new Error('dark module');
  let f1 = 0;
  const seq1 = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  seq1.forEach(([x, y], i) => { if (at(x, y)) f1 |= 1 << i; });
  let f2 = 0;
  for (let i = 0; i < 8; i++) if (at(n - 1 - i, 8)) f2 |= 1 << i;
  for (let i = 8; i < 15; i++) if (at(8, n - 15 + i)) f2 |= 1 << i;
  if (f1 !== f2) throw new Error('format copies differ');
  const fmt = f1 ^ 0x5412;
  if (bchRem(fmt, 0x537, 10) !== 0) throw new Error('format BCH');
  const ecl = ['M', 'L', 'H', 'Q'][fmt >>> 13];
  const mask = (fmt >>> 10) & 7;
  if (v >= 7) {
    let vb = 0;
    for (let i = 0; i < 18; i++) if (at(n - 11 + (i % 3), Math.floor(i / 3))) vb |= 1 << i;
    if (bchRem(vb, 0x1f25, 12) !== 0 || vb >>> 12 !== v) throw new Error('version BCH');
  }
  // Function modules (written out here, not taken from the encoder).
  const fn = Array.from({ length: n }, () => new Array(n).fill(false));
  const mark = (x0, y0, w, h) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) fn[y][x] = true; };
  mark(0, 0, 9, 9); mark(n - 8, 0, 8, 9); mark(0, n - 8, 9, 8);
  mark(6, 0, 1, n); mark(0, 6, n, 1);
  const al = alignmentPositions(v);
  const last = al.length - 1;
  al.forEach((ax, i) => al.forEach((ay, j) => { if (!((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0))) mark(ax - 2, ay - 2, 5, 5); }));
  if (v >= 7) { mark(n - 11, 0, 3, 6); mark(0, n - 11, 6, 3); }
  const bits = [];
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const up = ((right + 1) & 2) === 0;
    for (let i = 0; i < n; i++) {
      const y = up ? n - 1 - i : i;
      for (const x of [right, right - 1]) if (!fn[y][x]) bits.push(at(x, y) !== MASK[mask](x, y) ? 1 : 0);
    }
  }
  const { blocks: nb, ecc, raw } = blockInfo(v, ecl);
  const cw = [];
  for (let i = 0; i + 8 <= bits.length && cw.length < raw; i += 8) cw.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  const shortLen = Math.floor(raw / nb);
  const shortBlocks = nb - (raw % nb);
  const blocks = Array.from({ length: nb }, (_, j) => new Array(shortLen + (j < shortBlocks ? 0 : 1)));
  let k = 0;
  for (let i = 0; i < shortLen + 1; i++) {
    for (let j = 0; j < nb; j++) {
      const len = blocks[j].length;
      const dataLen = len - ecc;
      // Data part first (column i < dataLen), then ECC columns, as interleaved by the standard.
      if (i < shortLen - ecc + 1 && i < dataLen) blocks[j][i] = cw[k++];
    }
  }
  for (let i = 0; i < ecc; i++) for (let j = 0; j < nb; j++) blocks[j][blocks[j].length - ecc + i] = cw[k++];
  const data = [];
  for (const b of blocks) {
    for (let s = 0; s < ecc; s++) {
      let syn = 0;
      for (const c of b) syn = mul(syn, EXP[s]) ^ c;
      if (syn !== 0) throw new Error('Reed-Solomon syndrome');
    }
    data.push(...b.slice(0, b.length - ecc));
  }
  const dbits = data.flatMap((b) => [7, 6, 5, 4, 3, 2, 1, 0].map((i) => (b >> i) & 1));
  let p = 0;
  const take = (len) => { let x = 0; for (let i = 0; i < len; i++) x = (x << 1) | dbits[p++]; return x; };
  if (take(4) !== 0b0100) throw new Error('mode');
  const count = take(v < 10 ? 8 : 16);
  const bytes = [];
  for (let i = 0; i < count; i++) bytes.push(take(8));
  return { text: new TextDecoder().decode(new Uint8Array(bytes)), version: v, ecl, mask };
}

const longLink = shareUrl('https://rigsmith.netlify.app/', { code: code4k, hand: encodeHand(BUILDS[3].build, { installed: plansFor(BUILDS[3].build).aplan.groups.flatMap((g) => g.pieces), cables: Object.fromEntries(plansFor(BUILDS[3].build).cplan.items.map((i) => [i.id, { pts: [[1, 2, 3]], src: null, dst: null }])), closed: true, cableStyle: { kind: 'sleeved', color: '#ff5a1f' } }), name: 'Dual chamber' });
const samples = ['', 'A', 'HELLO WORLD', 'https://rigsmith.netlify.app/builder.html?b=1', link, cmp, longLink, 'ราคาอ้างอิง ไม่ใช่ราคาจริง', 'x'.repeat(300), 'y'.repeat(1200)];
const versions = new Set();
const masks = new Set();
for (const text of samples) {
  try {
    const q = qrMatrix(text);
    const r = readQR(q.modules);
    versions.add(r.version);
    masks.add(r.mask);
    ok(r.text === text && r.version === q.version && r.ecl === q.ecl && r.mask === q.mask, `QR v${q.version}-${q.ecl} mask ${q.mask} reads back (${text.length} chars)`);
  } catch (e) {
    ok(false, `QR for ${text.length} chars: ${e.message}`);
  }
}
ok(versions.size >= 5 && [...versions].some((v) => v >= 7) && [...versions].some((v) => v >= 10), `symbols tested across versions ${[...versions].sort((a, b) => a - b).join(', ')} (version info and 16-bit counts covered)`);
ok(masks.size >= 3, `mask selection varies (${[...masks].join(', ')})`);
ok(same(alignmentPositions(2), [6, 18]) && same(alignmentPositions(7), [6, 22, 38]) && same(alignmentPositions(32), [6, 34, 60, 86, 112, 138]) && same(alignmentPositions(40), [6, 30, 58, 86, 114, 142, 170]), 'alignment pattern positions match the standard table');
const svg = qrSvg(link, { label: 'Share link' });
ok(/^<svg [^>]*viewBox="0 0 \d+ \d+"[^>]*aria-label="Share link"/.test(svg) && svg.endsWith('</svg>'), 'SVG output with quiet zone and label');
let threw = false;
try { qrMatrix('z'.repeat(3000)); } catch { threw = true; }
ok(threw, 'text over the version 40 capacity throws');
console.log(`  share link ${link.length} chars; full hand-build link ${longLink.length} chars -> QR v${qrMatrix(longLink).version}`);

console.log(failures ? `FAILED: ${failures} of ${checks} checks` : `OK: ${checks} checks`);
process.exit(failures ? 1 : 0);
