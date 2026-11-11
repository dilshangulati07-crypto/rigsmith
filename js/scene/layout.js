// Physical layout of a build inside its case, from the real part data. Pure maths (no
// three.js) so tools/test-layout.mjs can check every case/board combination in Node.
//
// Axes (cm): +X = case front, +Y = up, +Z = side-panel (window) side.
// Origin: centre of the case footprint, y = 0 at the underside of the case body (feet below).
// A placement is { p: [x, y, z], ex: [..], ey: [..] }: where a model's local origin goes and
// which world directions its local +X and +Y point to (local +Z = ex × ey).
import { BOARD_DIMS, FORM_FACTORS, boardLayout, slotRowV, SLOT_ROWS } from './board-layout.js';
import {
  WALL, SIDE, FOOT, STANDOFF, PCB, X, Y, Z, neg, cross, clamp, r2, worldExtent, zFitIn,
  boxOf, hits, shellOf, boardPoint, boardBasis,
} from './layout-math.js';
import { layoutFans, layoutRadiator, explodeDir } from './layout-fans.js';
import { layoutCPU, layoutRAM, layoutGPU, layoutCooler, aioTubes } from './layout-board.js';

export { WALL, SIDE, FOOT, STANDOFF, PCB, cross, worldExtent };

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

  // Boards hang from the top standoffs, so every size shares one top edge. Cases that mount
  // the board with its I/O facing down (boardMount "io-down") stand it on the bottom edge instead.
  const ioDown = pcCase?.boardMount === 'io-down';
  const topGap = clamp((H - big.h) * 0.25, 1.2, 6);
  const boardTopY = ioDown ? H - WALL - 1 : H - WALL - topGap;
  const boardX0 = -D / 2 + WALL + 0.9;
  const boardZ = trayZ + STANDOFF + PCB; // front face of the PCB
  const frame = ioDown
    ? { o: [boardX0, WALL + 4, boardZ], U: Y, V: X }
    : { o: [boardX0, boardTopY, boardZ], U: X, V: neg(Y) };

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
  const io = ioDown ? null : { y0: boardTopY - (largest === 'ITX' ? 15.0 : 16.0), y1: boardTopY - 0.5, z0: trayZ + STANDOFF + PCB - 0.1, z1: trayZ + STANDOFF + PCB + 4.4 };

  // Rear exhaust beside the I/O cut-out, sized for the largest fan the mount takes.
  const rearSize = fanMounts.rear ? Math.max(...Object.keys(fanMounts.rear).map(Number)) / 10 : 0;
  const rearFan = rearSize
    ? { size: rearSize, y: boardTopY - rearSize / 2 + 0.6, z: zFitIn(W, rearSize, (io ? io.z1 : trayZ + 4.4) + 0.6 + rearSize / 2) }
    : null;

  // Rear PSU opening (ATX size): under the shroud, or on its side in a dual-chamber case.
  const zFull = (-W / 2 + WALL + W / 2 - SIDE) / 2;
  let psuOpening = null;
  if (ioDown) psuOpening = null;
  else if (shroud) psuOpening = { z0: zFull - 7.5, z1: zFull + 7.5, y0: WALL, y1: WALL + 8.6 };
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
    boardTopY, boardX0, ioDown, frame,
    fanMounts, frontReserve,
    shroud,
    grommets: !ioDown && grommetX < D / 2 - WALL - frontReserve - 1
      ? [0.2, 0.5, 0.8].map((t) => ({ x: grommetX, y: (shroud ? shroud.y1 : WALL) + 3 + t * (boardTopY - (shroud ? shroud.y1 : WALL) - 6) }))
      : [],
    // Rear-panel openings, in world coordinates.
    io, rearFan, psuOpening,
    driveBays: pcCase?.drivebays ?? null,
    // Expansion slot rows on the rear panel (ITX cases usually have 2-3 for thick cards).
    slots: ioDown ? [] : Array.from({ length: Math.min(SLOT_ROWS[largest] + (largest === 'ITX' ? 2 : 0), 8) }, (_, k) => boardTopY - slotRowV(largest, k))
      .filter((y) => y - 1 > WALL + 0.5),
    notes,
  };
}

