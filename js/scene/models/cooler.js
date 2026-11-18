// CPU coolers at their real height from the data, in the design of their product line
// (look.style -> TOWERS / PUMPS).
// Air: tower (fin stack along the height, heatpipes, 1 fan on the front face; 2 fans = dual
// tower with a middle fan) or low-profile top-down (under 8 cm); fin colour, top cover and
// fan line per brand. AIO: pump block in the brand's shape (round, square, block) with its
// cap (LED ring, lit cap, infinity mirror, LCD) plus a separate radiator unit with its fans
// (units[1]); the layout places the radiator in the case and build-scene draws the tubes.
// Head local: origin = socket centre on the board, +X = board u (case front), +Y = up the board, +Z = out.
import * as THREE from 'three';
import { mat, finish, ledMaterial, diffuserMaterial, screenMaterial } from '../materials.js?v=733eefba1e';
import { boxMM, instancedBoxes, instanced, cylinderZ, detail, share } from '../resources.js?v=733eefba1e';
import { makeFan, fanLook } from '../fan-model.js?v=733eefba1e';
import { IHS_TOP } from './cpu.js?v=733eefba1e';
import { AIO_HEAD_H } from '../layout-board.js?v=733eefba1e';
import { radiatorSpec } from '../layout-fans.js?v=733eefba1e';
import { lookOf, isPale } from '../look.js?v=733eefba1e';

const DEFAULT_H = 15.5;

// top: 'none' = bare fins with the heatpipe ends showing, 'cover' = a flat cap, 'grid' = a
// cap with a checker pattern. fan: the fan line (fan-model.js) and its colour.
const TOWERS = {
  'deepcool-ag': { top: 'none' },
  'deepcool-ak': { top: 'grid' },
  thermalright: { top: 'none', fanColour: 'grey' },
  'arctic-freezer': { top: 'cover', fan: 'arctic-p' },
  'cm-hyper': { top: 'cover', fan: 'cm-sickleflow' },
  'id-cooling': { top: 'cover' },
  noctua: { top: 'none', fan: 'noctua' },
  'noctua-redux': { top: 'none', fan: 'noctua-redux' },
  'bequiet-pure-rock': { top: 'cover', fan: 'bequiet-silent-wings' },
  'bequiet-dark-rock': { top: 'cover', fan: 'bequiet-silent-wings', shell: true },
};
// shape: the pump block's outline. cap: what is on top of it. fan: the radiator fans' line.
const PUMPS = {
  'corsair-h': { shape: 'round', cap: 'ring', fan: 'corsair-rx' },
  'corsair-capellix': { shape: 'square', cap: 'glow', fan: 'corsair-rx' },
  'corsair-nautilus': { shape: 'round', cap: 'plain' },
  'nzxt-kraken-120': { shape: 'round', cap: 'ring' },
  'nzxt-kraken': { shape: 'round', cap: 'lcd-small' },
  'nzxt-kraken-elite': { shape: 'round', cap: 'lcd' },
  'cm-masterliquid': { shape: 'round', cap: 'glow', fan: 'cm-sickleflow' },
  'deepcool-le': { shape: 'square', cap: 'glow', fan: 'deepcool-fc' },
  'deepcool-lt': { shape: 'square', cap: 'infinity' },
  'arctic-liquid-freezer': { shape: 'block', cap: 'plain', fan: 'arctic-p' },
  'msi-coreliquid': { shape: 'round', cap: 'glow', fan: 'deepcool-fc' },
  'asus-tuf-lc': { shape: 'round', cap: 'glow', fan: 'deepcool-fc' },
  'lianli-galahad': { shape: 'round', cap: 'infinity' },
  'rog-ryujin': { shape: 'square', cap: 'lcd', size: 8.2 },
};

const finMat = (colour) => (colour === 'silver' || !colour ? mat('aluLight') : finish('heatsink', colour));

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

// Fans of a cooler: the line's own fan, lit where the data says the fans are.
function fanMaker(part, look, lineFan, fanColour, leds) {
  const lit = !!part.rgb && look.has('fans', true);
  const colour = look.themed ? look.colour : fanColour ?? (look.colour === 'white' ? 'white' : 'black');
  const style = fanLook({ style: lineFan, colour, themed: look.themed }, { lit });
  const soft = lit && style.light !== 'edge' ? diffuserMaterial({ opacity: style.light === 'blades' ? 0.9 : 1 }) : null;
  const led = lit ? ledMaterial() : null;
  leds.push(...[led, soft].filter(Boolean));
  return (size, depth) => makeFan(size, depth, { ...style, blades: style.blades ?? (size >= 13 ? 7 : 9), led: led ?? undefined, soft: soft ?? undefined });
}

