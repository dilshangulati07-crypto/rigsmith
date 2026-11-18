// Fine detail for the procedural motherboard (models/motherboard.js): the printed face of the
// PCB (solder mask, traces and the white silkscreen: slot and header names as the maker
// prints them, component outlines, the board's name) and small parts that only the higher
// quality levels draw (capacitors, mounting screws, connector pins, port inserts, SMD parts).
// Board space as in board-layout.js: u across, v down, z out of the board.
import * as THREE from 'three';
import { mat } from '../materials.js?v=5b4c14becb';
import { instancedBoxes, instanced, cylinderZ, detail } from '../resources.js?v=5b4c14becb';
import { pcbCanvas, canvas, rng } from '../textures.js?v=5b4c14becb';
import { STANDOFFS, BOARD_DIMS } from '../board-layout.js?v=5b4c14becb';
import { silkNames } from '../cable-plan.js?v=5b4c14becb';

const PX = 36; // texture pixels per cm
const SILK = '#c5c9cf';
const FONT = '"Barlow Condensed", "Arial Narrow", Arial, sans-serif';

const dimmNames = (n) => (n >= 4 ? ['DIMM_A1', 'DIMM_A2', 'DIMM_B1', 'DIMM_B2'] : ['DIMM_A1', 'DIMM_B1']).slice(0, n);

function pcieNames(pcie) {
  const count = {};
  return pcie.map((p) => {
    const size = String(p.size).toUpperCase();
    count[size] = (count[size] ?? 0) + 1;
    return `PCIE${size}_${count[size]}`;
  });
}

