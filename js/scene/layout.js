// Physical layout of a build inside its case, from the real part data. Pure maths (no
// three.js) so tools/test-layout.mjs can check every case/board combination in Node.
//
// Axes (cm): +X = case front, +Y = up, +Z = side-panel (window) side.
// Origin: centre of the case footprint, y = 0 at the underside of the case body (feet below).
// A placement is { p: [x, y, z], ex: [..], ey: [..] }: where a model's local origin goes and
// which world directions its local +X and +Y point to (local +Z = ex × ey).
import { BOARD_DIMS, FORM_FACTORS, boardLayout, slotRowV, SLOT_ROWS } from './board-layout.js';

export const WALL = 0.3;     // steel panel thickness
export const SIDE = 0.4;     // side panel (tempered glass) thickness
export const FOOT = 1.2;     // feet height under the case body
export const STANDOFF = 0.6; // board standoff height
export const PCB = 0.16;     // board thickness

// Used when the data has no dimensions (and for the empty-state ghost): depth, width, height in cm.
const TYPICAL_DIMS = {
  'full-tower': [55, 24, 58],
  'mid-tower': [46, 23, 47],
  matx: [41, 21, 40],
  itx: [34, 18, 30],
};
// Used when the data has no fan mount list.
const TYPICAL_FANS = {
  'full-tower': { front: { 120: 3, 140: 3 }, top: { 120: 3, 140: 2 }, rear: { 120: 1 } },
  'mid-tower': { front: { 120: 3, 140: 2 }, top: { 120: 2, 140: 2 }, rear: { 120: 1 } },
  matx: { front: { 120: 2 }, top: { 120: 2 }, rear: { 120: 1 } },
  itx: { top: { 120: 2 } },
};

// PSU outer sizes (cm): length (x), height (y), width (z). The data has no PSU length, so
// ATX units use the usual length for their wattage class.
export function psuDims(psu) {
  const ff = psu?.formFactor ?? 'ATX';
  if (ff === 'SFX') return { ff, len: 10, h: 6.35, w: 12.5 };
  if (ff === 'SFX-L') return { ff, len: 13, h: 6.35, w: 12.5 };
  const watt = psu?.wattage ?? 750;
  return { ff: 'ATX', len: watt > 1000 ? 18 : watt > 750 ? 16 : 14, h: 8.6, w: 15 };
}

// Drive sizes (cm): long side (x), short side (y), thickness (z).
export const DRIVE_DIMS = {
  'M.2 2280': [8.0, 2.2, 0.24],
  '2.5in': [10.0, 6.985, 0.7],
  '3.5in': [14.7, 10.16, 2.61],
};

// ---------------------------------------------------------------- vectors
const X = [1, 0, 0]; const Y = [0, 1, 0]; const Z = [0, 0, 1];
const neg = (a) => a.map((v) => -v || 0);
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r2 = (v) => Math.round(v * 100) / 100;

/** World-space size of a box with local `size` [x,y,z] placed with basis ex, ey. */
export function worldExtent(size, ex, ey) {
  const ez = cross(ex, ey);
  return [0, 1, 2].map((a) => Math.abs(ex[a]) * size[0] + Math.abs(ey[a]) * size[1] + Math.abs(ez[a]) * size[2]);
}

// Basis with local +Z along `normal` (fans: the airflow side), local +Y as close to `up` as possible.
function basisFromNormal(normal, up = Y) {
  const ex = cross(up, normal);
  return { ex, ey: cross(normal, ex) };
}

const PERMUTATIONS = [
  { ex: X, ey: Y }, { ex: X, ey: Z }, { ex: Y, ey: neg(X) }, { ex: Y, ey: Z }, { ex: Z, ey: Y }, { ex: Z, ey: X },
];

// First orientation of a box of `size` that fits `region`, anchored at the region's rear-bottom
// corner and centred in z. Returns { p, ex, ey, ext } or null.
function fitBox(size, region) {
  for (const o of PERMUTATIONS) {
    const ext = worldExtent(size, o.ex, o.ey);
    const room = [region.x1 - region.x0, region.y1 - region.y0, region.z1 - region.z0];
    if (ext.every((e, a) => e <= room[a] + 1e-6)) {
      return { p: [region.x0 + ext[0] / 2, region.y0 + ext[1] / 2, (region.z0 + region.z1) / 2], ex: o.ex, ey: o.ey, ext };
    }
  }
  return null;
}

