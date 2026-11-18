// Graphics card at its real length and thickness from the data, in the cooler design of its
// product line (look.style -> LINES): shroud material and outline, where the fans sit (front,
// back, flow-through), fin stack showing through the openings, backplate with cut-outs,
// accent plates, lit zones, power sockets on the top edge and the line's name as plain text.
// Local axes (see layout-board.js): +X from the bracket along the card, +Y = top edge (away
// from the board), +Z = cooler side. PCB centre plane at z = 0.
import * as THREE from 'three';
import { mat, finish, ledMaterial, diffuserMaterial } from '../materials.js?v=733eefba1e';
import { boxMM, instancedBoxes, instanced, cylinderZ, detail, textPlane, BOX } from '../resources.js?v=733eefba1e';
import { makeFan } from '../fan-model.js?v=733eefba1e';
import { gpuDims, gpuPowerSockets } from '../layout-board.js?v=733eefba1e';
import { PCIE_PITCH } from '../board-layout.js?v=733eefba1e';
import { lookOf, isPale } from '../look.js?v=733eefba1e';

// kind: shroud finish. fans: 'row' (all on the front), 'ends' (one at each end, solid middle),
// 'flow' (one front fan by the bracket, one on the back at the tail, fins open between),
// 'row+back' (a row plus one on the back). decor: accent plates on the face. rim: blades
// joined by an outer ring. through: share of the length the backplate is cut open at the tail.
const LINES = {
  'fe-50': { kind: 'alu', fans: 'ends', blades: 7, corner: 0.9, decor: 'vee', top: 'GEFORCE RTX', inset: true },
  'fe-40': { kind: 'alu', fans: 'flow', blades: 7, corner: 0.9, decor: 'cross', top: 'GEFORCE RTX', inset: true },
  'rog-strix': { kind: 'anodised', blades: 11, rim: true, corner: 1.5, decor: 'slash', through: 0.2, top: 'ROG STRIX' },
  'rog-astral': { kind: 'anodised', fans: 'row+back', blades: 11, rim: true, corner: 1.5, decor: 'slash', top: 'ROG ASTRAL' },
  tuf: { kind: 'anodised', blades: 11, rim: true, corner: 1.1, decor: 'plates', through: 0.2, top: 'TUF GAMING' },
  'asus-prime': { blades: 11, rim: true, corner: 0.5, decor: 'lines', through: 0.2, top: 'PRIME' },
  'asus-dual': { blades: 11, rim: true, corner: 0.8, decor: 'slash', through: 0.18, top: 'DUAL' },
  'msi-ventus': { blades: 9, rim: true, corner: 0.7, decor: 'plates', through: 0.2, top: 'VENTUS' },
  'gigabyte-windforce': { blades: 9, corner: 0.6, decor: 'slash', through: 0.2, top: 'WINDFORCE' },
  'zotac-twin-edge': { blades: 11, corner: 0.4, decor: 'lines', top: 'ZOTAC GAMING' },
  'amd-reference': { kind: 'anodised', blades: 9, corner: 0.5, decor: 'stripe', top: 'RADEON' },
  'sapphire-nitro': { kind: 'anodised', blades: 9, rim: true, corner: 0.4, decor: 'none', through: 0.2, top: 'NITRO+' },
  'sapphire-pulse': { blades: 9, rim: true, corner: 0.6, decor: 'lines', through: 0.2, top: 'PULSE' },
  'powercolor-hellhound': { blades: 9, rim: true, corner: 0.9, decor: 'slash', through: 0.2, top: 'HELLHOUND' },
  'powercolor-reaper': { blades: 9, corner: 0.3, decor: 'none', through: 0.2, top: 'REAPER' },
  'xfx-qick': { blades: 11, corner: 0.5, decor: 'lines', through: 0.2, top: 'SPEEDSTER' },
  'asrock-challenger': { blades: 9, corner: 0.7, decor: 'slash', top: 'CHALLENGER' },
  'intel-le': { blades: 9, corner: 0.7, decor: 'none', top: 'ARC' },
};
const GENERIC = { blades: 9, corner: 0.4, decor: 'none', top: null };

