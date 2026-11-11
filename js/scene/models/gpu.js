// Graphics card at its real length and thickness from the data: PCB with the PCIe edge,
// backplate, fin stack, shroud with fan openings, 2-4 fans, power connectors on the top edge,
// a lit logo strip, and the I/O bracket that replaces the case's slot covers.
// Local axes (see layout-board.js): +X from the bracket along the card, +Y = top edge (away
// from the board), +Z = cooler side. PCB centre plane at z = 0.
import * as THREE from 'three';
import { mat, ledMaterial } from '../materials.js';
import { boxMM, instancedBoxes, instanced, cylinderZ, detail } from '../resources.js';
import { makeFan } from '../fan-model.js';
import { gpuDims, gpuPowerSockets } from '../layout-board.js';
import { PCIE_PITCH } from '../board-layout.js';

export function buildGPU(part) {
  const g = new THREE.Group();
  g.name = 'gpu';
  const { L, T, H, approx } = gpuDims(part);
  const zc = T - 0.45; // cooler face
  const reference = /founders|limited edition/i.test(part.name);

  // PCB, PCIe fingers, backplate.
  boxMM(g, 0.1, Math.max(L * 0.72, Math.min(L - 0.5, 18)), 0.5, H - 0.6, -0.08, 0.08, mat('pcb'));
  boxMM(g, 5.1, 14.0, 0.0, 0.55, -0.06, 0.06, mat('gold'), { cast: false });
  boxMM(g, 0.2, L - 0.15, 0.55, H, -0.45, -0.14, mat('frameAlu'));
  boxMM(g, 0.6, L - 0.6, H - 1.2, H - 1.05, -0.46, -0.45, mat('aluLight'), { cast: false });

  // Backplate vents and a recessed panel line; heatpipes showing along the top edge.
  const vents = [];
  for (let x = L * 0.62; x + 0.35 < L - 0.8; x += 0.7) vents.push([x, x + 0.35, H * 0.25, H * 0.75, -0.462, -0.45]);
  vents.push([0.6, L - 0.6, H * 0.12, H * 0.12 + 0.06, -0.462, -0.45]);
  detail(instancedBoxes(g, vents, mat('chip'), { cast: false }), 1);
  const pipes = [];
  for (let i = 0; i < 3; i++) pipes.push({ p: [L * 0.5, H - 0.75 - i * 0.02, 0.5 + i * 0.75], r: [0, Math.PI / 2, 0], s: [1, 1, Math.max(4, L * 0.55)] });
  detail(instanced(g, cylinderZ(0.3, 1, 10), pipes, mat('nickel')), 1);

  // Fin stack (seen through the fan openings) and the shroud's edges.
  const fins = [];
  for (let x = 0.6; x < L - 0.4; x += 0.32) fins.push([x, x + 0.06, 0.9, H - 0.5, 0.2, zc - 0.5]);
  instancedBoxes(g, fins, mat('heatsink'));
  const shroudMat = reference ? mat('frameAlu') : mat('plastic');
  boxMM(g, 0.05, L, H - 0.45, H, 0.12, zc, shroudMat);
  boxMM(g, 0.05, L, 0.55, 0.95, 0.12, zc, shroudMat);
  boxMM(g, L - 0.4, L, 0.95, H - 0.45, 0.12, zc, shroudMat);

  // Shroud plate with one opening per fan.
  const n = part.fans ?? (L >= 30 ? 3 : 2);
  const d = Math.min((L - 1.6) / n, H - 1.6, 10.5) * 0.96;
  const pitch = (L - 1.0) / n;
  const centres = Array.from({ length: n }, (_, i) => 0.6 + pitch * (i + 0.5));
  const yc = (0.55 + H) / 2;
  const shape = new THREE.Shape();
  shape.moveTo(0.05, 0.55); shape.lineTo(L, 0.55); shape.lineTo(L, H); shape.lineTo(0.05, H); shape.lineTo(0.05, 0.55);
  for (const x of centres) {
    const hole = new THREE.Path();
    hole.absarc(x, yc, d / 2 + 0.12, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const plate = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: false, curveSegments: 36 }), shroudMat);
  plate.position.z = zc - 0.3;
  plate.castShadow = true;
  plate.receiveShadow = true;
  g.add(plate);

  // Panel lines on the shroud between the fans, and screws around each opening.
  const lines = [];
  for (let i = 0; i + 1 < centres.length; i++) {
    const x = (centres[i] + centres[i + 1]) / 2;
    lines.push([x - 0.04, x + 0.04, 0.7, H - 0.15, zc, zc + 0.012]);
  }
  lines.push([0.3, L - 0.3, H - 0.62, H - 0.56, zc, zc + 0.012]);
  detail(instancedBoxes(g, lines, mat('chip'), { cast: false }), 1);
  const screws = [];
  for (const x of centres) for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) screws.push({ p: [x + dx * (d / 2 + 0.05) * 0.78, yc + dy * (d / 2 + 0.05) * 0.78, zc + 0.02] });
  detail(instanced(g, cylinderZ(0.14, 0.05, 8), screws, mat('steelBright'), { cast: false }), 2);

  const rotors = [];
  for (const x of centres) {
    const f = makeFan(d, 1.0, { frame: false, blades: 9 });
    f.group.position.set(x, yc, zc - 0.65);
    g.add(f.group);
    rotors.push(f.rotor);
  }

  // Power connectors on the top edge, toward the far end of the PCB.
  for (const s of gpuPowerSockets(part)) {
    boxMM(g, s.x0, s.x1, H, s.y, s.z - s.dep / 2, s.z + s.dep / 2, mat('plastic'));
  }

  // Logo strip on the top edge.
  const led = ledMaterial();
  boxMM(g, 1.6, Math.min(L * 0.4, 12), H, H + 0.04, zc * 0.3, zc * 0.3 + 0.5, led, { cast: false, name: 'gpu-logo' });

  // I/O bracket in the case's slot opening, one cover per slot the card uses.
  const slots = Math.max(1, Math.ceil((T - 0.3) / PCIE_PITCH));
  const zb1 = (slots - 1) * PCIE_PITCH + 0.95;
  boxMM(g, -0.25, -0.05, 0.4, 12.0, -0.95, zb1, mat('frameAlu'));
  boxMM(g, -0.05, 0.2, 0.5, 11.8, -0.45, Math.min(zb1, zc), mat('frameAlu'));
  const ports = [];
  for (let i = 0; i < 4; i++) ports.push([-0.32, -0.25, 1.5 + i * 2.2, 2.9 + i * 2.2, -0.4, 0.4]);
  instancedBoxes(g, ports, mat('chip'), { cast: false });

  g.userData.rotors = rotors;
  g.userData.leds = [led];
  g.userData.approx = [
    ...approx.map((k) => (k === 'length' ? 'length not in the data, 300 mm assumed' : 'thickness not in the data, 2 slots assumed')),
    `card height ${H * 10} mm is a typical size`,
  ];
  return g;
}
