// Procedural motherboard from boardLayout(): PCB at the real form-factor size, I/O shroud and
// rear I/O plate, VRM heatsinks with chokes, CPU socket for the board's socket type, one RAM
// slot per memorySlots, PCIe slots from pcieSlots[], M.2 covers per m2Slots, chipset heatsink,
// power connectors, SATA ports and headers. The product line (look.style -> LINES) sets the
// heatsink colour and size, the I/O cover, accent strips, lit zones and the name on the covers.
// Local origin: the PCB's rear-top corner on its front face. +X = toward the case front,
// -Y = down the board, +Z = out of the board toward the window.
// Moving parts for the hands-on build (userData.mechanisms): the socket lever on its hinge and
// the M.2 heatsink covers. The rear I/O plate is named "io-shield" (it goes in before the board).
import * as THREE from 'three';
import { mat, finish, diffuserMaterial } from '../materials.js?v=5b4c14becb';
import { boxMM, instancedBoxes, cylinderZ, detail, textPlane } from '../resources.js?v=5b4c14becb';
import { lookOf } from '../look.js?v=5b4c14becb';
import { boardLayout } from '../board-layout.js?v=5b4c14becb';
import { PCB } from '../layout.js?v=5b4c14becb';
import { boardFace, addBoardDetail } from './board-detail.js?v=5b4c14becb';

// sink: heatsink colour. io: false = no cover over the rear ports (entry boards). small: low,
// short heatsinks. strip: accent strip finish on the covers ('mirror' or a colour). text: the
// line's name on the I/O cover and the chipset heatsink.
const LINES = {
  budget: { sink: 'silver', io: false, small: true },
  'msi-pro': { sink: 'silver', text: 'PRO' },
  'asrock-pro': { sink: 'silver', text: 'PRO RS' },
  prime: { sink: 'white', cover: 'white', text: 'PRIME' },
  'msi-tomahawk': { sink: 'gunmetal', text: 'TOMAHAWK' },
  'msi-mpg': { sink: 'black', strip: 'red', text: 'MPG' },
  'msi-mpg-edge': { sink: 'silver', cover: 'silver', text: 'MPG' },
  aorus: { sink: 'gunmetal', strip: 'grey', text: 'AORUS' },
  tuf: { sink: 'gunmetal', strip: 'grey', slashes: true, text: 'TUF GAMING' },
  'rog-strix': { sink: 'black', strip: 'mirror', text: 'ROG STRIX' },
  'rog-hero': { sink: 'black', strip: 'mirror', tall: true, text: 'ROG' },
  'asrock-taichi': { sink: 'black', strip: 'gold', tall: true, text: 'TAICHI' },
};