// Centre z of a `size` fan near `z`, kept inside the case width.
function zFitIn(W, size, z) {
  const lo = -W / 2 + WALL + size / 2;
  const hi = W / 2 - SIDE - size / 2;
  return lo > hi ? (lo + hi) / 2 : clamp(z, lo, hi);
}

// ---------------------------------------------------------------- case
/** Everything about the case that does not depend on the other parts. */
export function caseLayout(pcCase) {
  const notes = [];
  const type = TYPICAL_DIMS[pcCase?.caseType] ? pcCase.caseType : 'mid-tower';
  const d = pcCase?.dimensionsMM;
  const known = d && d.depth && d.width && d.height;
  const [D, W, H] = known ? [d.depth / 10, d.width / 10, d.height / 10] : TYPICAL_DIMS[type];
  if (pcCase && !known) notes.push(`Case size is not in the data: drawn at a typical ${type.replace('-', ' ')} size.`);

  const formFactors = (pcCase?.formFactorsSupported?.length ? pcCase.formFactorsSupported : ['ATX', 'mATX', 'ITX'])
    .filter((f) => BOARD_DIMS[f]);
  const largest = FORM_FACTORS.find((f) => formFactors.includes(f)) ?? 'ATX';
  const big = BOARD_DIMS[largest];

  // Window-to-tray depth: room for the tallest cooler the case takes, leaving cable space behind the tray.
  const inner = W - WALL - SIDE;
  const cooler = pcCase?.maxCoolerHeightMM ? pcCase.maxCoolerHeightMM / 10 : null;
  const main = clamp(cooler ? cooler + STANDOFF + PCB + 1.0 : inner - 2.5, Math.min(inner, 8), inner - 1.5);
  const trayZ = W / 2 - SIDE - main;
  const rearSpace = trayZ - (-W / 2 + WALL);
  const dualChamber = rearSpace >= 8.5;

  // Boards hang from the top standoffs, so every size shares one top edge.
  const topGap = clamp((H - big.h) * 0.25, 1.2, 6);
  const boardTopY = H - WALL - topGap;
  const boardX0 = -D / 2 + WALL + 0.9;

  let fanMounts = pcCase?.fanMounts;
  if (!fanMounts) {
    fanMounts = TYPICAL_FANS[type];
    if (pcCase) notes.push('Fan mounts are not in the data: a typical layout is used.');
  }
  const frontReserve = fanMounts.front ? 3.6 : 0.6;

  // PSU shroud: towers with a bottom ATX PSU and room under the largest board.
  const psuFFs = pcCase?.psuFormFactors;
  const largestBottom = boardTopY - big.h;
  const shroudTop = Math.min(largestBottom - 0.3, WALL + 8.6 + 1.4);
  const shroud = !dualChamber && type !== 'itx' && (!psuFFs || psuFFs.includes('ATX')) && shroudTop - WALL >= 9.2
    ? { x0: -D / 2 + WALL, x1: D / 2 - WALL - frontReserve, y1: shroudTop, z0: trayZ, z1: W / 2 - SIDE }
    : null;

  const top = !!(fanMounts.top || pcCase?.radiatorSupport?.some((r) => r.position === 'top'));
  const grommetX = boardX0 + big.w + 1.4;
  const io = { y0: boardTopY - (largest === 'ITX' ? 15.0 : 16.0), y1: boardTopY - 0.5, z0: trayZ + STANDOFF + PCB - 0.1, z1: trayZ + STANDOFF + PCB + 4.4 };

  // Rear exhaust beside the I/O cut-out, sized for the largest fan the mount takes.
  const rearSize = fanMounts.rear ? Math.max(...Object.keys(fanMounts.rear).map(Number)) / 10 : 0;
  const rearFan = rearSize
    ? { size: rearSize, y: boardTopY - rearSize / 2 + 0.6, z: zFitIn(W, rearSize, io.z1 + 0.6 + rearSize / 2) }
    : null;

  // Rear PSU opening (ATX size): under the shroud, or on its side in a dual-chamber case.
  const zFull = (-W / 2 + WALL + W / 2 - SIDE) / 2;
  let psuOpening = null;
  if (shroud) psuOpening = { z0: zFull - 7.5, z1: zFull + 7.5, y0: WALL, y1: WALL + 8.6 };
  else if (dualChamber) {
    const zc = (-W / 2 + WALL + trayZ - 0.2) / 2;
    psuOpening = { z0: zc - 4.3, z1: zc + 4.3, y0: WALL, y1: WALL + 15 };
  }

  return {
    type, D, W, H, generic: !known, ghost: !pcCase,
    sidePanel: pcCase?.sidePanel ?? 'glass',
    frontPanel: pcCase?.frontPanel ?? null,
    topVented: top,
    formFactors, largest,
    trayZ, rearSpace, dualChamber, mainZ: [trayZ, W / 2 - SIDE],
    boardTopY, boardX0,
    fanMounts, frontReserve,
    shroud,
    grommets: grommetX < D / 2 - WALL - frontReserve - 1
      ? [0.2, 0.5, 0.8].map((t) => ({ x: grommetX, y: (shroud ? shroud.y1 : WALL) + 3 + t * (boardTopY - (shroud ? shroud.y1 : WALL) - 6) }))
      : [],
    // Rear-panel openings, in world coordinates.
    io, rearFan, psuOpening,
    driveBays: pcCase?.drivebays ?? null,
    slots: Array.from({ length: Math.min(SLOT_ROWS[largest] + (largest === 'ITX' ? 1 : 0), 8) }, (_, k) => boardTopY - slotRowV(largest, k)),
    notes,
  };
}