function tower(g, part, h, look, line, fan, rotors) {
  const fs = (part.fanSizeMM ?? 120) / 10;
  const dual = (part.fans ?? 1) >= 2;
  const width = fs + 0.4;
  const z0 = Math.min(3.2, h * 0.3);
  const covered = line.top !== 'none';
  const z1 = h - (covered ? 0.45 : 0.25);
  const d = dual ? 4.4 : 5.0;
  const gap = 2.7;
  // Stacks along x (airflow front -> rear), centred over the socket with the front fan included.
  const stacks = dual ? [[-gap / 2 - d, -gap / 2], [gap / 2, gap / 2 + d]] : [[-d / 2, d / 2]];
  const shift = -1.3;
  const fins = [];
  const cover = finish(look.colour === 'white' ? 'plastic' : 'gloss', look.colour === 'white' ? 'white' : 'black');
  for (const [a, b] of stacks) {
    for (let z = z0; z < z1; z += 0.22) fins.push([a + shift, b + shift, -width / 2, width / 2, z, z + 0.045]);
    if (covered) boxMM(g, a + shift, b + shift, -width / 2, width / 2, z1, h, cover);
    // Dark Rock style: side panels closing the stack.
    if (line.shell) for (const s of [-1, 1]) boxMM(g, a + shift, b + shift, s * (width / 2) - 0.06, s * (width / 2) + 0.06, z0, z1, cover);
  }
  instancedBoxes(g, fins, finMat(look.colour));
  if (line.top === 'grid') {
    // Checker pattern on the cap.
    const cells = [];
    for (const [a, b] of stacks) for (let x = a + 0.5, i = 0; x + 0.6 < b; x += 0.8, i++) for (let y = -width / 2 + 0.6, j = 0; y + 0.6 < width / 2; y += 0.8, j++) if ((i + j) % 2 === 0) cells.push([x + shift, x + shift + 0.6, y, y + 0.6, h, h + 0.02]);
    detail(instancedBoxes(g, cells, mat('chip'), { cast: false }), 1);
  }
  // Heatpipes: up from the base into each stack; their ends show above bare fins.
  const pipes = dual ? 6 : 4;
  const len = h - IHS_TOP - (covered ? 0.5 : 0);
  const list = [];
  for (let i = 0; i < pipes; i++) {
    const y = (i - (pipes - 1) / 2) * (width / (pipes + 1));
    const [a, b] = stacks[i % stacks.length];
    for (const x of [a + shift + 1.0, b + shift - 1.0]) list.push({ p: [x, y, IHS_TOP + 0.25 + len / 2], s: [1, 1, len] });
  }
  instanced(g, cylinderZ(0.3, 1, 12), list, look.colour === 'black' ? finish('heatsink', 'black') : mat('nickel'));
  base(g);
  // Fans blow from the front face toward the rear exhaust; wire clips hold them on the fins.
  const clips = [];
  const fz = Math.min((z0 + z1) / 2, h - fs / 2);
  const mounts = dual ? [stacks[1][1] + 1.25, 0] : [stacks[0][1] + 1.25];
  for (const x of mounts) {
    const f = fan(fs, 2.5);
    f.group.rotation.y = -Math.PI / 2;
    f.group.position.set(x + shift, 0, fz);
    g.add(f.group);
    rotors.push(f.rotor);
    for (const y of [-fs / 2 - 0.08, fs / 2 + 0.02]) for (const dz of [-fs * 0.3, fs * 0.3]) clips.push([x + shift - 3.2, x + shift + 1.2, y, y + 0.06, fz + dz - 0.03, fz + dz + 0.03]);
  }
  detail(instancedBoxes(g, clips, mat('steelBright'), { cast: false }), 1);
}

function lowProfile(g, part, h, look, fan, rotors) {
  const fs = (part.fanSizeMM ?? 92) / 10;
  const ft = h < 5 ? 1.4 : 1.5;
  const z1 = h - ft;
  const fins = [];
  for (let x = -fs / 2; x < fs / 2; x += 0.2) fins.push([x, x + 0.04, -fs / 2, fs / 2, IHS_TOP + 0.6, z1]);
  instancedBoxes(g, fins, finMat(look.colour));
  base(g);
  const f = fan(fs, ft);
  f.group.rotation.x = Math.PI; // blows down onto the fins
  f.group.position.z = z1 + ft / 2;
  g.add(f.group);
  rotors.push(f.rotor);
}

