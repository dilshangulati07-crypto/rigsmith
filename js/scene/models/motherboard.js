// Procedural motherboard from boardLayout(): PCB at the real form-factor size, I/O shroud and
// rear I/O plate, VRM heatsinks with chokes, CPU socket for the board's socket type, one RAM
// slot per memorySlots, PCIe slots from pcieSlots[], M.2 covers per m2Slots, chipset heatsink,
// power connectors, SATA ports and headers.
// Local origin: the PCB's rear-top corner on its front face. +X = toward the case front,
// -Y = down the board, +Z = out of the board toward the window.
// Moving parts for the hands-on build (userData.mechanisms): the socket lever on its hinge and
// the M.2 heatsink covers. The rear I/O plate is named "io-shield" (it goes in before the board).
import * as THREE from 'three';
import { mat } from '../materials.js';
import { boxMM, instancedBoxes, cylinderZ } from '../resources.js';
import { boardLayout } from '../board-layout.js';
import { PCB } from '../layout.js';

export function buildMotherboard(part) {
  const L = boardLayout(part);
  const g = new THREE.Group();
  g.name = 'motherboard';
  // Board-space box: u0..u1 across, v0..v1 down, z0..z1 out of the board.
  const onTo = (parent, u0, u1, v0, v1, z0, z1, m, opts) => boxMM(parent, u0, u1, -v1, -v0, z0, z1, m, opts);
  const on = (...a) => onTo(g, ...a);
  const r = (rc, z0, z1, m, opts) => on(rc.u0, rc.u1, rc.v0, rc.v1, z0, z1, m, opts);
  const mechanisms = { lever: null, m2Covers: [] };

  on(0, L.w, 0, L.h, -PCB, 0, mat('pcb'));

  // Rear I/O: shroud on the board, port blocks, and the I/O plate that sits in the case cut-out.
  r(L.io, 0, 3.8, mat('plastic'));
  on(L.io.u1 - 0.3, L.io.u1, L.io.v0, L.io.v1, 0, 3.85, mat('aluLight'));
  on(-0.86, -0.78, L.io.v0 - 0.2, L.io.v1 + 0.2, -PCB, 4.3, mat('frameAlu'), { name: 'io-shield' });
  const ports = [];
  const span = L.io.v1 - L.io.v0;
  for (let i = 0, v = L.io.v0 + 0.5; i < 6 && v + 1.6 < L.io.v1; i++, v += span / 6) {
    ports.push([-0.78, 0.2, -(v + 1.6), -v, 0.4, i % 2 ? 1.6 : 3.3]);
  }
  instancedBoxes(g, ports, mat('chip'));
  if (part?.wifi && part.wifi !== 'none') {
    for (const v of [L.io.v0 + 1.2, L.io.v0 + 3.0]) {
      const a = new THREE.Mesh(cylinderZ(0.32, 0.8, 12), mat('gold'));
      a.rotation.y = Math.PI / 2;
      a.position.set(-1.1, -v, 2.6);
      g.add(a);
    }
  }

  // VRM: heatsinks with a brushed top edge and chokes along their inner side.
  for (const v of L.vrm) {
    r(v, 0, 3.0, mat('heatsink'));
    on(v.u0, v.u1, v.v0, v.v0 + 0.14, 3.0, 3.06, mat('aluLight'), { cast: false });
  }
  const chokes = [];
  const [top, left] = L.vrm;
  for (let u = top.u0 + 0.6; u + 0.7 < top.u1; u += 1.0) chokes.push([u, u + 0.7, -(top.v1 + 0.95), -(top.v1 + 0.2), 0, 0.55]);
  for (let v = left.v0 + 0.9; v + 0.7 < left.v1; v += 1.0) chokes.push([left.u1 + 0.2, left.u1 + 0.95, -(v + 0.7), -v, 0, 0.55]);
  instancedBoxes(g, chokes, mat('heatsink'));

  // CPU socket: LGA load plate and lever, or the PGA (AM4) socket block.
  const s = L.socket;
  const su0 = s.u - s.w / 2; const su1 = s.u + s.w / 2;
  const sv0 = s.v - s.h / 2; const sv1 = s.v + s.h / 2;
  on(su0 - 0.4, su1 + 0.4, sv0 - 0.4, sv1 + 0.4, 0, 0.12, mat('chip'), { cast: false });
  // Socket lever: a pivot at its hinge (the end nearer the board's bottom edge); rotating the
  // pivot about local +X lifts the lever out of the board.
  const lever = new THREE.Group();
  lever.name = 'socket-lever';
  if (s.kind === 'pga') {
    on(su0, su1, sv0, sv1, 0, 0.55, mat('socketPga'));
    lever.position.set(su1 + 0.175, -(sv1 + 0.3), 0.425);
    boxMM(lever, -0.125, 0.125, 0, sv1 + 0.3 - sv0, -0.125, 0.125, mat('aluLight'));
  } else {
    on(su0, su1, sv0, sv1, 0, 0.32, mat('aluLight'));
    on(su0 + 0.5, su1 - 0.5, sv0 + 0.6, sv1 - 0.6, 0.3, 0.34, mat('chip'), { cast: false });
    const bar = new THREE.Mesh(cylinderZ(0.07, s.h + 0.5, 8), mat('aluLight'));
    bar.rotation.x = Math.PI / 2;
    bar.position.y = (s.h + 0.5) / 2;
    bar.castShadow = true;
    lever.position.set(su1 + 0.35, -(sv1 + 0.25), 0.25);
    lever.add(bar);
  }
  g.add(lever);
  mechanisms.lever = lever;
  // Cooler mounting holes around the socket.
  const holes = [];
  const hr = s.kind === 'pga' || s.w === s.h ? 4.5 : 3.75;
  for (const du of [-1, 1]) for (const dv of [-1, 1]) holes.push([s.u + du * hr - 0.25, s.u + du * hr + 0.25, -(s.v + dv * hr) - 0.25, -(s.v + dv * hr) + 0.25, 0, 0.03]);
  instancedBoxes(g, holes, mat('frameAlu'), { cast: false });

  // RAM slots with latches.
  const latches = [];
  for (const slot of L.ram) {
    on(slot.u - 0.33, slot.u + 0.33, slot.v0 + 0.5, slot.v1 - 0.5, 0, 0.75, mat('plastic'));
    latches.push([slot.u - 0.3, slot.u + 0.3, -(slot.v0 + 0.5), -slot.v0, 0, 1.0]);
    latches.push([slot.u - 0.3, slot.u + 0.3, -slot.v1, -(slot.v1 - 0.5), 0, 1.0]);
  }
  instancedBoxes(g, latches, mat('plasticGloss'));

  // PCIe slots: steel-armoured x16 slots on Gen 4+ boards, plain plastic otherwise.
  for (const p of L.pcie) {
    const armour = p.size === 'x16' && (p.gen ?? 0) >= 4;
    on(p.u0, p.u0 + p.len, p.v - 0.37, p.v + 0.37, 0, 1.1, armour ? mat('aluLight') : mat('plastic'));
    on(p.u0 + p.len, p.u0 + p.len + 0.6, p.v - 0.3, p.v + 0.3, 0, 1.2, mat('plasticGloss'));
  }

  // M.2: connector and screw post for every slot; heatsink cover where the board has one.
  L.m2.forEach((m, slot) => {
    if (m.back) return;
    on(m.u - 4.3, m.u - 3.8, m.v - 1.1, m.v + 1.1, 0, 0.45, mat('plastic'));
    on(m.u + 3.9, m.u + 4.2, m.v - 0.15, m.v + 0.15, 0, 0.3, mat('brass'));
    if (m.cover === 'own') {
      const cover = new THREE.Group();
      cover.name = 'm2-cover';
      onTo(cover, m.u - 4.4, m.u + 4.4, m.v - 1.3, m.v + 1.3, 0.55, 1.0, mat('heatsink'));
      for (const dv of [-0.65, 0, 0.65]) onTo(cover, m.u - 4.2, m.u + 4.2, m.v + dv - 0.05, m.v + dv + 0.05, 1.0, 1.03, mat('aluLight'), { cast: false });
      g.add(cover);
      mechanisms.m2Covers.push({ slot, cover });
    }
  });

  // Chipset heatsink. On ITX it doubles as the M.2 cover, so it sits above the drive.
  const c = L.chipset;
  if (L.ff === 'ITX') {
    on(c.u0 + 0.6, c.u0 + 1.4, c.v0 + 0.6, c.v1 - 0.6, 0, 0.55, mat('heatsink'));
    const cover = new THREE.Group();
    cover.name = 'm2-cover';
    onTo(cover, c.u0, c.u1, c.v0, c.v1, 0.55, 1.2, mat('heatsink'));
    onTo(cover, c.u0, c.u1, c.v0, c.v0 + 0.12, 1.2, 1.25, mat('aluLight'), { cast: false });
    g.add(cover);
    const slot = L.m2.findIndex((m) => m.cover === 'chipset');
    if (slot >= 0) mechanisms.m2Covers.push({ slot, cover });
  } else {
    r(c, 0, 1.0, mat('heatsink'));
    on(c.u0, c.u1, c.v0, c.v0 + 0.12, 1.0, 1.05, mat('aluLight'), { cast: false });
  }

  // Power connectors.
  r(L.atx24, 0, 1.6, mat('plastic'));
  r(L.eps, 0, 1.3, mat('plastic'));

  // SATA ports on the front edge, headers along the bottom edge, CMOS battery.
  const small = [];
  const sata = Math.ceil((part?.sataPorts ?? 4) / 2);
  const sataV0 = L.ff === 'ITX' ? 15.0 : L.h - 9.5;
  for (let i = 0; i < Math.min(sata, 3); i++) small.push([L.w - 1.0, L.w - 0.1, -(sataV0 + i * 1.3 + 1.0), -(sataV0 + i * 1.3), 0, 0.9]);
  if (L.ff !== 'ITX') {
    for (let u = 2.0; u + 1.3 < L.w - 2; u += (L.w - 4) / 6) small.push([u, u + 1.3, -(L.h - 0.2), -(L.h - 0.75), 0, 0.85]);
  }
  for (const u of [L.vrm[0].u1 + 0.4, L.w - 2.8]) small.push([u, u + 0.9, -0.95, -0.4, 0, 0.75]);
  instancedBoxes(g, small, mat('plastic'));
  if (L.ff !== 'ITX') {
    const bat = new THREE.Mesh(cylinderZ(1.0, 0.32, 28), mat('aluLight'));
    bat.position.set(14.2, -(L.h - 2.8), 0.16);
    g.add(bat);
  }

  // Anchors for the parts that plug into the board (board-local, cm).
  g.userData.anchors = {
    socket: [s.u, -s.v, 0],
    ram: L.ram.map((slot) => [slot.u, -(slot.v0 + slot.v1) / 2, 0]),
    pcie: L.pcie.map((p) => ({ at: [p.u0, -p.v, 1.1], size: p.size })),
    m2: L.m2.map((m) => [m.u, -m.v, m.back ? -PCB : 0]),
  };
  g.userData.layout = L;
  g.userData.mechanisms = mechanisms;
  return g;
}