export function buildMotherboard(part, { theme } = {}) {
  const look = lookOf(part, theme);
  const line = LINES[look.style] ?? { sink: 'gunmetal' };
  const sink = line.sink === 'gunmetal' ? mat('heatsink') : finish('heatsink', line.sink);
  const strip = line.strip === 'mirror' ? finish('mirror', 0x3a3e45) : line.strip ? finish('flat', look.accent && line.strip !== 'grey' ? look.accent : line.strip) : mat('aluLight');
  const coverMat = finish('plastic', line.cover ?? 'black');
  const leds = [];
  const marks = new THREE.Group();
  const fg = line.sink === 'white' || line.sink === 'silver' ? '#2c3037' : '#aeb4bc';
  const L = boardLayout(part);
  const g = new THREE.Group();
  g.name = 'motherboard';
  // Board-space box: u0..u1 across, v0..v1 down, z0..z1 out of the board.
  const onTo = (parent, u0, u1, v0, v1, z0, z1, m, opts) => boxMM(parent, u0, u1, -v1, -v0, z0, z1, m, opts);
  const on = (...a) => onTo(g, ...a);
  const r = (rc, z0, z1, m, opts) => on(rc.u0, rc.u1, rc.v0, rc.v1, z0, z1, m, opts);
  const mechanisms = { lever: null, m2Covers: [] };

  on(0, L.w, 0, L.h, -PCB, 0, mat('pcb'));
  // Printed front face: traces and silkscreen. The same image is the bump map, so both stand proud.
  const faceTex = boardFace(L, part);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(L.w, L.h), new THREE.MeshStandardMaterial({ map: faceTex, bumpMap: faceTex, bumpScale: 0.6, metalness: 0.15, roughness: 0.5 }));
  face.position.set(L.w / 2, -L.h / 2, 0.004);
  face.receiveShadow = true;
  face.name = 'pcb-face';
  g.add(face);

  // Rear I/O: shroud on the board, port blocks, and the I/O plate that sits in the case cut-out.
  if (line.io !== false) {
    r(L.io, 0, 3.8, coverMat);
    on(L.io.u1 - 0.3, L.io.u1, L.io.v0, L.io.v1, 0, 3.85, strip);
    if (line.slashes) for (const dv of [1.2, 1.9]) on(L.io.u0 + 0.5, L.io.u1 - 0.6, L.io.v1 - dv - 0.25, L.io.v1 - dv, 3.8, 3.83, strip, { cast: false });
    if (look.has('io')) {
      // Lit strip set into the I/O cover.
      const soft = diffuserMaterial();
      leds.push(soft);
      on(L.io.u0 + 0.9, L.io.u0 + 1.35, L.io.v0 + 1.5, L.io.v1 - 5.5, 3.8, 3.86, soft, { cast: false });
    }
    if (line.text) {
      const len = Math.min(6.5, line.text.length * 0.62);
      const t = textPlane(line.text, len, 0.7, { fg: line.cover ? '#2c3037' : '#aeb4bc', align: 'center' });
      t.rotation.z = -Math.PI / 2;
      t.position.set((L.io.u0 + L.io.u1) / 2 + 0.3, -(L.io.v1 - 1.2 - len / 2), 3.806);
      marks.add(t);
    }
  }
  if (look.has('edge')) {
    const soft = diffuserMaterial();
    leds.push(soft);
    on(L.w - 0.5, L.w - 0.2, L.h * 0.55, L.h * 0.86, 0, 0.12, soft, { cast: false });
  }
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
  // Entry boards: one low, short heatsink (or none on the second bank).
  const vh = line.small ? 1.7 : line.tall ? 3.4 : 3.0;
  L.vrm.forEach((v, i) => {
    if (line.small && i > 0) return;
    const u1 = line.small ? v.u0 + (v.u1 - v.u0) * 0.6 : v.u1;
    on(v.u0, u1, v.v0, v.v1, 0, vh, sink);
    on(v.u0, u1, v.v0, v.v0 + 0.14, vh, vh + 0.06, strip, { cast: false });
  });
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
    on(su0, su1, sv0, sv1, 0, 0.32, mat('steelBright'));
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
    on(p.u0, p.u0 + p.len, p.v - 0.37, p.v + 0.37, 0, 1.1, armour ? mat('steelBright') : mat('plastic'));
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
      onTo(cover, m.u - 4.4, m.u + 4.4, m.v - 1.3, m.v + 1.3, 0.55, line.small ? 0.75 : 1.0, sink);
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
    onTo(cover, c.u0, c.u1, c.v0, c.v1, 0.55, 1.2, sink);
    onTo(cover, c.u0, c.u1, c.v0, c.v0 + 0.12, 1.2, 1.25, strip, { cast: false });
    g.add(cover);
    const slot = L.m2.findIndex((m) => m.cover === 'chipset');
    if (slot >= 0) mechanisms.m2Covers.push({ slot, cover });
  } else {
    // Entry boards have a small square heatsink; the others a wide cover with the line's strip.
    const k = line.small ? 0.28 : 0;
    const cu0 = c.u0 + (c.u1 - c.u0) * k; const cu1 = c.u1 - (c.u1 - c.u0) * k;
    const cv0 = c.v0 + (c.v1 - c.v0) * k * 0.5; const cv1 = c.v1 - (c.v1 - c.v0) * k * 0.5;
    on(cu0, cu1, cv0, cv1, 0, 1.0, sink);
    on(cu0, cu1, cv0, cv0 + (line.strip ? 0.5 : 0.12), 1.0, 1.05, strip, { cast: false });
    if (line.text) {
      const t = textPlane(line.text, Math.min(cu1 - cu0 - 0.8, line.text.length * 0.6), 0.7, { fg, align: 'center' });
      t.position.set((cu0 + cu1) / 2, -(cv0 + cv1) / 2 - 0.3, 1.006);
      marks.add(t);
    }
  }

  // Power connectors.
  r(L.atx24, 0, 1.6, mat('plastic'));
  for (const e of L.eps) r(e, 0, 1.3, mat('plastic'));

  // SATA ports on the front edge, headers (from boardLayout), CMOS battery.
  const small = [];
  for (const p of L.sata) small.push([p.u - 0.45, p.u + 0.45, -(p.v + 0.5), -(p.v - 0.5), p.dz - 0.2, p.dz + 0.2]);
  for (const hd of L.headers) small.push([hd.u - hd.du / 2, hd.u + hd.du / 2, -(hd.v + hd.dv / 2), -(hd.v - hd.dv / 2), 0, hd.kind === 'usb3' ? 0.9 : 0.75]);
  instancedBoxes(g, small, mat('plastic'));
  const pins = [];
  for (const hd of L.headers) pins.push([hd.u - hd.du / 2 + 0.1, hd.u + hd.du / 2 - 0.1, -(hd.v + hd.dv / 2 - 0.1), -(hd.v - hd.dv / 2 + 0.1), 0.75, 0.82]);
  instancedBoxes(g, pins, mat('gold'), { cast: false });
  if (L.ff !== 'ITX') {
    const bat = new THREE.Mesh(cylinderZ(1.0, 0.32, 28), mat('aluLight'));
    bat.position.set(14.2, -(L.h - 2.8), 0.16);
    g.add(bat);
  }

  g.add(detail(marks, 1));
  addBoardDetail(g, L, part, mechanisms.m2Covers, { sinkTop: vh, grooves: !line.small });

  // Anchors for the parts that plug into the board (board-local, cm).
  g.userData.anchors = {
    socket: [s.u, -s.v, 0],
    ram: L.ram.map((slot) => [slot.u, -(slot.v0 + slot.v1) / 2, 0]),
    pcie: L.pcie.map((p) => ({ at: [p.u0, -p.v, 1.1], size: p.size })),
    m2: L.m2.map((m) => [m.u, -m.v, m.back ? -PCB : 0]),
  };
  g.userData.layout = L;
  g.userData.mechanisms = mechanisms;
  g.userData.leds = leds;
  return g;
}