// ---------------------------------------------------------------- AIO pump block
const geo = new Map();
const cachedGeo = (key, make) => {
  if (!geo.has(key)) geo.set(key, share(make()));
  return geo.get(key);
};
function roundedSquare(size, radius) {
  const h = size / 2;
  const s = new THREE.Shape();
  s.moveTo(-h + radius, -h);
  s.lineTo(h - radius, -h); s.quadraticCurveTo(h, -h, h, -h + radius);
  s.lineTo(h, h - radius); s.quadraticCurveTo(h, h, h - radius, h);
  s.lineTo(-h + radius, h); s.quadraticCurveTo(-h, h, -h, h - radius);
  s.lineTo(-h, -h + radius); s.quadraticCurveTo(-h, -h, -h + radius, -h);
  return s;
}
// Square caps: a prism with rounded corners, or the flat sheet / outline ring of the same shape.
const squareBody = (size, depth) => cachedGeo(`sq:${size}:${depth}`, () => new THREE.ExtrudeGeometry(roundedSquare(size, size * 0.16), { depth, bevelEnabled: false, curveSegments: 8 }));
const squareFace = (size) => cachedGeo(`sqf:${size}`, () => new THREE.ShapeGeometry(roundedSquare(size, size * 0.16), 8));
function squareRing(size, w) {
  return cachedGeo(`sqr:${size}:${w}`, () => {
    const s = roundedSquare(size, size * 0.16);
    s.holes.push(new THREE.Path(roundedSquare(size - w * 2, (size - w * 2) * 0.16).getPoints(8).reverse()));
    return new THREE.ShapeGeometry(s, 8);
  });
}

