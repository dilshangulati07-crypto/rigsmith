// QR code encoder (ISO/IEC 18004), no dependencies: byte mode, error correction level M
// (L when the text is too long for M), versions 1-40, automatic mask choice. Used for the
// share link on the printed spec sheet. tools/test-share.mjs reads the symbols back.
//
// qrMatrix(text) -> { version, ecl, mask, size, modules: boolean[][] (row-major, true = dark) }
// qrSvg(text, { border }) -> '<svg ...>' string (one path, scales without blur)

const ECL = { L: { bits: 1, i: 0 }, M: { bits: 0, i: 1 } };
// Per version 1-40 (index 0 unused): ECC codewords per block, and number of blocks, for L and M.
const ECC_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
];
const BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
];

const bit = (x, i) => ((x >>> i) & 1) !== 0;

// ---------------------------------------------------------------- GF(256) and Reed-Solomon
export function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}
function rsDivisor(degree) {
  const r = new Array(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 2);
  }
  return r;
}
function rsRemainder(data, divisor) {
  const r = new Array(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ r.shift();
    r.push(0);
    divisor.forEach((c, i) => { r[i] ^= gfMul(c, factor); });
  }
  return r;
}

// ---------------------------------------------------------------- layout
export const sizeOf = (version) => version * 4 + 17;

export function alignmentPositions(version) {
  if (version === 1) return [];
  const n = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (n * 2 - 2)) * 2;
  const out = [6];
  for (let pos = sizeOf(version) - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

function rawDataModules(version) {
  let r = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const n = Math.floor(version / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (version >= 7) r -= 36;
  }
  return r;
}
export const dataCodewords = (version, ecl) => Math.floor(rawDataModules(version) / 8) - ECC_PER_BLOCK[ECL[ecl].i][version] * BLOCKS[ECL[ecl].i][version];
export const blockInfo = (version, ecl) => ({ blocks: BLOCKS[ECL[ecl].i][version], ecc: ECC_PER_BLOCK[ECL[ecl].i][version], raw: Math.floor(rawDataModules(version) / 8) });

/** Format information bits (15) for an error correction level and mask. */
export function formatBits(ecl, mask) {
  const data = (ECL[ecl].bits << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function versionBits(version) {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

/** Function patterns for a version: { modules, fn } where fn marks every non-data module. */
export function functionPatterns(version, ecl = 'M', mask = 0) {
  const size = sizeOf(version);
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { modules[y][x] = dark; fn[y][x] = true; };

  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
    }
  }
  const al = alignmentPositions(version);
  const last = al.length - 1;
  al.forEach((ax, i) => al.forEach((ay, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));

  const f = formatBits(ecl, mask);
  for (let i = 0; i <= 5; i++) set(8, i, bit(f, i));
  set(8, 7, bit(f, 6));
  set(8, 8, bit(f, 7));
  set(7, 8, bit(f, 8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(f, i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(f, i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(f, i));
  set(8, size - 8, true); // the dark module

  if (version >= 7) {
    const v = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, bit(v, i));
      set(b, a, bit(v, i));
    }
  }
  return { size, modules, fn };
}

export const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** Data module positions in placement order (two-column zigzag from the bottom right). */
export function dataPositions(fn) {
  const size = fn.length;
  const out = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!fn[y][x]) out.push([x, y]);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- encode
function utf8(text) {
  return typeof TextEncoder !== 'undefined' ? [...new TextEncoder().encode(text)] : [...Buffer.from(text, 'utf8')];
}

function codewords(bytes, version, ecl) {
  const cap = dataCodewords(version, ecl) * 8;
  const bits = [];
  const push = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, cap - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // Split into blocks, add Reed-Solomon ECC to each, interleave.
  const { blocks: nb, ecc, raw } = blockInfo(version, ecl);
  const shortBlocks = nb - (raw % nb);
  const shortLen = Math.floor(raw / nb);
  const div = rsDivisor(ecc);
  const blocks = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const dat = data.slice(k, k + shortLen - ecc + (i < shortBlocks ? 0 : 1));
    k += dat.length;
    const e = rsRemainder(dat, div);
    if (i < shortBlocks) dat.push(0);
    blocks.push(dat.concat(e));
  }
  const out = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((b, j) => { if (i !== shortLen - ecc || j >= shortBlocks) out.push(b[i]); });
  }
  return out;
}

function penalty(m) {
  const n = m.length;
  let p = 0;
  const lines = [];
  for (let i = 0; i < n; i++) {
    lines.push(m[i]);
    lines.push(m.map((row) => row[i]));
  }
  const finder = [true, false, true, true, true, false, true];
  for (const l of lines) {
    let run = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && l[i] === l[i - 1]) run++;
      else { if (run >= 5) p += 3 + run - 5; run = 1; }
    }
    // 1:1:3:1:1 finder-like pattern with four light modules on one side.
    for (let i = 0; i + 7 <= n; i++) {
      if (!finder.every((v, k) => l[i + k] === v)) continue;
      const before = i >= 4 && [1, 2, 3, 4].every((k) => !l[i - k]);
      const after = i + 11 <= n && [7, 8, 9, 10].every((k) => !l[i + k]);
      if (before || after) p += 40;
    }
  }
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
    const c = m[y][x];
    if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
  }
  let dark = 0;
  for (const row of m) for (const v of row) if (v) dark++;
  const total = n * n;
  p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return p;
}

export function qrMatrix(text) {
  const bytes = utf8(String(text));
  let version = 0;
  let ecl = 'M';
  for (const level of ['M', 'L']) {
    for (let v = 1; v <= 40; v++) {
      const countBits = v < 10 ? 8 : 16;
      if (4 + countBits + bytes.length * 8 <= dataCodewords(v, level) * 8) { version = v; break; }
    }
    if (version) { ecl = level; break; }
  }
  if (!version) throw new Error('Text too long for a QR code');
  const cw = codewords(bytes, version, ecl);
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const { size, modules, fn } = functionPatterns(version, ecl, mask);
    dataPositions(fn).forEach(([x, y], i) => {
      const v = i < cw.length * 8 ? bit(cw[i >>> 3], 7 - (i & 7)) : false;
      modules[y][x] = v !== MASKS[mask](x, y);
    });
    const score = penalty(modules);
    if (!best || score < best.score) best = { version, ecl, mask, size, modules, score };
  }
  delete best.score;
  return best;
}

export function qrSvg(text, { border = 4, label = 'QR code' } = {}) {
  const { size, modules } = qrMatrix(text);
  const dim = size + border * 2;
  let d = '';
  modules.forEach((row, y) => row.forEach((v, x) => { if (v) d += `M${x + border},${y + border}h1v1h-1z`; }));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" role="img" aria-label="${esc(label)}"><rect width="${dim}" height="${dim}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