// ---------------------------------------------------------------- whole build
/** Placement of every modelled part. Parts without a placement are listed in `notes`. */
export function layoutBuild(build) {
  const cl = caseLayout(build.case);
  const notes = [...cl.notes];
  const { D, W, H, trayZ } = cl;
  const zMain = (cl.mainZ[0] + cl.mainZ[1]) / 2;

  // Motherboard
  let board = null;
  if (build.motherboard) {
    const bl = boardLayout(build.motherboard);
    const z = trayZ + STANDOFF + PCB; // front face of the PCB
    board = { layout: bl, ff: bl.ff, placement: { p: [cl.boardX0, cl.boardTopY, z], ex: X, ey: Y }, x0: cl.boardX0, x1: cl.boardX0 + bl.w, y0: cl.boardTopY - bl.h, y1: cl.boardTopY, z };
    if (build.case && !cl.formFactors.includes(bl.ff)) notes.push(`This case does not list ${bl.ff} boards: the board is drawn where it would sit.`);
  }
  const boardFront = board ? board.x1 : cl.boardX0 + BOARD_DIMS[cl.largest].w;
  const boardBottom = board ? board.y0 : cl.boardTopY - BOARD_DIMS[cl.largest].h;

  // Fans before drives: drives take whatever mount is still free.
  const fans = layoutFans(build.fans ?? [], cl, boardFront, notes);

  // PSU
  let psu = null;
  if (build.psu) {
    const dims = psuDims(build.psu);
    const size = [dims.len, dims.h, dims.w];
    const inX = [-D / 2 + WALL, D / 2 - WALL];
    const regions = [];
    if (cl.shroud) regions.push({ x0: inX[0], x1: cl.shroud.x1, y0: WALL, y1: cl.shroud.y1 - 0.3, z0: -W / 2 + WALL, z1: W / 2 - SIDE, where: 'shroud' });
    if (cl.dualChamber) regions.push({ x0: inX[0], x1: inX[1], y0: WALL, y1: H - WALL, z0: -W / 2 + WALL, z1: trayZ - 0.2, where: 'rear chamber' });
    regions.push({ x0: inX[0], x1: inX[1] - cl.frontReserve, y0: WALL, y1: boardBottom - 0.4, z0: -W / 2 + WALL, z1: W / 2 - SIDE, where: 'bottom' });
    regions.push({ x0: boardFront + 0.8, x1: inX[1] - cl.frontReserve, y0: WALL, y1: H - WALL, z0: trayZ + 0.2, z1: W / 2 - SIDE, where: 'front' });
    let fit = null;
    for (const r of regions) {
      fit = fitBox(size, r);
      if (fit) { fit.where = r.where; break; }
    }
    if (!fit) {
      const ext = size;
      fit = { p: [inX[0] + ext[0] / 2, WALL + ext[1] / 2, 0], ex: X, ey: Y, ext, where: 'bottom' };
      notes.push('The PSU does not fit the free space in this case model: drawn at the bottom.');
    }
    psu = { dims, placement: { p: fit.p.map(r2), ex: fit.ex, ey: fit.ey }, ext: fit.ext, where: fit.where, bundle: psuBundle(fit, cl, boardFront) };
  }

  const storage = layoutStorage(build.storage ?? [], cl, board, psu, fans, boardFront, notes);

  return { case: cl, board, psu, fans, storage, notes, zMain };
}

