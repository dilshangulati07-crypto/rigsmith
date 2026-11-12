// Case fans and AIO radiators: mount rails per position, packing, and the radiator stack.
// Pure maths (no three.js); used by layout.js.
import { WALL, SIDE, X, Y, Z, neg, add, clamp, r2, worldExtent, basisFromNormal, zFitIn, shellOf, boxOf, hits } from './layout-math.js';

// Panel side of each mount (radiators sit against it) and the direction parts move in the exploded view.
const OUTWARD = { front: X, top: Y, rear: neg(X), bottom: neg(Y), side: neg(Z), shroud: neg(Y) };
const EXPLODE = { front: X, top: Y, rear: neg(X), bottom: Z, side: Z, shroud: Z };
export const explodeDir = (pos) => EXPLODE[pos] ?? Z;

const railLenOf = (mounts) => (mounts ? Math.max(...Object.entries(mounts).map(([s, n]) => Number(s) / 10 * n)) : 0);

/**
 * Mount rail per position: where fan i of a given size goes, and which way it blows.
 * `len` = rail length in cm (defaults to the case's fan mounts at that position).
 */
export function fanRail(pos, cl, boardFront, size, t, len = railLenOf(cl.fanMounts[pos])) {
  const { D, W, H, trayZ } = cl;
  const zFull = (-W / 2 + WALL + W / 2 - SIDE) / 2;
  const zMain = (cl.mainZ[0] + cl.mainZ[1]) / 2;
  const zFit = (z) => zFitIn(W, size, z);
  const floorY = cl.shroud ? cl.shroud.y1 : WALL;
  const frontRail = () => {
    const top = Math.min(H - WALL - 0.5, H / 2 + len / 2);
    return (i) => ({ p: [D / 2 - WALL - 0.9 - t / 2, top - size / 2 - i * size, zFit(zFull)], normal: [-1, 0, 0] });
  };

  switch (pos) {
    case 'front': return frontRail();
    case 'rear': {
      if (!cl.rearFan) return null;
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
      // Board-on-the-side cases: on the opposite side panel, blowing at the board.
      if (cl.ioDown) {
        const top = Math.min(H - WALL - 0.5, H / 2 + len / 2);
        return (i) => ({ p: [0, top - size / 2 - i * size, W / 2 - SIDE - 0.3 - t / 2], normal: [0, 0, -1] });
      }
      // On the tray in front of the board, blowing toward the window; if there's no room, at the front.
      if (boardFront + 0.8 + size <= D / 2 - WALL - 0.6) {
        const x = Math.max(boardFront + 0.8 + size / 2, D / 2 - WALL - 0.8 - size / 2);
        return (i) => ({ p: [x, cl.boardTopY - size / 2 - i * size, trayZ + t / 2 + 0.3], normal: [0, 0, 1] });
      }
      return frontRail();
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

/**
 * @param reserved positions taken by a radiator
 * @param blockers boxes fans must not sit in (radiator stack, graphics card)
 */
export function layoutFans(fanParts, cl, boardFront, notes, reserved = new Set(), blockers = []) {
  const out = [];
  const used = {}; // position -> { count, len }
  const shell = shellOf(cl);
  // The floor holds the PSU (or the shroud does) unless the PSU lives behind the tray.
  const bottomTaken = !cl.dualChamber;
  let unplaced = 0;

  const capacity = (pos, sizeMM) => {
    const m = cl.fanMounts[pos];
    if (!m || !m[sizeMM] || reserved.has(pos)) return 0;
    if (pos === 'bottom' && bottomTaken) return 0;
    if (pos === 'shroud' && !cl.shroud) return 0;
    if (pos === 'rear' && !cl.rearFan) return 0;
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
        u.count++;
        u.len += sizeMM;
        free--;
        // A mount the radiator (or the card) covers, or one past the case wall, is skipped.
        const b = boxOf(slot.p, worldExtent([size, size, t], ex, ey));
        const outside = [0, 1, 2].some((a) => b.min[a] < shell.min[a] - 0.05 || b.max[a] > shell.max[a] + 0.05);
        if (outside || blockers.some((k) => hits(k, b))) continue;
        out.push({ partIndex, unit, mount: pos, size, depth: t, placement: { p: slot.p.map(r2), ex, ey }, explode: explodeDir(pos) });
        unit++;
      }
      if (unit >= n) break;
    }
    unplaced += n - unit;
  });
  if (unplaced) notes.push(`${unplaced} fan${unplaced > 1 ? 's have' : ' has'} no free mount in this case and ${unplaced > 1 ? 'are' : 'is'} not drawn.`);
  return out;
}