/** Colour (and bump) texture for the board's front face. Owned by the board model. */
export function boardFace(L, part) {
  const [c, g] = canvas(Math.round(L.w * PX), Math.round(L.h * PX));
  g.fillStyle = g.createPattern(pcbCanvas(), 'repeat');
  g.fillRect(0, 0, c.width, c.height);
  const N = silkNames(part);
  g.strokeStyle = SILK;
  g.fillStyle = SILK;
  g.lineWidth = 1.2;
  g.textBaseline = 'middle';
  const text = (s, u, v, { size = 0.3, rot = 0, align = 'left', weight = 600 } = {}) => {
    g.save();
    g.translate(u * PX, v * PX);
    g.rotate(rot);
    g.font = `${weight} ${Math.round(size * PX)}px ${FONT}`;
    g.textAlign = align;
    g.fillText(s, 0, 0);
    g.restore();
  };
  const box = (u0, v0, u1, v1) => g.strokeRect(u0 * PX, v0 * PX, (u1 - u0) * PX, (v1 - v0) * PX);

  // Mounting holes: a tinned ring around each.
  for (const [u, v] of STANDOFFS[L.ff] ?? []) {
    if (u > BOARD_DIMS[L.ff].w || v > BOARD_DIMS[L.ff].h) continue;
    g.fillStyle = '#9a9fa6';
    g.beginPath(); g.arc(u * PX, v * PX, 0.36 * PX, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#0b0c0e';
    g.beginPath(); g.arc(u * PX, v * PX, 0.18 * PX, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = SILK;

  // Socket keep-out and name.
  const s = L.socket;
  box(s.u - s.w / 2 - 1.5, s.v - s.h / 2 - 1.5, s.u + s.w / 2 + 1.5, s.v + s.h / 2 + 1.5);
  if (part?.socket) text(part.socket, s.u, s.v + s.h / 2 + 1.05, { size: 0.42, align: 'center' });

  // Memory slots: outline and names along the top.
  if (L.ram.length) {
    const u0 = Math.min(...L.ram.map((r) => r.u)) - 0.6;
    const u1 = Math.max(...L.ram.map((r) => r.u)) + 0.6;
    box(u0, L.ram[0].v0 - 0.15, u1, L.ram[0].v1 + 0.15);
    dimmNames(L.ram.length).forEach((n, i) => text(n, L.ram[i].u, L.ram[i].v0 - 0.3, { size: 0.26, rot: -Math.PI / 2 }));
  }

  // Expansion slots.
  pcieNames(L.pcie).forEach((n, i) => {
    const p = L.pcie[i];
    box(p.u0 - 0.1, p.v - 0.5, p.u0 + p.len + 0.75, p.v + 0.5);
    text(n, p.u0 + p.len + 1.0, p.v, { size: 0.3 });
  });

  // M.2 slots on the front.
  L.m2.forEach((m, i) => {
    if (m.back) return;
    box(m.u - 4.4, m.v - 1.2, m.u + 4.3, m.v + 1.2);
    text(`M2_${i + 1}`, m.u - 4.3, m.v + 1.5, { size: 0.28 });
    for (const len of [2242, 2260, 2280]) text(String(len), m.u - 4.0 + (len % 100) * 0.1 - 0.4, m.v - 1.4, { size: 0.2, weight: 500 });
  });

  // Power and headers, named as this maker prints them.
  text(N.atx24, L.atx24.u0 - 0.3, (L.atx24.v0 + L.atx24.v1) / 2, { size: 0.3, rot: -Math.PI / 2, align: 'center' });
  L.eps.forEach((e, i) => text(N.eps(i), (e.u0 + e.u1) / 2, e.v1 + 0.3, { size: 0.24, align: 'center' }));
  const seen = {};
  for (const h of L.headers) {
    const i = seen[h.kind] ?? 0;
    seen[h.kind] = i + 1;
    const name = h.kind === 'usb3' ? 'USB32_GEN1' : h.kind === 'usbc' ? 'USB_C' : typeof N[h.kind] === 'function' ? N[h.kind](i) : N[h.kind] ?? h.kind;
    box(h.u - h.du / 2 - 0.06, h.v - h.dv / 2 - 0.06, h.u + h.du / 2 + 0.06, h.v + h.dv / 2 + 0.06);
    if (h.du < h.dv) text(name, h.u - h.du / 2 - 0.3, h.v, { size: 0.22, rot: -Math.PI / 2, align: 'center' });
    else text(name, h.u, h.v < L.h / 2 ? h.v + h.dv / 2 + 0.3 : h.v - h.dv / 2 - 0.3, { size: 0.22, align: 'center' });
  }
  L.sata.forEach((p, i) => { if (i % 2 === 0) text(N.sata(i), p.u - 0.7, p.v, { size: 0.2, align: 'right' }); });

  // The board's own name and form factor, as printed between the slots.
  const model = String(part?.name ?? '').replace(part?.brand ?? '', '').trim().toUpperCase();
  if (model && L.ff !== 'ITX') {
    text(model, L.w * 0.5, L.h - 1.5, { size: 0.62, weight: 700, align: 'center' });
    text(`${L.ff}  REV 1.0`, L.w * 0.5, L.h - 0.95, { size: 0.24, weight: 500, align: 'center' });
  } else if (model) text(model, L.w * 0.5, L.h - 1.3, { size: 0.36, weight: 700, align: 'center' });

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Rectangles already taken by large components, so loose SMD parts stay on bare board.
function occupied(L) {
  const s = L.socket;
  const pad = (r, d = 0.3) => ({ u0: r.u0 - d, u1: r.u1 + d, v0: r.v0 - d, v1: r.v1 + d });
  return [
    pad(L.io), ...L.vrm.map((r) => pad(r, 1.3)), pad(L.chipset), pad(L.atx24), ...L.eps.map((e) => pad(e)),
    { u0: s.u - s.w / 2 - 1, u1: s.u + s.w / 2 + 1, v0: s.v - s.h / 2 - 1, v1: s.v + s.h / 2 + 1 },
    ...L.ram.map((r) => ({ u0: r.u - 0.6, u1: r.u + 0.6, v0: r.v0 - 0.2, v1: r.v1 + 0.2 })),
    ...L.pcie.map((p) => ({ u0: p.u0 - 0.3, u1: p.u0 + p.len + 1, v0: p.v - 0.7, v1: p.v + 0.7 })),
    ...L.m2.filter((m) => !m.back).map((m) => ({ u0: m.u - 4.6, u1: m.u + 4.6, v0: m.v - 1.5, v1: m.v + 1.5 })),
    ...L.headers.map((h) => ({ u0: h.u - h.du / 2 - 0.3, u1: h.u + h.du / 2 + 0.3, v0: h.v - h.dv / 2 - 0.3, v1: h.v + h.dv / 2 + 0.3 })),
  ];
}

/**
 * Small parts on the board. `g` is the board group; `covers` the M.2 heatsink groups
 * ({ slot, cover }) so their screws move with them.
 */
export function addBoardDetail(g, L, part, covers, { sinkTop = 3.0, grooves = true } = {}) {
  const hi = new THREE.Group();   // High and Ultra
  const ultra = new THREE.Group(); // Ultra only
  hi.name = 'board-detail';
  ultra.name = 'board-detail-fine';

  // Electrolytic capacitors by the VRM chokes and the audio section.
  const caps = [];
  const [top, left] = L.vrm;
  for (let u = top.u0 + 0.9; u + 0.5 < top.u1; u += 1.35) caps.push({ p: [u, -(top.v1 + 1.55), 0.45] });
  for (let v = left.v0 + 1.2; v + 0.5 < left.v1; v += 1.35) caps.push({ p: [left.u1 + 1.55, -v, 0.45] });
  instanced(hi, cylinderZ(0.3, 0.9, 14), caps, mat('chip'));
  instanced(hi, cylinderZ(0.24, 0.02, 14), caps.map(({ p }) => ({ p: [p[0], p[1], 0.91] })), mat('aluLight'), { cast: false });
  if (L.ff !== 'ITX') {
    const audio = [];
    for (let i = 0; i < 5; i++) audio.push({ p: [0.9 + i * 0.62, -(L.h - 2.3 - (i % 2) * 0.6), 0.3] });
    instanced(hi, cylinderZ(0.22, 0.6, 12), audio, mat('gold'));
  }

  // Screw heads in the mounting holes.
  const screws = (STANDOFFS[L.ff] ?? []).filter(([u, v]) => u <= BOARD_DIMS[L.ff].w && v <= BOARD_DIMS[L.ff].h).map(([u, v]) => ({ p: [u, -v, 0.09] }));
  instanced(hi, cylinderZ(0.3, 0.18, 12), screws, mat('steelBright'), { cast: false });

  // Open tops of the power connectors: a dark cavity with rows of pins.
  const dark = [];
  const pins = [];
  const cavity = (r, z, across, along) => {
    dark.push([r.u0 + 0.08, r.u1 - 0.08, -(r.v1 - 0.08), -(r.v0 + 0.08), z, z + 0.012]);
    const vertical = r.v1 - r.v0 > r.u1 - r.u0;
    const [nu, nv] = vertical ? [across, along] : [along, across];
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const u = r.u0 + ((i + 0.5) / nu) * (r.u1 - r.u0);
      const v = r.v0 + ((j + 0.5) / nv) * (r.v1 - r.v0);
      pins.push([u - 0.06, u + 0.06, -(v + 0.06), -(v - 0.06), z, z + 0.03]);
    }
  };
  cavity(L.atx24, 1.6, 2, 12);
  for (const e of L.eps) cavity(e, 1.3, 2, e.pins / 2);
  // Contact groove along the top of each expansion and memory slot.
  for (const p of L.pcie) dark.push([p.u0 + 0.25, p.u0 + p.len - 0.25, -(p.v + 0.09), -(p.v - 0.09), 1.1, 1.11]);
  for (const r of L.ram) dark.push([r.u - 0.07, r.u + 0.07, -(r.v1 - 0.9), -(r.v0 + 0.9), 0.75, 0.76]);
  // Grooves across the VRM heatsinks.
  if (grooves) {
    for (let u = top.u0 + 0.5; u < top.u1 - 0.3; u += 0.55) dark.push([u, u + 0.12, -(top.v1 - 0.25), -(top.v0 + 0.3), sinkTop, sinkTop + 0.012]);
    for (let v = left.v0 + 0.5; v < left.v1 - 0.3; v += 0.55) dark.push([left.u0 + 0.3, left.u1 - 0.25, -(v + 0.12), -v, sinkTop, sinkTop + 0.012]);
  }
  instancedBoxes(hi, dark, mat('chip'), { cast: false });
  instancedBoxes(hi, pins, mat('gold'), { cast: false });

  // Rear ports as seen from behind the case: blue USB tongues and audio jacks in the plate.
  const usb = [];
  const span = L.io.v1 - L.io.v0;
  let i = 0;
  let v = L.io.v0 + 0.5;
  for (; i < 6 && v + 1.6 < L.io.v1; i++, v += span / 6) {
    for (const z of i % 2 ? [1.0] : [1.1, 2.6]) usb.push([-0.9, -0.86, -(v + 1.4), -(v + 0.2), z - 0.12, z + 0.12]);
  }
  instancedBoxes(hi, usb, mat('usbBlue'), { cast: false });
  const jacks = [];
  for (let k = 0; k < 3; k++) jacks.push({ p: [-0.88, -(L.io.v1 - 0.9), 0.8 + k * 1.0], r: [0, Math.PI / 2, 0] });
  instanced(hi, cylinderZ(0.3, 0.06, 14), jacks, mat('chip'), { cast: false });

  // M.2 heatsink screws ride on their cover.
  for (const { cover } of covers) {
    const box = new THREE.Box3().setFromObject(cover);
    const z = box.max.z;
    const list = [[box.min.x + 0.45, (box.min.y + box.max.y) / 2], [box.max.x - 0.45, (box.min.y + box.max.y) / 2]].map(([x, y]) => ({ p: [x, y, z + 0.02] }));
    const sc = new THREE.Group();
    instanced(sc, cylinderZ(0.22, 0.08, 12), list, mat('steelBright'), { cast: false });
    cover.add(detail(sc, 1));
  }

  // Loose SMD parts on bare areas of the board: ICs, and passives in two colours.
  const r = rng(L.w * 131 + L.h * 17 + L.pcie.length);
  const taken = occupied(L);
  const free = (u, v) => u > 0.4 && u < L.w - 0.4 && v > 0.4 && v < L.h - 0.4 && !taken.some((t) => u > t.u0 && u < t.u1 && v > t.v0 && v < t.v1);
  const ics = []; const beige = []; const black = [];
  for (let k = 0; k < 420 && ics.length + beige.length + black.length < 170; k++) {
    const u = r() * L.w; const v2 = r() * L.h;
    if (!free(u, v2)) continue;
    const kind = r();
    if (kind < 0.12) { const s = 0.25 + r() * 0.35; ics.push([u - s, u + s, -(v2 + s), -(v2 - s), 0, 0.1]); } else {
      const along = r() < 0.5;
      const a = along ? 0.1 : 0.05; const b = along ? 0.05 : 0.1;
      (kind < 0.55 ? beige : black).push([u - a, u + a, -(v2 + b), -(v2 - b), 0, 0.05]);
    }
  }
  instancedBoxes(ultra, ics, mat('chip'), { cast: false });
  instancedBoxes(ultra, beige, mat('socketPga'), { cast: false });
  instancedBoxes(ultra, black, mat('chip'), { cast: false });

  g.add(detail(hi, 1), detail(ultra, 2));
}
