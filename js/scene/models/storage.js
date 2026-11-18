// Procedural drives at their real form-factor size: M.2 2280 sticks, 2.5in SSDs on a
// steel sled, 3.5in hard drives on a cage tray. Each has a printed label in the colours of its
// product line (look: label colour and accent; 'm2-spreader' = a metal heat spreader over the chips).
// Local axes: +X = long side, +Y = short side, +Z = label face. Origin = centre of the drive.
import * as THREE from 'three';
import { mat, finish } from '../materials.js?v=00a22f4faf';
import { lookOf, COLOURS, isPale } from '../look.js?v=00a22f4faf';
import { boxMM, instancedBoxes, labelTexture } from '../resources.js?v=00a22f4faf';
import { DRIVE_DIMS } from '../layout.js?v=00a22f4faf';

const capacity = (gb) => (gb >= 1000 ? `${Math.round(gb / 100) / 10} TB` : `${gb} GB`);

const css = (name) => `#${(COLOURS[name] ?? COLOURS.black).toString(16).padStart(6, '0')}`;
// Label colours from the look: background, readable text, and an accent line when there is one.
function labelColours(look, dflt = {}) {
  if (!look.colour) return dflt;
  return { bg: css(look.colour), fg: isPale(look.colour) ? '#15181c' : '#dfe3e8', accent: look.accent ? css(look.accent) : null };
}

function sticker(parent, part, w, h, z, opts) {
  const tex = labelTexture([[part.brand, 30], [capacity(part.capacityGB ?? 0), 40, 600]], opts);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.05 }));
  m.position.z = z;
  parent.add(m);
  return m;
}

function m2(part, look) {
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
  const spreader = look.style === 'm2-spreader';
  if (spreader) boxMM(g, -L / 2 + 0.7, L / 2 - 0.1, -W / 2 + 0.05, W / 2 - 0.05, 0.16, 0.2, finish('heatsink', look.colour ?? 'black'));
  sticker(g, part, L - 1.2, W - 0.3, spreader ? 0.205 : 0.17, { width: 320, height: 96, ...labelColours(look) }).position.x = 0.35;
  return g;
}

function sata25(part, look) {
  const g = new THREE.Group();
  const [L, W, T] = DRIVE_DIMS['2.5in'];
  boxMM(g, -L / 2, L / 2, -W / 2, W / 2, -T / 2, T / 2, look.colour && look.colour !== 'black' ? finish(look.finish === 'metal' ? 'anodised' : 'plastic', look.colour) : mat('driveShell'));
  boxMM(g, -L / 2 - 0.05, -L / 2, -2.4, 1.0, -0.2, 0.2, mat('plastic'));
  sticker(g, part, L * 0.82, W * 0.72, T / 2 + 0.005, { width: 320, height: 224, ...labelColours({ ...look, colour: look.colour ? 'black' : null }) });
  // Steel sled with side lips.
  const z = -T / 2 - 0.15;
  boxMM(g, -L / 2 - 0.3, L / 2 + 0.3, -W / 2 - 0.3, W / 2 + 0.3, z - 0.08, z + 0.07, mat('caseSteel'));
  for (const y of [-W / 2 - 0.3, W / 2 + 0.15]) boxMM(g, -L / 2, L / 2, y, y + 0.15, z, T / 2 - 0.1, mat('caseSteel'));
  return g;
}

function hdd35(part, look) {
  const g = new THREE.Group();
  const [L, W, T] = DRIVE_DIMS['3.5in'];
  boxMM(g, -L / 2, L / 2, -W / 2, W / 2, -T / 2 + 0.2, T / 2, mat('hddAlu'));
  boxMM(g, -L / 2 + 0.3, L / 2 - 0.3, -W / 2 + 0.3, W / 2 - 0.3, -T / 2, -T / 2 + 0.2, mat('ssdPcb'));
  boxMM(g, -L / 2 - 0.05, -L / 2, -3.2, 1.2, -T / 2 + 0.1, -T / 2 + 0.7, mat('plastic'));
  sticker(g, part, L * 0.7, W * 0.7, T / 2 + 0.005, { width: 320, height: 224, bg: '#e6e8ea', fg: '#0e1013', accent: look.accent ? css(look.accent) : null });
  const z = -T / 2 - 0.1;
  boxMM(g, -L / 2 - 0.3, L / 2 + 0.3, -W / 2 - 0.25, W / 2 + 0.25, z - 0.08, z, mat('caseSteel'));
  return g;
}

export function buildStorage(part, { theme } = {}) {
  const make = part.formFactor === 'M.2 2280' ? m2 : part.formFactor === '3.5in' ? hdd35 : sata25;
  const g = make(part, lookOf(part, theme));
  g.name = 'storage';
  return g;
}