// Cable bundle from the PSU's inside face to the lowest grommet, behind the tray.
function psuBundle(fit, cl, boardFront) {
  const [x, y, z] = fit.p;
  const half = fit.ext[0] / 2;
  const start = [x + half, y, z];
  const behind = cl.rearSpace > 1.2 ? cl.trayZ - Math.min(1.0, cl.rearSpace / 2) : cl.trayZ + 1.2;
  const gx = cl.grommets[0]?.x ?? Math.min(boardFront + 1.4, cl.D / 2 - 2);
  const gy = cl.grommets[0]?.y ?? y + 8;
  return [start, [start[0] + 2.5, y, z], [Math.min(gx, start[0] + 6), y + 2, behind], [gx, Math.max(y + 4, gy - 4), behind], [gx, gy, behind]].map((p) => p.map(r2));
}

// ---------------------------------------------------------------- fans
// Mount rail per position: where fan i of a given size goes, and which way it blows.
function fanRail(pos, cl, boardFront, size, t) {
  const { D, W, H, trayZ } = cl;
  const zFull = (-W / 2 + WALL + W / 2 - SIDE) / 2;
  const zMain = (cl.mainZ[0] + cl.mainZ[1]) / 2;
  const zFit = (z) => zFitIn(W, size, z);
  const railLen = (mounts) => Math.max(...Object.entries(mounts).map(([s, n]) => Number(s) / 10 * n));
  const len = railLen(cl.fanMounts[pos]);
  const floorY = cl.shroud ? cl.shroud.y1 : WALL;

  switch (pos) {
    case 'front': {
      const top = Math.min(H - WALL - 0.5, H / 2 + len / 2);
      return (i) => ({ p: [D / 2 - WALL - 0.9 - t / 2, top - size / 2 - i * size, zFit(zFull)], normal: [-1, 0, 0] });
    }
    case 'rear': {
      const { y, z } = cl.rearFan;
      return (i) => ({ p: [-D / 2 + WALL + t / 2 + 0.1, y - i * size, z], normal: [-1, 0, 0] });
    }
    case 'top': {
      const x0 = cl.boardX0 + 2; const x1 = D / 2 - WALL - cl.frontReserve - 0.5;
      const start = Math.max(x0, (x0 + x1) / 2 - len / 2);
      return (i) => ({ p: [start + size / 2 + i * size, H - WALL - t / 2 - 0.2, zFit(zMain)], normal: [0, 1, 0] });
    }
    case 'bottom': {
      const x0 = -D / 2 + WALL + 1; const x1 = D / 2 - WALL - cl.frontReserve - 0.5;
      const start = Math.max(x0, (x0 + x1) / 2 - len / 2);
      return (i) => ({ p: [start + size / 2 + i * size, WALL + t / 2 + 0.3, zFit(zMain)], normal: [0, 1, 0] });
    }
    case 'side': {
      // On the tray in front of the board, blowing toward the window; if there's no room, at the front.
      if (boardFront + 0.8 + size <= D / 2 - WALL - 0.6) {
        const x = Math.max(boardFront + 0.8 + size / 2, D / 2 - WALL - 0.8 - size / 2);
        return (i) => ({ p: [x, cl.boardTopY - size / 2 - i * size, trayZ + t / 2 + 0.3], normal: [0, 0, 1] });
      }
      const top = Math.min(H - WALL - 0.5, H / 2 + len / 2);
      return (i) => ({ p: [D / 2 - WALL - 0.9 - t / 2, top - size / 2 - i * size, zFit(zFull)], normal: [-1, 0, 0] });
    }
    case 'shroud': {
      const x1 = (cl.shroud?.x1 ?? D / 2 - WALL - cl.frontReserve) - 1;
      return (i) => ({ p: [x1 - size / 2 - i * size, floorY + t / 2 + 0.1, zFit(zMain)], normal: [0, 1, 0] });
    }
    default: return null;
  }
}