// What a pump screen shows: a temperature read-out, drawn once per model.
function readout() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#000';
  x.fillRect(0, 0, 128, 128);
  x.strokeStyle = '#ff5a1f';
  x.lineWidth = 7;
  x.beginPath();
  x.arc(64, 64, 52, Math.PI * 0.75, Math.PI * 1.9);
  x.stroke();
  x.strokeStyle = '#2a2f36';
  x.beginPath();
  x.arc(64, 64, 52, Math.PI * 1.9, Math.PI * 2.25);
  x.stroke();
  x.fillStyle = '#e7eaee';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = '600 44px "IBM Plex Mono", monospace';
  x.fillText('34°', 66, 62);
  x.fillStyle = '#8a93a0';
  x.font = '500 13px "IBM Plex Mono", monospace';
  x.fillText('CPU', 64, 92);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function pump(part, look, line, leds) {
  const g = new THREE.Group();
  g.name = 'pump';
  boxMM(g, -4.6, 4.6, -0.7, 0.7, IHS_TOP, IHS_TOP + 0.35, mat('steelBright'));
  boxMM(g, -2.4, 2.4, -2.4, 2.4, IHS_TOP - 0.02, IHS_TOP + 0.3, mat('copper'));
  mountScrews(g, IHS_TOP + 0.35);
  const top = AIO_HEAD_H;
  const white = look.colour === 'white';
  const shell = finish('gloss', white ? 'white' : 'black');
  const bodyH = top - IHS_TOP - 0.2;
  const zb = IHS_TOP + 0.0;
  const round = line.shape === 'round';
  const size = line.size ?? 6.6;
  const add = (geometry, material, z, cast = false) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.z = z;
    m.castShadow = cast;
    g.add(m);
    return m;
  };
  if (round) add(cylinderZ(3.3, bodyH, 48), shell, zb + bodyH / 2, true);
  else if (line.shape === 'block') {
    // Arctic style: a long block with a small fan for the board's VRM beside the pump.
    boxMM(g, -3.3, 3.3, -4.1, 3.0, zb, top - 0.2, shell);
    const vrm = makeFan(3.6, 1.0, { frame: false, blades: 9 });
    vrm.group.position.set(0, -2.1, top - 0.6);
    g.add(vrm.group);
    g.userData.rotor = vrm.rotor;
    add(new THREE.RingGeometry(1.75, 2.0, 32), mat('chip'), top - 0.19).position.y = -2.1;
  } else add(squareBody(size, bodyH), shell, zb, true);

  // ---- the cap
  const lit = !!part.rgb && look.has('pump', true);
  const zt = top - 0.2;
  const face = (r, material, z) => add(round ? cylinderZ(r, 0.2, 48) : squareBody(r * 2, 0.2), material, round ? z + 0.1 : z);
  const r = round ? 3.0 : size / 2 - 0.3;
  if (line.cap === 'lcd' || line.cap === 'lcd-small') {
    face(r, mat('chip'), zt);
    const screen = screenMaterial(readout());
    leds.push(screen);
    const small = line.cap === 'lcd-small';
    const s = add(small ? new THREE.PlaneGeometry(2.9, 2.9) : round ? new THREE.CircleGeometry(r - 0.35, 48) : squareFace(r * 2 - 0.9), screen, top + 0.012);
    s.name = 'pump-screen';
    if (look.has('ring') && part.rgb) {
      const led = ledMaterial();
      leds.push(led);
      add(new THREE.TorusGeometry(r + 0.12, 0.09, 8, 64), led, top - 0.05).name = 'pump-ring';
    }
  } else if (line.cap === 'glow' && lit) {
    // A frosted cap lit from below, in a dark bezel.
    const soft = diffuserMaterial();
    leds.push(soft);
    face(r, mat('chip'), zt - 0.02);
    add(round ? new THREE.CircleGeometry(r - 0.3, 48) : squareFace(r * 2 - 0.6), soft, top + 0.012).name = 'pump-ring';
  } else if (line.cap === 'infinity' && lit) {
    // Mirror cap with LED outlines that repeat inward.
    const led = ledMaterial();
    leds.push(led);
    face(r, finish('mirror', 0x1a1c20), zt);
    for (const k of [1, 0.74, 0.5]) {
      const ring = round ? new THREE.TorusGeometry((r - 0.25) * k, 0.045 * k + 0.02, 6, 64) : squareRing((r * 2 - 0.5) * k, 0.07);
      add(ring, led, top + 0.014).name = 'pump-ring';
    }
  } else if (line.shape === 'block') {
    boxMM(g, -2.9, 2.9, 0.1, 2.7, zt, top, mat('chip'));
  } else {
    face(r, mat('chip'), zt);
    const led = lit && line.cap === 'ring' ? ledMaterial() : null;
    if (led) leds.push(led);
    add(round ? new THREE.TorusGeometry(2.55, 0.12, 8, 64) : squareRing(r * 2 - 0.6, 0.14), led ?? mat('aluLight'), top + 0.02).name = 'pump-ring';
  }

  // Tube fittings on the case-front side (where layout-board.js starts the tubes).
  for (const y of [-1.1, 1.1]) {
    const fit = new THREE.Mesh(cylinderZ(0.55, 1.4, 16), white ? finish('plastic', 'white') : mat('plastic'));
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

function radiator(part, look, fan, rotors) {
  const s = radiatorSpec(part);
  const g = new THREE.Group();
  g.name = 'radiator';
  const half = s.stack / 2;
  const zr0 = half - s.thick;
  const tank = 1.85;
  const white = look.colour === 'white';
  const tankMat = white ? finish('plastic', 'white') : mat('plastic');
  const sideMat = white ? finish('alu', 'white') : mat('frameAlu');
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
  const shell = [];
  const sides = [];
  for (const sgn of [-1, 1]) {
    shell.push([sgn * (s.len / 2 - tank), sgn * s.len / 2, -s.width / 2, s.width / 2, zr0, half]);
    sides.push([-s.len / 2 + tank, s.len / 2 - tank, sgn * (s.width / 2 - 0.25), sgn * s.width / 2, zr0, half]);
  }
  instancedBoxes(g, shell, tankMat);
  instancedBoxes(g, sides, sideMat);
  const fs = s.fanMM / 10;
  for (let i = 0; i < s.n; i++) {
    const f = fan(fs, s.fanT);
    f.group.position.set((i - (s.n - 1) / 2) * fs, 0, -half + s.fanT / 2);
    g.add(f.group);
    rotors.push(f.rotor);
  }
  return g;
}

/** Coolant tube look for build-scene: { colour, radius } (white sleeving on white coolers). */
export function tubeLook(part, theme) {
  const look = lookOf(part, theme);
  return { colour: look.colour === 'white' ? 'white' : 'black', radius: look.style === 'arctic-liquid-freezer' ? 0.62 : 0.55 };
}

export function buildCooler(part, { theme } = {}) {
  const g = new THREE.Group();
  g.name = 'cooler';
  const look = lookOf(part, theme);
  const leds = [];
  const rotors = [];
  const approx = [];
  if (!look.style) approx.push('design not in the data, a plain cooler is drawn');
  if (part.type === 'aio') {
    const line = PUMPS[look.style] ?? { shape: 'round', cap: 'ring' };
    const fan = fanMaker(part, look, line.fan, null, leds);
    const head = pump(part, look, line, leds);
    if (head.userData.rotor) rotors.push(head.userData.rotor);
    const rad = radiator(part, look, fan, rotors);
    g.add(head, rad);
    g.userData.units = [head, rad];
    if (!part.radiatorThicknessMM) approx.push('radiator thickness 27 mm is a typical size');
  } else {
    const line = TOWERS[look.style] ?? { top: 'cover' };
    const fan = fanMaker(part, look, line.fan, line.fanColour, leds);
    const h = part.heightMM ? part.heightMM / 10 : DEFAULT_H;
    if (!part.heightMM) approx.push(`height not in the data, ${DEFAULT_H * 10} mm assumed`);
    if (h < 8) lowProfile(g, part, h, look, fan, rotors);
    else {
      tower(g, part, h, look, line, fan, rotors);
      if ((part.fans ?? 1) >= 2) approx.push('tower layout drawn from the fan count');
    }
  }
  g.userData.rotors = rotors;
  g.userData.leds = leds;
  g.userData.approx = approx;
  return g;
}
