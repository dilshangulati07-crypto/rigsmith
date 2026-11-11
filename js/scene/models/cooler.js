// CPU coolers at their real height from the data.
// Air: tower (fin stack along the height, heatpipes, 1 fan on the front face; 2 fans = dual
// tower with a middle fan) or low-profile top-down (under 8 cm). AIO: pump block with a
// logo ring on the socket plus a separate radiator unit with its fans (units[1]); the layout
// places the radiator in the case and build-scene draws the tubes.
// Head local: origin = socket centre on the board, +X = board u (case front), +Y = up the board, +Z = out.
import * as THREE from 'three';
import { mat, ledMaterial } from '../materials.js';
import { boxMM, instancedBoxes, instanced, cylinderZ, detail } from '../resources.js';
import { makeFan } from '../fan-model.js';
import { IHS_TOP } from './cpu.js';
import { AIO_HEAD_H } from '../layout-board.js';
import { radiatorSpec, RAD_THICK } from '../layout-fans.js';

const DEFAULT_H = 15.5;

// Cold plate (nickel-plated copper), the mounting bar across it, and its two spring screws.
function base(g) {
  boxMM(g, -2.0, 2.0, -2.0, 2.0, IHS_TOP, IHS_TOP + 0.7, mat('nickel'));
  boxMM(g, -4.6, 4.6, -0.6, 0.6, IHS_TOP + 0.2, IHS_TOP + 0.5, mat('steelBright'));
  mountScrews(g, IHS_TOP + 0.5);
}
function mountScrews(g, z) {
  const d = new THREE.Group();
  instanced(d, cylinderZ(0.3, 0.9, 12), [-4.1, 4.1].map((x) => ({ p: [x, 0, z + 0.45] })), mat('heatsink'));
  instanced(d, cylinderZ(0.38, 0.14, 12), [-4.1, 4.1].map((x) => ({ p: [x, 0, z + 0.95] })), mat('steelBright'));
  g.add(detail(d, 1));
}

function fanFor(part, size, depth, led) {
  return makeFan(size, depth, { ring: !!led, led: led ?? undefined, blades: size >= 13 ? 7 : 9 });
}

function tower(g, part, h, led, rotors) {
  const fs = (part.fanSizeMM ?? 120) / 10;
  const dual = (part.fans ?? 1) >= 2;
  const width = fs + 0.4;
  const z0 = Math.min(3.2, h * 0.3);
  const z1 = h - 0.45;
  const d = dual ? 4.4 : 5.0;
  const gap = 2.7;
  // Stacks along x (airflow front -> rear), centred over the socket with the front fan included.
  const stacks = dual ? [[-gap / 2 - d, -gap / 2], [gap / 2, gap / 2 + d]] : [[-d / 2, d / 2]];
  const shift = -1.3;
  const fins = [];
  for (const [a, b] of stacks) {
    for (let z = z0; z < z1; z += 0.22) fins.push([a + shift, b + shift, -width / 2, width / 2, z, z + 0.045]);
    boxMM(g, a + shift, b + shift, -width / 2, width / 2, z1, h, mat('plasticGloss'));
  }
  instancedBoxes(g, fins, mat('aluLight'));
  // Wire clips that hold each fan against the fins.
  const clips = [];
  // Heatpipes: up from the base into each stack, capped above the top cover.
  const pipes = dual ? 6 : 4;
  for (let i = 0; i < pipes; i++) {
    const y = (i - (pipes - 1) / 2) * (width / (pipes + 1));
    const [a, b] = stacks[i % stacks.length];
    for (const x of [a + shift + 1.0, b + shift - 1.0]) {
      const p = new THREE.Mesh(cylinderZ(0.3, h - IHS_TOP - 0.5, 12), mat('nickel'));
      p.position.set(x, y, (IHS_TOP + h - 0.5) / 2 + 0.25);
      p.castShadow = true;
      g.add(p);
    }
  }
  base(g);
  // Fans blow from the front face toward the rear exhaust.
  const fz = Math.min((z0 + z1) / 2, h - fs / 2);
  const mounts = dual ? [stacks[1][1] + 1.25, 0] : [stacks[0][1] + 1.25];
  for (const x of mounts) {
    const f = fanFor(part, fs, 2.5, led);
    f.group.rotation.y = -Math.PI / 2;
    f.group.position.set(x + shift, 0, fz);
    g.add(f.group);
    rotors.push(f.rotor);
    for (const y of [-fs / 2 - 0.08, fs / 2 + 0.02]) for (const dz of [-fs * 0.3, fs * 0.3]) clips.push([x + shift - 3.2, x + shift + 1.2, y, y + 0.06, fz + dz - 0.03, fz + dz + 0.03]);
  }
  detail(instancedBoxes(g, clips, mat('steelBright'), { cast: false }), 1);
}

function lowProfile(g, part, h, led, rotors) {
  const fs = (part.fanSizeMM ?? 92) / 10;
  const ft = h < 5 ? 1.4 : 1.5;
  const z1 = h - ft;
  const fins = [];
  for (let x = -fs / 2; x < fs / 2; x += 0.2) fins.push([x, x + 0.04, -fs / 2, fs / 2, IHS_TOP + 0.6, z1]);
  instancedBoxes(g, fins, mat('aluLight'));
  base(g);
  const f = fanFor(part, fs, ft, led);
  f.group.rotation.x = Math.PI; // blows down onto the fins
  f.group.position.z = z1 + ft / 2;
  g.add(f.group);
  rotors.push(f.rotor);
}