// Outline of the shroud face with cut corners, between x0..x1 and y0..y1.
function faceShape(x0, x1, y0, y1, c) {
  const s = new THREE.Shape();
  s.moveTo(x0 + c, y0); s.lineTo(x1 - c, y0); s.lineTo(x1, y0 + c); s.lineTo(x1, y1 - c);
  s.lineTo(x1 - c, y1); s.lineTo(x0 + c, y1); s.lineTo(x0, y1 - c); s.lineTo(x0, y0 + c); s.lineTo(x0 + c, y0);
  return s;
}
const circle = (x, y, r) => new THREE.Path().absarc(x, y, r, 0, Math.PI * 2, true);
function rect(x0, x1, y0, y1) {
  const p = new THREE.Path();
  p.moveTo(x0, y0); p.lineTo(x0, y1); p.lineTo(x1, y1); p.lineTo(x1, y0); p.lineTo(x0, y0);
  return p;
}
// `bevel` (cm): angled facets round the outline and every opening, so a shroud panel catches
// the light along its edges like a real moulded or machined part.
function extruded(parent, shape, depth, z, material, bevel = 0) {
  const b = Math.min(bevel, depth * 0.45);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: depth - b * 2, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 1, curveSegments: 32 });
  if (b > 0) geo.translate(0, 0, b);
  const m = new THREE.Mesh(geo, material);
  m.position.z = z;
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