const PACK_ORDER = ['front', 'top', 'side', 'bottom', 'rear', 'shroud'];
const SINGLE_ORDER = ['rear', 'front', 'top', 'side', 'bottom', 'shroud'];

function layoutFans(fanParts, cl, boardFront, notes) {
  const out = [];
  const used = {}; // position -> { count, len }
  const bottomTaken = !cl.shroud && !cl.dualChamber; // the PSU sits on the floor
  let unplaced = 0;

  const capacity = (pos, sizeMM) => {
    const m = cl.fanMounts[pos];
    if (!m || !m[sizeMM]) return 0;
    if (pos === 'bottom' && bottomTaken) return 0;
    if (pos === 'shroud' && !cl.shroud) return 0;
    const u = used[pos] ?? { count: 0, len: 0 };
    const railLen = Math.max(...Object.entries(m).map(([s, n]) => Number(s) * n));
    return Math.max(0, Math.min(m[sizeMM] - u.count, Math.floor((railLen - u.len) / sizeMM + 1e-6)));
  };

  fanParts.forEach((part, partIndex) => {
    const n = part.packCount ?? 1;
    const sizeMM = part.sizeMM ?? 120;
    const size = sizeMM / 10;
    const t = (part.thicknessMM ?? 25) / 10;
    const order = n > 1 ? PACK_ORDER : SINGLE_ORDER;
    // Keep a pack together if one position takes it all; otherwise spread it.
    const whole = order.find((pos) => capacity(pos, sizeMM) >= n);
    const plan = whole ? [whole] : order;
    let unit = 0;
    for (const pos of plan) {
      let free = capacity(pos, sizeMM);
      const rail = free ? fanRail(pos, cl, boardFront, size, t) : null;
      while (free > 0 && unit < n && rail) {
        const u = used[pos] ?? (used[pos] = { count: 0, len: 0 });
        const slot = rail(u.count);
        const { ex, ey } = basisFromNormal(slot.normal);
        out.push({ partIndex, unit, mount: pos, size, depth: t, placement: { p: slot.p.map(r2), ex, ey } });
        u.count++;
        u.len += sizeMM;
        unit++;
        free--;
      }
      if (unit >= n) break;
    }
    unplaced += n - unit;
  });
  if (unplaced) notes.push(`${unplaced} fan${unplaced > 1 ? 's have' : ' has'} no free mount in this case and ${unplaced > 1 ? 'are' : 'is'} not drawn.`);
  return out;
}

// ---------------------------------------------------------------- storage
const boxOf = (p, ext) => ({ min: p.map((v, a) => v - ext[a] / 2), max: p.map((v, a) => v + ext[a] / 2) });
const hits = (a, b) => [0, 1, 2].every((i) => a.min[i] < b.max[i] - 0.05 && b.min[i] < a.max[i] - 0.05);