function pump(part, led) {
  const g = new THREE.Group();
  g.name = 'pump';
  boxMM(g, -4.6, 4.6, -0.7, 0.7, IHS_TOP, IHS_TOP + 0.35, mat('steelBright'));
  boxMM(g, -2.4, 2.4, -2.4, 2.4, IHS_TOP - 0.02, IHS_TOP + 0.3, mat('copper'));
  mountScrews(g, IHS_TOP + 0.35);
  const top = AIO_HEAD_H;
  const body = new THREE.Mesh(cylinderZ(3.3, top - IHS_TOP - 0.2, 48), mat('plasticGloss'));
  body.position.z = (IHS_TOP + top - 0.2) / 2;
  body.castShadow = true;
  g.add(body);
  const cap = new THREE.Mesh(cylinderZ(3.0, 0.2, 48), mat('chip'));
  cap.position.z = top - 0.1;
  g.add(cap);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.55, 0.12, 8, 64), led ?? mat('aluLight'));
  ring.position.z = top + 0.02;
  ring.name = 'pump-ring';
  g.add(ring);
  // Tube fittings on the case-front side (where layout-board.js starts the tubes).
  for (const y of [-1.1, 1.1]) {
    const fit = new THREE.Mesh(cylinderZ(0.55, 1.4, 16), mat('plastic'));
    fit.rotation.y = Math.PI / 2;
    fit.position.set(3.1, y, top - 1.6);
    g.add(fit);
    // Swivel fitting: a metal collar where the tube meets the pump.
    const collar = new THREE.Mesh(cylinderZ(0.66, 0.5, 16), mat('steelBright'));
    collar.rotation.y = Math.PI / 2;
    collar.position.set(3.75, y, top - 1.6);
    g.add(detail(collar, 1));
  }
  return g;
}

function radiator(part, led, rotors) {
  const s = radiatorSpec(part);
  const g = new THREE.Group();
  g.name = 'radiator';
  const half = s.stack / 2;
  const zr0 = half - RAD_THICK;
  const tank = 1.85;
  // Core: folded fins between flat tubes (a texture on the two faces), tanks at both ends.
  boxMM(g, -s.len / 2 + tank, s.len / 2 - tank, -s.width / 2 + 0.25, s.width / 2 - 0.25, zr0 + 0.1, half - 0.1, mat('radiatorCore'));
  const tubes = [];
  for (let y = -s.width / 2 + 0.6; y < s.width / 2 - 0.5; y += 0.75) tubes.push([-s.len / 2 + tank, s.len / 2 - tank, y, y + 0.18, zr0 + 0.05, half - 0.05]);
  detail(instancedBoxes(g, tubes, mat('frameAlu'), { cast: false }), 2);
  // Tube fittings on one tank and the fill-port screw.
  const fit = new THREE.Group();
  instanced(fit, cylinderZ(0.62, 1.1, 16), [-1.1, 1.1].map((y) => ({ p: [-s.len / 2 + tank / 2, y, half + 0.45] })), mat('steelBright'));
  instanced(fit, cylinderZ(0.3, 0.1, 10), [{ p: [s.len / 2 - tank / 2, 0, half + 0.02] }], mat('steelBright'));
  g.add(detail(fit, 1));
  for (const sgn of [-1, 1]) {
    boxMM(g, sgn * (s.len / 2 - tank), sgn * s.len / 2, -s.width / 2, s.width / 2, zr0, half, mat('plastic'));
    boxMM(g, -s.len / 2 + tank, s.len / 2 - tank, sgn * (s.width / 2 - 0.25), sgn * s.width / 2, zr0, half, mat('frameAlu'));
  }
  const fs = s.fanMM / 10;
  for (let i = 0; i < s.n; i++) {
    const f = fanFor(part, fs, s.fanT, led);
    f.group.position.set((i - (s.n - 1) / 2) * fs, 0, -half + s.fanT / 2);
    g.add(f.group);
    rotors.push(f.rotor);
  }
  return g;
}

export function buildCooler(part) {
  const g = new THREE.Group();
  g.name = 'cooler';
  const led = part.rgb ? ledMaterial() : null;
  const rotors = [];
  const approx = [];
  if (part.type === 'aio') {
    const head = pump(part, led);
    const rad = radiator(part, led, rotors);
    g.add(head, rad);
    g.userData.units = [head, rad];
    approx.push('radiator thickness 27 mm is a typical size');
  } else {
    const h = part.heightMM ? part.heightMM / 10 : DEFAULT_H;
    if (!part.heightMM) approx.push(`height not in the data, ${DEFAULT_H * 10} mm assumed`);
    if (h < 8) lowProfile(g, part, h, led, rotors);
    else {
      tower(g, part, h, led, rotors);
      if ((part.fans ?? 1) >= 2) approx.push('tower layout drawn from the fan count');
    }
  }
  g.userData.rotors = rotors;
  g.userData.leds = led ? [led] : [];
  g.userData.approx = approx;
  return g;
}
