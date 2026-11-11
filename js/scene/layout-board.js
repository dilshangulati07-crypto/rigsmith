// Parts that sit on the motherboard: CPU, cooler head, memory and graphics card, placed from
// the board frame (see layout-math.js) so the same code serves standard towers and cases that
// mount the board with its I/O facing down. Pure maths (no three.js).
import { PCIE_PITCH } from './board-layout.js';
import { Z, neg, add, r2, boardPoint, boardBasis, boxOfLocal, shellOf } from './layout-math.js';

export const GPU_HEIGHT = 12.5;   // typical card height (bracket edge to top edge); not in the data
export const RAM_LENGTH = 13.335; // DIMM length
const RAM_DEFAULT_H = 3.4;        // standard-height module with a low heatspreader
const AIR_DEFAULT_H = 15.5;       // typical single-tower height
export const AIO_HEAD_H = 5.2;    // pump block height above the board, including the CPU

const placeOn = (f, u, v, dz = 0) => ({ p: boardPoint(f, u, v, dz).map(r2), ...boardBasis(f) });

export function layoutCPU(f, bl) {
  return { placement: placeOn(f, bl.socket.u, bl.socket.v), socket: bl.socket };
}

/** Modules in a RAM part: `modules`, else the "2x16" kit string, else 1. */
export const ramModules = (part) => part.modules ?? (Number(String(part.kit ?? '').match(/^(\d+)x/)?.[1]) || 1);

// Fill order: A2/B2 first on 4-slot boards (indices 1 and 3, index 0 = closest to the socket).
const RAM_ORDER = { 4: [1, 3, 0, 2], 2: [0, 1], 1: [0] };

export function layoutRAM(ramParts, f, bl, notes) {
  const order = RAM_ORDER[bl.ram.length] ?? bl.ram.map((_, i) => i);
  const out = [];
  let next = 0;
  let extra = 0;
  ramParts.forEach((part, partIndex) => {
    const h = part.heightMM ? part.heightMM / 10 : RAM_DEFAULT_H;
    for (let unit = 0; unit < ramModules(part); unit++) {
      const slot = order[next];
      if (slot === undefined) { extra++; continue; }
      next++;
      const s = bl.ram[slot];
      // Stick local: +X along the module, +Y out of the board, +Z across.
      out.push({ partIndex, unit, slot, height: h, placement: { p: boardPoint(f, s.u, (s.v0 + s.v1) / 2).map(r2), ex: f.V, ey: Z }, explode: Z });
    }
  });
  if (extra) notes.push(`${extra} memory module${extra > 1 ? 's do' : ' does'} not fit the board's ${bl.ram.length} slots and ${extra > 1 ? 'are' : 'is'} not drawn.`);
  return out;
}

/** Card size from the data (cm), with flags for anything that had to be assumed. */
export function gpuDims(gpu) {
  const approx = [];
  let L = gpu.lengthMM / 10;
  if (!gpu.lengthMM) { L = 30; approx.push('length'); }
  let T = gpu.thicknessMM / 10;
  if (!gpu.thicknessMM) {
    if (gpu.slotWidth) T = gpu.slotWidth * PCIE_PITCH;
    else { T = 2 * PCIE_PITCH; approx.push('thickness'); }
  }
  return { L, T, H: GPU_HEIGHT, approx };
}

/**
 * Graphics card in the top x16 slot. Model local: +X from the bracket along the card, +Y out
 * of the board (top edge, power connectors), +Z toward the cooler side; PCB at z = 0.
 */
export function layoutGPU(gpu, f, bl, cl, notes) {
  const x16 = bl.pcie.filter((p) => p.size === 'x16').sort((a, b) => a.v - b.v)[0] ?? bl.pcie[0];
  if (!x16) {
    notes.push('This board has no PCIe slot in the data, so the graphics card is not drawn.');
    return null;
  }
  const dims = gpuDims(gpu);
  const placement = { p: boardPoint(f, -0.9, x16.v).map(r2), ex: f.U, ey: Z };
  const box = boxOfLocal(placement, [0, 0.5, -0.45], [dims.L, dims.H + 1.2, dims.T - 0.45]);
  const shell = shellOf(cl);
  const inside = [0, 1, 2].every((a) => box.min[a] >= shell.min[a] - 1.2 && box.max[a] <= shell.max[a] + 0.05);
  if (!inside) notes.push(`The graphics card (${dims.L.toFixed(1)} cm) does not fit inside this case model and is drawn as it would sit.`);

  // Rear slot covers the card replaces: the row nearest its slot and the rows its cooler covers.
  let covers = [];
  if (!cl.ioDown && cl.slots.length) {
    const y = placement.p[1];
    let k = 0;
    cl.slots.forEach((s, i) => { if (Math.abs(s - y) < Math.abs(cl.slots[k] - y)) k = i; });
    const n = Math.max(1, Math.ceil((dims.T - 0.3) / PCIE_PITCH));
    covers = Array.from({ length: n }, (_, i) => k + i).filter((i) => i < cl.slots.length);
  }
  return { placement, box, dims, covers, slot: x16, inside, explode: add(Z, f.V, 0.25) };
}

/** Cooler head on the socket: tower, low-profile or AIO pump block. */
export function layoutCooler(cooler, f, bl) {
  const aio = cooler.type === 'aio';
  const approx = [];
  let height = cooler.heightMM / 10;
  if (aio) height = AIO_HEAD_H;
  else if (!cooler.heightMM) { height = AIR_DEFAULT_H; approx.push('height'); }
  return { kind: aio ? 'aio' : 'air', height, approx, placement: placeOn(f, bl.socket.u, bl.socket.v) };
}

/** Two coolant tubes from the pump block to the radiator end tank nearest to it. */
export function aioTubes(head, rad, f) {
  const { p: hp } = head.placement;
  const { p: rp, ex } = rad.placement;
  const { spec, outward } = rad;
  // Core centre (the stack's panel side), then the end tank nearer the pump.
  const core = add(rp, outward, rad.spec.stack / 2 - 2.7 / 2);
  const ends = [1, -1].map((s) => add(core, ex, s * (spec.len / 2 - 1.4)));
  const dist = (a) => Math.hypot(a[0] - hp[0], a[1] - hp[1], a[2] - hp[2]);
  const end = dist(ends[0]) < dist(ends[1]) ? ends[0] : ends[1];
  const ey = rad.placement.ey;
  return [-1, 1].map((s) => {
    const a = add(hp, f.U, 2.6);
    const a0 = add(add(a, Z, AIO_HEAD_H - 1.6), f.V, s * 1.1);
    // Rise clear of the memory first, then arc over to the radiator.
    const a1 = add(add(a0, f.U, 1.4), Z, 4.2);
    const b = add(end, ey, s * 1.6);
    const b1 = add(b, neg(outward), 4);
    const mid = [0, 1, 2].map((i) => (a1[i] + b1[i]) / 2 + (i === 2 ? 3 : 0));
    return [a0, a1, mid, b1, b].map((p) => p.map(r2));
  });
}