// ---------------------------------------------------------------- whole build
// How far each part moves in the exploded view (cm at 100 %), along its `explode` direction.
const EXPLODE_DIST = { motherboard: 3, cpu: 9, cooler: 17, radiator: 9, ram: 12, gpu: 14, psu: 11, fans: 7, storage: 9, m2: 6 };

/**
 * Placement of every modelled part. Parts without a placement are listed in `notes`.
 * `items` is the flat list the scene uses: { category, index, unit, placement, explode, dist }
 * (unit = null for a whole model, else the index into the model's userData.units).
 */
export function layoutBuild(build) {
  const cl = caseLayout(build.case);
  const notes = [...cl.notes];
  const { D, W, H, trayZ } = cl;
  const zMain = (cl.mainZ[0] + cl.mainZ[1]) / 2;
  const f = cl.frame;

  // Motherboard
  let board = null;
  let bl = null;
  if (build.motherboard) {
    bl = boardLayout(build.motherboard);
    const c0 = boardPoint(f, 0, 0);
    const c1 = boardPoint(f, bl.w, bl.h);
    board = {
      layout: bl, ff: bl.ff, frame: f, z: f.o[2],
      placement: { p: c0.map(r2), ...boardBasis(f) },
      x0: Math.min(c0[0], c1[0]), x1: Math.max(c0[0], c1[0]), y0: Math.min(c0[1], c1[1]), y1: Math.max(c0[1], c1[1]),
    };
    if (build.case && !cl.formFactors.includes(bl.ff)) notes.push(`This case does not list ${bl.ff} boards: the board is drawn where it would sit.`);
    if (cl.ioDown) notes.push('This case mounts the board with its I/O facing down, so the graphics card stands upright in its slot.');
  }
  const boardFront = board ? board.x1 : cl.boardX0 + BOARD_DIMS[cl.largest].w;
  const boardBottom = board ? board.y0 : cl.boardTopY - BOARD_DIMS[cl.largest].h;

  // Parts on the board.
  const cpu = board && build.cpu ? layoutCPU(f, bl) : null;
  const ram = board ? layoutRAM(build.ram ?? [], f, bl, notes) : [];
  if (!board && build.ram?.length) notes.push('Memory appears once a motherboard is chosen.');
  const gpu = board && build.gpu ? layoutGPU(build.gpu, f, bl, cl, notes) : null;
  if (!board && build.gpu) notes.push('The graphics card appears once a motherboard is chosen.');
  let cooler = null;
  if (build.cooler && board) {
    cooler = layoutCooler(build.cooler, f, bl);
    if (cooler.kind === 'aio') {
      cooler.radiator = layoutRadiator(build.cooler, build.case, cl, boardFront, notes);
      cooler.tubes = cooler.radiator ? aioTubes(cooler, cooler.radiator, f) : [];
    }
  } else if (build.cooler) notes.push('The CPU cooler appears once a motherboard is chosen.');
  const rad = cooler?.radiator ?? null;
  const radBox = rad ? boxOf(rad.placement.p, rad.ext) : null;

  // Fans before drives: drives take whatever mount is still free. A radiator takes its position's mounts.
  const fans = layoutFans(build.fans ?? [], cl, boardFront, notes, new Set(rad ? [rad.mount] : []), [radBox, gpu?.box].filter(Boolean));

  // PSU. `overlap`: compact cases whose real layout (riser cards, sandwich boards) this model does not draw.
  let psu = null;
  let overlap = false;
  if (build.psu) {
    const dims = psuDims(build.psu);
    const size = [dims.len, dims.h, dims.w];
    const inX = [-D / 2 + WALL, D / 2 - WALL];
    const blockers = [gpu?.box, radBox].filter(Boolean);
    const regions = [];
    // Board-on-the-side cases: above the board, between the tray and a side-panel radiator.
    if (cl.ioDown && board) regions.push({ x0: inX[0], x1: gpu ? gpu.box.min[0] - 0.3 : board.x1, y0: board.y1 + 0.4, y1: H - WALL, z0: trayZ + 0.2, z1: radBox ? radBox.min[2] - 0.2 : W / 2 - SIDE, where: 'top' });
    if (cl.shroud) regions.push({ x0: inX[0], x1: cl.shroud.x1, y0: WALL, y1: cl.shroud.y1 - 0.3, z0: -W / 2 + WALL, z1: W / 2 - SIDE, where: 'shroud' });
    if (cl.dualChamber) regions.push({ x0: inX[0], x1: inX[1], y0: WALL, y1: H - WALL, z0: -W / 2 + WALL, z1: trayZ - 0.2, where: 'rear chamber' });
    regions.push({ x0: inX[0], x1: inX[1] - cl.frontReserve, y0: WALL, y1: Math.min(boardBottom, gpu ? gpu.box.min[1] : Infinity) - 0.4, z0: -W / 2 + WALL, z1: W / 2 - SIDE, where: 'bottom' });
    regions.push({ x0: Math.max(boardFront, gpu ? gpu.box.max[0] : -Infinity) + 0.8, x1: inX[1] - cl.frontReserve, y0: WALL, y1: H - WALL, z0: trayZ + 0.2, z1: W / 2 - SIDE, where: 'front' });
    let fit = null;
    const fanBoxes = fans.map((fn) => boxOf(fn.placement.p, worldExtent([fn.size, fn.size, fn.depth], fn.placement.ex, fn.placement.ey)));
    for (const avoid of [[...blockers, ...fanBoxes], []]) {
      for (const r of regions) {
        const tryFit = fitBox(size, r);
        if (tryFit && !avoid.some((b) => hits(b, boxOf(tryFit.p, tryFit.ext)))) {
          fit = tryFit;
          fit.where = r.where;
          break;
        }
      }
      if (fit) {
        if (!avoid.length && (blockers.length || fanBoxes.length)) overlap = true;
        break;
      }
    }
    if (!fit) {
      const ext = size;
      fit = { p: [inX[0] + ext[0] / 2, WALL + ext[1] / 2, 0], ex: X, ey: Y, ext, where: 'bottom' };
      notes.push('The PSU does not fit the free space in this case model: drawn at the bottom.');
      overlap = true;
    }
    psu = { dims, placement: { p: fit.p.map(r2), ex: fit.ex, ey: fit.ey }, ext: fit.ext, where: fit.where, bundle: psuBundle(fit, cl, boardFront) };
  }

  if (overlap) notes.push('Some parts overlap in this compact case model: the real case uses a layout it does not draw, such as a riser-mounted graphics card.');
  const storage = layoutStorage(build.storage ?? [], cl, board, psu, fans, boardFront, notes, [gpu?.box, radBox].filter(Boolean));

  // Flat placement list for the scene.
  const items = [];
  const item = (category, index, unit, placement, explode, dist = EXPLODE_DIST[category]) => items.push({ category, index, unit, placement, explode, dist });
  if (board) item('motherboard', 0, null, board.placement, Z);
  if (cpu) item('cpu', 0, null, cpu.placement, Z);
  if (gpu) item('gpu', 0, null, gpu.placement, gpu.explode);
  if (cooler) {
    item('cooler', 0, cooler.kind === 'aio' ? 0 : null, cooler.placement, Z);
    if (cooler.kind === 'aio') item('cooler', 0, 1, rad?.placement ?? null, rad?.explode ?? Z, EXPLODE_DIST.radiator);
  }
  for (const r of ram) item('ram', r.partIndex, r.unit, r.placement, Z);
  if (psu) item('psu', 0, null, psu.placement, Z);
  for (const fan of fans) item('fans', fan.partIndex, fan.unit, fan.placement, fan.explode);
  for (const s of storage) item('storage', s.index, null, s.placement, s.kind === 'm2' ? Z : Z, s.kind === 'm2' ? EXPLODE_DIST.m2 : EXPLODE_DIST.storage);

  return { case: cl, board, cpu, gpu, cooler, ram, psu, fans, storage, notes, zMain, items, overlap };
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

// ---------------------------------------------------------------- storage
function layoutStorage(drives, cl, board, psu, fans, boardFront, notes, blockers = []) {
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
  taken.push(...blockers);

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
      const f = board.frame;
      const p = boardPoint(f, slot.u, slot.v, slot.back ? -PCB - 0.2 : 0.35);
      out.push({ index, kind: 'm2', slot: m2Used - 1, back: !!slot.back, placement: { p: p.map(r2), ex: f.U, ey: slot.back ? f.V : neg(f.V) } });
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
