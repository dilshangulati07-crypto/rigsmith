// CPU in its socket: substrate and nickel heat spreader (IHS) at the socket's real size.
// Local origin: socket centre on the board's front face; +X = board u, +Y = up the board, +Z = out.
import * as THREE from 'three';
import { mat } from '../materials.js';
import { boxMM } from '../resources.js';
import { socketSize } from '../board-layout.js';

/** Height of the IHS top above the board (coolers sit on it). */
export const IHS_TOP = 0.85;

export function buildCPU(part) {
  const g = new THREE.Group();
  g.name = 'cpu';
  const s = socketSize(part.socket);
  // AM4 chips sit on top of the PGA socket body; LGA chips drop into the load plate.
  const z0 = s.kind === 'pga' ? 0.55 : 0.36;
  const w = s.w - 0.25;
  const h = s.h - 0.25;
  boxMM(g, -w / 2, w / 2, -h / 2, h / 2, z0, z0 + 0.12, mat('ssdPcb'));
  // IHS: square on AMD, a narrower rectangle on Intel.
  const iw = s.w === s.h ? w * 0.86 : w * 0.82;
  const ih = s.w === s.h ? h * 0.86 : h * 0.72;
  boxMM(g, -iw / 2, iw / 2, -ih / 2, ih / 2, z0 + 0.12, IHS_TOP, mat('aluLight'));
  boxMM(g, -iw / 2 + 0.2, iw / 2 - 0.2, -ih / 2 + 0.2, ih / 2 - 0.2, IHS_TOP, IHS_TOP + 0.005, mat('heatsink'), { cast: false });
  g.userData.approx = [];
  return g;
}