function layoutStorage(drives, cl, board, psu, fans, boardFront, notes) {
  const { D, W, H, trayZ } = cl;
  const out = [];
  const zMain = (cl.mainZ[0] + cl.mainZ[1]) / 2;
  const zFull = (-W / 2 + WALL + W / 2 - SIDE) / 2;
  const shell = { min: [-D / 2 + WALL, WALL, -W / 2 + WALL], max: [D / 2 - WALL, H - WALL, W / 2 - SIDE] };

  // Everything a drive must not sit in: board (with room for its parts), PSU, fans, other drives.
  const taken = [];
  if (board) taken.push({ min: [board.x0, board.y0, trayZ], max: [board.x1, board.y1, board.z + 4] });
  if (psu) taken.push(boxOf(psu.placement.p, psu.ext));
  for (const f of fans) taken.push(boxOf(f.placement.p, worldExtent([f.size, f.size, f.depth], f.placement.ex, f.placement.ey)));

  // Candidate mounts, best first. 2.5in: tray face in front of the board, shroud top, behind the tray.
  const spots25 = [];
  const floorY = cl.shroud ? cl.shroud.y1 : WALL;
  const trayX0 = (cl.grommets[0]?.x ?? boardFront) + 1.6;
  for (let y = cl.boardTopY - 0.5; y - 10.6 >= floorY + 0.5; y -= 11.4) spots25.push({ p: [trayX0 + 3.8, y - 5.3, trayZ + 0.55], ex: Y, ey: neg(X) });
  if (cl.shroud) {
    for (let x = cl.shroud.x1 - 0.8, n = 0; n < 2; x -= 11.4, n++) spots25.push({ p: [x - 5.3, cl.shroud.y1 + 0.5, zMain], ex: X, ey: neg(Z) });
  }
  if (cl.rearSpace >= 1.2) {
    for (let y = H - WALL - 1; y - 10.6 >= WALL + 1; y -= 11.4) spots25.push({ p: [cl.boardX0 + 8, y - 5.3, trayZ - 0.5], ex: Y, ey: X });
  }
  // 3.5in: a cage under the shroud's front end (or on the floor at the front); dual-chamber cases behind the tray.
  const spots35 = [];
  const cageX = (cl.shroud ? cl.shroud.x1 : D / 2 - WALL - cl.frontReserve) - 5.6;
  const cageTop = cl.shroud ? cl.shroud.y1 - 0.4 : H / 2;
  for (let y = WALL + 0.4; y + 2.8 <= cageTop; y += 3.2) spots35.push({ p: [cageX, y + 1.3, zFull], ex: Z, ey: X });
  if (cl.dualChamber) {
    // Dual-chamber cases keep drives behind the tray: try those spots first.
    const rear = [];
    for (let y = H - WALL - 1; y - 10.4 >= WALL + 1; y -= 11) rear.push({ p: [D / 2 - WALL - 8.5, y - 5.1, trayZ - 1.6], ex: X, ey: Y });
    spots35.unshift(...rear);
  }

  const bays = cl.driveBays; // null = unknown, so no limit
  const used = { '2.5in': 0, '3.5in': 0 };
  let m2Used = 0;
  let m2Missing = 0;
  let noBoard = 0;
  const take = (spots, size) => {
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      const b = boxOf(s.p, worldExtent(size, s.ex, s.ey));
      if (![0, 1, 2].every((a) => b.min[a] >= shell.min[a] - 0.05 && b.max[a] <= shell.max[a] + 0.05)) continue;
      if (taken.some((t) => hits(t, b))) continue;
      spots.splice(i, 1);
      taken.push(b);
      return s;
    }
    return null;
  };

  drives.forEach((part, index) => {
    const ff = part.formFactor;
    if (ff === 'M.2 2280') {
      if (!board) { noBoard++; return; }
      const slot = board.layout.m2[m2Used];
      if (!slot) { m2Missing++; return; }
      m2Used++;
      const z = slot.back ? board.z - PCB - 0.2 : board.z + 0.35;
      out.push({ index, kind: 'm2', slot: m2Used - 1, back: !!slot.back, placement: { p: [board.x0 + slot.u, board.y1 - slot.v, z].map(r2), ex: X, ey: slot.back ? neg(Y) : Y } });
      return;
    }
    const size = DRIVE_DIMS[ff];
    // 3.5in bays usually take 2.5in drives too.
    const limit = (k) => (bays?.[k] ?? Infinity);
    let spot = null;
    if (ff === '3.5in' && used['3.5in'] < limit('3.5')) spot = take(spots35, size);
    if (ff === '2.5in' && used['2.5in'] < limit('2.5')) spot = take(spots25, size) ?? take(spots35, size);
    if (!size || !spot) {
      out.push({ index, kind: ff, placement: null });
      notes.push(`${part.name}: no free ${ff} mount in this case, not drawn.`);
      return;
    }
    used[ff]++;
    out.push({ index, kind: ff, placement: { p: spot.p.map(r2), ex: spot.ex, ey: spot.ey } });
  });
  if (m2Missing) notes.push(`${m2Missing} M.2 drive${m2Missing > 1 ? 's have' : ' has'} no free M.2 slot on this board and ${m2Missing > 1 ? 'are' : 'is'} not drawn.`);
  if (noBoard) notes.push('M.2 drives appear once a motherboard is chosen.');
  return out;
}
