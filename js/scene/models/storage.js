// Procedural drives at their real form-factor size: M.2 2280 sticks, 2.5in SSDs on a
// steel sled, 3.5in hard drives on a cage tray. Each has a printed label.
// Local axes: +X = long side, +Y = short side, +Z = label face. Origin = centre of the drive.
import * as THREE from 'three';
import { mat } from '../materials.js';
import { boxMM, instancedBoxes, labelTexture } from '../resources.js';
import { DRIVE_DIMS } from '../layout.js';

const capacity = (gb) => (gb >= 1000 ? `${Math.round(gb / 100) / 10} TB` : `${gb} GB`);

function sticker(parent, part, w, h, z, opts) {
  const tex = labelTexture([[part.brand, 30], [capacity(part.capacityGB ?? 0), 40, 600]], opts);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.05 }));
  m.position.z = z;
  parent.add(m);
  return m;
}

function m2(part) {
  const g = new THREE.Group();
  const [L, W] = DRIVE_DIMS['M.2 2280'];
  boxMM(g, -L / 2, L / 2, -W / 2, W / 2, -0.04, 0.04, mat('ssdPcb'));
  boxMM(g, -L / 2, -L / 2 + 0.5, -W / 2 + 0.15, W / 2 - 0.15, 0.04, 0.05, mat('gold'), { cast: false });
  // Controller, DRAM and NAND packages under the label.
  instancedBoxes(g, [
    [-L / 2 + 0.9, -L / 2 + 2.1, -0.6, 0.6, 0.04, 0.16],
    [-L / 2 + 2.5, -L / 2 + 3.4, -0.5, 0.5, 0.04, 0.14],
    [-L / 2 + 3.8, -L / 2 + 5.5, -0.75, 0.75, 0.04, 0.16],
    [-L / 2 + 5.8, -L / 2 + 7.5, -0.75, 0.75, 0.04, 0.16],
  ], mat('chip'));
  sticker(g, part, L - 1.2, W - 0.3, 0.17, { width: 320, height: 96 }).position.x = 0.35;
  return g;
}

function sata25(part) {
  const g = new THREE.Group();
  const [L, W, T] = DRIVE_DIMS['2.5in'];
  boxMM(g, -L / 2, L / 2, -W / 2, W / 2, -T / 2, T / 2, mat('driveShell'));
  boxMM(g, -L / 2 - 0.05, -L / 2, -2.4, 1.0, -0.2, 0.2, mat('plastic'));
  sticker(g, part, L * 0.82, W * 0.72, T / 2 + 0.005, { width: 320, height: 224 });
  // Steel sled with side lips.
  const z = -T / 2 - 0.15;
  boxMM(g, -L / 2 - 0.3, L / 2 + 0.3, -W / 2 - 0.3, W / 2 + 0.3, z - 0.08, z + 0.07, mat('caseSteel'));
  for (const y of [-W / 2 - 0.3, W / 2 + 0.15]) boxMM(g, -L / 2, L / 2, y, y + 0.15, z, T / 2 - 0.1, mat('caseSteel'));
  return g;
}

function hdd35(part) {
  const g = new THREE.Group();
  const [L, W, T] = DRIVE_DIMS['3.5in'];
  boxMM(g, -L / 2, L / 2, -W / 2, W / 2, -T / 2 + 0.2, T / 2, mat('hddAlu'));
  boxMM(g, -L / 2 + 0.3, L / 2 - 0.3, -W / 2 + 0.3, W / 2 - 0.3, -T / 2, -T / 2 + 0.2, mat('ssdPcb'));
  boxMM(g, -L / 2 - 0.05, -L / 2, -3.2, 1.2, -T / 2 + 0.1, -T / 2 + 0.7, mat('plastic'));
  sticker(g, part, L * 0.7, W * 0.7, T / 2 + 0.005, { width: 320, height: 224, bg: '#8d939b', fg: '#0e1013' });
  const z = -T / 2 - 0.1;
  boxMM(g, -L / 2 - 0.3, L / 2 + 0.3, -W / 2 - 0.25, W / 2 + 0.25, z - 0.08, z, mat('caseSteel'));
  return g;
}

export function buildStorage(part) {
  const make = part.formFactor === 'M.2 2280' ? m2 : part.formFactor === '3.5in' ? hdd35 : sata25;
  const g = make(part);
  g.name = 'storage';
  return g;
}