// ---------------------------------------------------------------- AIO radiator
const RAD_ORDER = ['front', 'top', 'side', 'bottom', 'rear'];
export const RAD_THICK = 2.7; // typical 27 mm core, used where the data has no radiatorThicknessMM

/** Radiator size and fan set of an AIO, from the data. */
export function radiatorSpec(cooler) {
  const sizeMM = cooler.radiatorSizeMM ?? 240;
  const fanMM = cooler.fanSizeMM ?? (sizeMM % 140 === 0 ? 140 : 120);
  const n = cooler.fans ?? Math.max(1, Math.round(sizeMM / fanMM));
  const fanT = 2.5;
  const thick = cooler.radiatorThicknessMM ? cooler.radiatorThicknessMM / 10 : RAD_THICK;
  return { sizeMM, fanMM, n, fanT, thick, len: (n * fanMM) / 10 + 3.7, width: fanMM / 10 + 0.4, stack: thick + fanT };
}

// Positions where the case takes a radiator of `sizeMM`, best first.
function radiatorPositions(cl, pcCase, sizeMM, fanMM) {
  const support = pcCase?.radiatorSupport;
  let list;
  if (Array.isArray(support) && support.length) {
    list = support.filter((r) => (r.maxMM ?? 0) >= sizeMM && (!r.sizesMM || r.sizesMM.includes(sizeMM))).map((r) => r.position);
  } else {
    // No radiator list: any fan mount long enough for the radiator's fans.
    list = Object.entries(cl.fanMounts).filter(([, m]) => (m[fanMM] ?? 0) * fanMM >= sizeMM).map(([pos]) => pos);
  }
  return RAD_ORDER.filter((p) => list.includes(p));
}

/**
 * Where an AIO radiator (with its fans) goes. The stack sits against the panel and its fans
 * take that position's fan mounts. Returns null (and a note) when the case has no room.
 */
export function layoutRadiator(cooler, pcCase, cl, boardFront, notes) {
  const spec = radiatorSpec(cooler);
  const fs = spec.fanMM / 10;
  const shell = shellOf(cl);
  const bottomTaken = !cl.shroud && !cl.dualChamber;
  for (const pos of radiatorPositions(cl, pcCase, spec.sizeMM, spec.fanMM)) {
    if (pos === 'bottom' && bottomTaken) continue;
    const rail = fanRail(pos, cl, boardFront, fs, spec.fanT, spec.n * fs);
    if (!rail) continue;
    const first = rail(0);
    const last = rail(spec.n - 1);
    // Side mounts: the side panel (board-on-the-side cases), the tray, or the front when the tray is full.
    const outward = pos !== 'side' ? OUTWARD[pos] : cl.ioDown ? Z : first.normal[0] === -1 ? X : neg(Z);
    // Along the rail (fan 0 -> fan n-1); a single fan uses the rail's natural direction.
    const along = spec.n > 1 ? normalise(add(last.p, first.p, -1)) : (pos === 'top' || pos === 'bottom' ? X : neg(Y));
    const centre = [0, 1, 2].map((a) => (first.p[a] + last.p[a]) / 2);
    // Fan centre sits t/2 from the panel; the whole stack's centre sits stack/2 from it.
    let p = add(centre, outward, spec.fanT / 2 - spec.stack / 2);
    const ex = along;
    const ez = outward;
    const ey = crossN(ez, ex);
    const ext = worldExtent([spec.len, spec.width, spec.stack], ex, ey);
    // Slide along the rail so the end tanks stay inside the case.
    p = p.map((v, a) => {
      const lo = shell.min[a] + ext[a] / 2 + 0.1;
      const hi = shell.max[a] - ext[a] / 2 - 0.1;
      return lo > hi ? v : clamp(v, lo, hi);
    });
    const fits = [0, 1, 2].every((a) => p[a] - ext[a] / 2 >= shell.min[a] - 0.05 && p[a] + ext[a] / 2 <= shell.max[a] + 0.05);
    if (!fits) continue;
    return { mount: pos, spec, placement: { p: p.map(r2), ex, ey }, ext, outward, explode: explodeDir(pos) };
  }
  notes.push(`${cooler.name}: this case model has no free mount for a ${spec.sizeMM} mm radiator, so the radiator is not drawn.`);
  return null;
}

function normalise(v) {
  const l = Math.hypot(...v) || 1;
  return v.map((x) => r2(x / l) || 0);
}
function crossN(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]].map((v) => v || 0);
}