export function buildGPU(part, { theme } = {}) {
  const g = new THREE.Group();
  g.name = 'gpu';
  const { L, T, H, approx } = gpuDims(part);
  const zc = T - 0.45; // cooler face
  const look = lookOf(part, theme);
  const line = LINES[look.style] ?? GENERIC;
  const colour = look.colour ?? 'black';
  const body = finish(line.kind ?? 'plastic', colour);
  const accent = finish(line.kind === 'alu' ? 'anodised' : 'heatsink', look.accent ?? (isPale(colour) ? 'silver' : 'gunmetal'));
  // Founders-style cards: a metal frame around a darker inset face.
  const faceMat = line.inset ? accent : body;
  const yc = (0.55 + H) / 2;

  // ---- fans: where they sit
  const n = look.fans ?? part.fans ?? (L >= 30 ? 3 : 2);
  const mode = line.fans ?? 'row';
  const back = mode === 'flow' || mode === 'row+back' ? 1 : 0;
  const front = Math.max(1, n - back);
  const d = Math.min((L - 1.6) / (mode === 'row' || mode === 'row+back' ? front : 2.6), H - 1.6, 10.5) * 0.96;
  const pitch = (L - 1.0) / front;
  const centres = mode === 'ends' ? [d / 2 + 1.0, L - d / 2 - 1.0]
    : mode === 'flow' ? [d / 2 + 1.0]
      : Array.from({ length: front }, (_, i) => 0.6 + pitch * (i + 0.5));
  const backX = back ? L - d / 2 - 1.0 : null;

  // ---- PCB, PCIe fingers, backplate with its cut-outs
  const through = back || mode === 'ends' ? 0 : L >= 22 ? line.through ?? 0 : 0;
  const openFrom = mode === 'ends' ? L - d - 1.6 : mode === 'flow' ? d + 2 : back ? backX - d / 2 - 0.6 : L * (1 - through);
  const pcbEnd = through || back || mode === 'ends' ? openFrom - 0.4 : Math.max(L * 0.72, Math.min(L - 0.5, 18));
  boxMM(g, mode === 'ends' ? d + 1.8 : 0.1, pcbEnd, 0.5, H - 0.6, -0.08, 0.08, mat('pcb'));
  boxMM(g, 5.1, 14.0, 0.0, 0.55, -0.06, 0.06, mat('gold'), { cast: false });
  const plate = faceShape(0.2, L - 0.15, 0.55, H, 0.25);
  if (backX !== null) plate.holes.push(circle(backX, yc, d / 2 + 0.12));
  else if (through) plate.holes.push(rect(openFrom, L - 0.9, 1.3, H - 0.9));
  if (mode === 'ends') for (const x of centres) plate.holes.push(rect(x - d / 2, x + d / 2, 1.3, H - 0.9));
  extruded(g, plate, 0.31, -0.45, line.inset ? body : finish('alu', isPale(colour) ? colour : 'black'), 0.08);
  boxMM(g, 0.6, L - 0.6, H - 1.2, H - 1.05, -0.46, -0.45, mat('aluLight'), { cast: false });

  // Backplate vents and a recessed panel line; bars across a flow-through opening.
  const vents = [[0.6, L - 0.6, H * 0.12, H * 0.12 + 0.06, -0.462, -0.45]];
  if (!through && backX === null && mode !== 'ends') for (let x = L * 0.62; x + 0.35 < L - 0.8; x += 0.7) vents.push([x, x + 0.35, H * 0.25, H * 0.75, -0.462, -0.45]);
  detail(instancedBoxes(g, vents, mat('chip'), { cast: false }), 1);
  if (through) {
    const bars = [];
    for (let y = 2.6; y < H - 1.4; y += 1.5) bars.push([openFrom, L - 0.9, y, y + 0.16, -0.45, -0.3]);
    instancedBoxes(g, bars, finish('alu', isPale(colour) ? colour : 'black'));
  }
  const pipes = [];
  for (let i = 0; i < 3; i++) pipes.push({ p: [L * 0.5, H - 0.75 - i * 0.02, 0.5 + i * 0.75], r: [0, Math.PI / 2, 0], s: [1, 1, Math.max(4, L * 0.55)] });
  detail(instanced(g, cylinderZ(0.3, 1, 10), pipes, mat('nickel')), 1);

  // ---- fin stack (seen through every opening) and the shroud's edges
  const fins = [];
  const finZ0 = (x) => (x > pcbEnd || (mode === 'ends' && x < d + 1.6) ? -0.4 : 0.2); // full depth where there is no PCB
  for (let x = 0.6; x < L - 0.4; x += 0.32) fins.push([x, x + 0.06, 0.9, H - 0.5, finZ0(x), zc - 0.5]);
  instancedBoxes(g, fins, line.inset ? finish('heatsink', 0x24272c) : mat('heatsink'));
  boxMM(g, 0.05, L, H - 0.45, H, 0.12, zc, body);
  boxMM(g, 0.05, L, 0.55, 0.95, 0.12, zc, body);
  boxMM(g, L - 0.4, L, 0.95, H - 0.45, 0.12, zc, body);

  // ---- shroud face: one opening per front fan (and over the open fins of a flow-through card)
  const face = faceShape(0.05, L, 0.55, H, line.corner);
  for (const x of centres) face.holes.push(circle(x, yc, d / 2 + 0.12));
  if (mode === 'flow') face.holes.push(rect(openFrom, L - 0.9, 1.3, H - 0.9));
  extruded(g, face, 0.3, zc - 0.3, faceMat, 0.12);
  if (line.inset) {
    // The frame's raised border around the inset face.
    const b = [[0.05, L, H - 0.5, H, zc, zc + 0.1], [0.05, L, 0.55, 1.05, zc, zc + 0.1], [0.05, 0.55, 1.05, H - 0.5, zc, zc + 0.1], [L - 0.5, L, 1.05, H - 0.5, zc, zc + 0.1]];
    instancedBoxes(g, b, body);
  }

  // ---- accent plates and panel lines on the face
  const zf = zc + 0.035;
  const gaps = centres.slice(0, -1).map((x, i) => (x + centres[i + 1]) / 2);
  const deco = [];
  const dark = [];
  if (line.decor === 'slash') {
    for (const x of [...gaps, centres[0] - pitch / 2 + 0.5, centres[centres.length - 1] + pitch / 2 - 0.5]) {
      for (const s of [-1, 1]) deco.push({ p: [x + s * 0.2, yc + s * (H * 0.3), zf], r: [0, 0, 0.6], s: [0.55, H * 0.24, 0.07] });
    }
  } else if (line.decor === 'plates') {
    for (const x of gaps) for (const s of [-1, 1]) deco.push({ p: [x, yc + s * (H * 0.31), zf], s: [2.6, H * 0.16, 0.07] });
    deco.push({ p: [0.9, yc, zf], s: [0.9, H * 0.5, 0.07] }, { p: [L - 0.9, yc, zf], s: [0.9, H * 0.5, 0.07] });
  } else if (line.decor === 'lines') {
    for (const y of [1.25, H - 0.75]) deco.push({ p: [L / 2, y, zf], s: [L * 0.72, 0.12, 0.05] });
  } else if (line.decor === 'stripe') {
    for (const dx of [0, 0.5]) deco.push({ p: [L - 1.4 - dx, yc, zf], s: [0.2, H * 0.62, 0.05] });
  } else if (line.decor === 'cross') {
    // The X of the frame over the open fins.
    const cx = (openFrom + L - 0.9) / 2;
    const span = Math.hypot(L - 0.9 - openFrom, H - 2.2);
    const a = Math.atan2(H - 2.2, L - 0.9 - openFrom);
    for (const s of [-1, 1]) deco.push({ p: [cx, yc, zc - 0.1], r: [0, 0, s * a], s: [span, 0.9, 0.3] });
  } else if (line.decor === 'vee') {
    for (const s of [-1, 1]) deco.push({ p: [L / 2 + s * 1.5, yc, zf], r: [0, 0, s * 0.42], s: [0.3, H * 0.74, 0.06] });
  }
  for (const x of gaps) dark.push([x - 0.04, x + 0.04, 0.7, H - 0.15, zc, zc + 0.012]);
  dark.push([0.3, L - 0.3, H - 0.62, H - 0.56, zc, zc + 0.012]);
  const decoMat = line.decor === 'stripe' || look.accent === 'red' ? finish('flat', 'red') : line.inset ? body : accent;
  instanced(g, BOX, deco, decoMat, { cast: false });
  detail(instancedBoxes(g, dark, mat('chip'), { cast: false }), 1);
  const screws = [];
  for (const x of centres) for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) screws.push({ p: [x + dx * (d / 2 + 0.05) * 0.78, yc + dy * (d / 2 + 0.05) * 0.78, zc + 0.02] });
  detail(instanced(g, cylinderZ(0.14, 0.05, 8), screws, mat('steelBright'), { cast: false }), 2);

  // ---- lighting zones (data: look.rgbZones; a card with no list gets a lit logo strip)
  const zones = { logo: look.has('logo', true), tail: look.has('tail'), bar: look.has('bar'), fans: look.has('fans') };
  const led = zones.logo || zones.tail || zones.fans ? ledMaterial() : null;
  const soft = zones.bar || zones.fans || zones.tail ? diffuserMaterial({ opacity: zones.fans ? 0.9 : 1 }) : null;
  const zl = zc * 0.3;
  if (zones.logo) boxMM(g, 1.6, Math.min(L * 0.3, 8), H, H + 0.04, zl, zl + 0.5, led, { cast: false, name: 'gpu-logo' });
  if (zones.tail) {
    boxMM(g, L, L + 0.05, 2.0, H - 2.0, 0.5, zc - 0.5, led, { cast: false });
    boxMM(g, L - 4.5, L - 0.4, H, H + 0.06, zc - 0.9, zc - 0.3, soft, { cast: false });
  }
  if (zones.bar) boxMM(g, L * 0.32, L - 1.2, H, H + 0.07, zc - 0.75, zc - 0.3, soft, { cast: false });

  // ---- fans
  const rotors = [];
  const bladeMat = isPale(colour) && look.themed ? finish('blade', colour) : undefined;
  const fan = (x, z, flip) => {
    const f = makeFan(d, 1.0, { frame: false, blades: line.blades, bladeMat, light: zones.fans ? 'blades' : null, led: led ?? undefined, soft: soft ?? undefined });
    if (line.rim) {
      // Blade tips joined by a ring that turns with the rotor.
      const rim = new THREE.Mesh(new THREE.TorusGeometry(d * 0.455, 0.07, 6, 48), zones.fans ? soft : bladeMat ?? mat('plastic'));
      f.rotor.add(rim);
    }
    f.group.position.set(x, yc, z);
    if (flip) f.group.rotation.y = Math.PI;
    g.add(f.group);
    rotors.push(f.rotor);
  };
  for (const x of centres) fan(x, zc - 0.65, false);
  if (backX !== null) fan(backX, mode === 'flow' ? 0.2 : -0.1, true);

  // ---- power sockets on the top edge, toward the far end of the PCB
  for (const s of gpuPowerSockets(part)) {
    boxMM(g, s.x0, s.x1, H, s.y, s.z - s.dep / 2, s.z + s.dep / 2, mat('plastic'));
  }

  // ---- the line's name on the top edge and the chip on the backplate, as plain text
  const fg = isPale(colour) ? '#30343a' : '#c9ced6';
  const marks = new THREE.Group();
  if (line.top) {
    const t = textPlane(line.top, Math.min(7, L * 0.26), 0.62, { fg });
    t.rotation.x = -Math.PI / 2;
    t.position.set(Math.min(L * 0.3, 8) + 0.8 + Math.min(7, L * 0.26) / 2, H + 0.006, zl + 0.25);
    marks.add(t);
  }
  if (part.chip) {
    const w = Math.min(9, L * 0.34);
    const t = textPlane(part.chip, w, 1.1, { fg, weight: 600 });
    t.rotation.x = Math.PI;
    t.position.set(2.2 + w / 2, H * 0.5, -0.456);
    marks.add(t);
  }
  g.add(detail(marks, 1));

  // ---- I/O bracket in the case's slot opening, one cover per slot the card uses
  const slots = Math.max(1, Math.ceil((T - 0.3) / PCIE_PITCH));
  const zb1 = (slots - 1) * PCIE_PITCH + 0.95;
  boxMM(g, -0.25, -0.05, 0.4, 12.0, -0.95, zb1, mat('frameAlu'));
  boxMM(g, -0.05, 0.2, 0.5, 11.8, -0.45, Math.min(zb1, zc), mat('frameAlu'));
  const ports = [];
  for (let i = 0; i < 4; i++) ports.push([-0.32, -0.25, 1.5 + i * 2.2, 2.9 + i * 2.2, -0.4, 0.4]);
  instancedBoxes(g, ports, mat('chip'), { cast: false });

  g.userData.rotors = rotors;
  g.userData.leds = [led, soft].filter(Boolean);
  g.userData.approx = [
    ...approx.map((k) => (k === 'length' ? 'length not in the data, 300 mm assumed' : 'thickness not in the data, 2 slots assumed')),
    `card height ${H * 10} mm is a typical size`,
    ...(look.style ? [] : ['cooler design not in the data, a plain shroud is drawn']),
  ];
  return g;
}
