// Procedural PSU at the standard size for its form factor: body, fan and grille on the
// underside, honeycomb rear with AC inlet and switch, modular sockets (or a cable exit) on
// the inside face, and a side label with brand and wattage.
// Local axes: +X = inside face (toward the case front), -X = rear, -Y = fan side, +Z = label side.
import * as THREE from 'three';
import { mat, meshPanelMaterial } from '../materials.js';
import { boxMM, instancedBoxes, labelTexture } from '../resources.js';
import { makeFan } from '../fan-model.js';
import { psuDims } from '../layout.js';

export function buildPSU(part, { anisotropy = 4 } = {}) {
  const { len, h, w } = psuDims(part);
  const g = new THREE.Group();
  g.name = 'psu';
  const x0 = -len / 2; const x1 = len / 2;
  const y0 = -h / 2; const y1 = h / 2;
  const z0 = -w / 2; const z1 = w / 2;

  boxMM(g, x0, x1, y0, y1, z0, z1, mat('psuBody'));

  // Fan under a wire grille (fans face down in a bottom-mounted PSU).
  const fanSize = Math.min(len, w) * 0.86;
  const fan = makeFan(fanSize, 1.2, { frame: false, ring: false });
  fan.group.rotation.x = Math.PI / 2;
  fan.group.position.set(0, y0 + 0.75, 0);
  g.add(fan.group);
  for (let i = 1; i <= 4; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry((fanSize / 2) * (i / 4), 0.05, 6, 48), mat('heatsink'));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y0 - 0.05;
    g.add(ring);
  }
  boxMM(g, -fanSize / 2, fanSize / 2, y0 - 0.1, y0 - 0.02, -0.05, 0.05, mat('heatsink'), { cast: false });
  boxMM(g, -0.05, 0.05, y0 - 0.1, y0 - 0.02, -fanSize / 2, fanSize / 2, mat('heatsink'), { cast: false });

  // Rear: honeycomb vent, AC inlet and power switch.
  const vent = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.58, h * 0.8), meshPanelMaterial(w * 0.58, h * 0.8, 0.45, anisotropy));
  vent.rotation.y = -Math.PI / 2;
  vent.position.set(x0 - 0.01, 0, z0 + w * 0.33);
  g.add(vent);
  boxMM(g, x0 - 0.15, x0, -1.2, 1.2, z1 - 4.4, z1 - 1.4, mat('plastic'));
  boxMM(g, x0 - 0.2, x0, -0.7, 0.7, z1 - 5.6, z1 - 4.8, mat('plasticGloss'));

  // Inside face: modular sockets, or a sleeved cable exit on non-modular units.
  if (part?.modular === 'full' || part?.modular === 'semi') {
    const sockets = [];
    const rows = h > 7 ? 2 : 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < 5; c++) {
        const zc = z0 + 1.3 + c * ((w - 2.6) / 4);
        const yc = rows === 1 ? 0 : (r ? -1.5 : 1.5);
        sockets.push([x1, x1 + 0.12, yc - 0.6, yc + 0.6, zc - 0.9, zc + 0.9]);
      }
    }
    instancedBoxes(g, sockets, mat('plastic'));
  } else {
    boxMM(g, x1, x1 + 0.3, -1.6, 1.6, -2, 2, mat('rubber'));
  }

  // Side label.
  const label = labelTexture([[part?.brand ?? '', 30], [`${part?.wattage ?? ''} W`, 46], [part?.efficiency ?? '', 18, 400, '"IBM Plex Mono", monospace']], { width: 320, height: 160 });
  const sticker = new THREE.Mesh(new THREE.PlaneGeometry(len * 0.62, h * 0.62), new THREE.MeshStandardMaterial({ map: label, roughness: 0.55, metalness: 0.1 }));
  sticker.position.set(0, 0, z1 + 0.01);
  g.add(sticker);

  g.userData.rotor = fan.rotor;
  return g;
}
