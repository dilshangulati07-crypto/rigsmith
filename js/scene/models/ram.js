// Memory: one stick per module in the kit, at the real module height from the data, in the
// heatspreader design of its product line (look.style -> LINES): the outline of the spreader's
// top edge, the shape of the light bar on RGB kits, colour, and bare sticks for kits without one.
// Stick local: +X along the module, +Y = up out of the slot (height), +Z across; origin = slot centre on the board.
import * as THREE from 'three';
import { mat, finish, ledMaterial, diffuserMaterial } from '../materials.js?v=00a22f4faf';
import { boxMM, instancedBoxes, share, detail, textPlane } from '../resources.js?v=00a22f4faf';
import { RAM_LENGTH, ramModules } from '../layout-board.js?v=00a22f4faf';
import { lookOf, isPale } from '../look.js?v=00a22f4faf';

const DEFAULT_H = 3.4;
const SEAT = 0.3; // the module's bottom edge sits this far into the slot's height
const L = RAM_LENGTH;
const X0 = -L / 2 + 0.1;
const X1 = L / 2 - 0.1;

// top: outline of the spreader's top edge. bar: light bar on RGB kits ('full' = the whole top,
// 'wide' = a diffuser wider than the module, 'inset' = between metal end caps, 'dots' =
// separate LEDs in a metal top bar). stripe: a second-colour band along the side.
const LINES = {
  'fury-beast': { top: 'angled', text: 'FURY' },
  'fury-beast-rgb': { top: 'angled', bar: 'full', text: 'FURY' },
  'fury-renegade': { top: 'peaks', stripe: true, text: 'FURY' },
  'vengeance-lpx': { top: 'comb', text: 'VENGEANCE' },
  'vengeance-rgb-pro': { top: 'flat', bar: 'full', text: 'VENGEANCE' },
  vengeance: { top: 'chamfer', text: 'VENGEANCE' },
  'vengeance-rgb': { top: 'chamfer', bar: 'full', text: 'VENGEANCE' },
  dominator: { top: 'flat', bar: 'dots', text: 'DOMINATOR' },
  'ripjaws-v': { top: 'comb', text: 'RIPJAWS' },
  'ripjaws-s5': { top: 'chamfer', text: 'RIPJAWS' },
  'flare-x5': { top: 'chamfer', text: 'FLARE X' },
  'trident-z': { top: 'fins', bar: 'inset', stripe: true, text: 'TRIDENT Z' },
  'trident-z5': { top: 'swoop', bar: 'inset', stripe: true, text: 'TRIDENT Z5' },
  'tforce-vulcan': { top: 'peaks', colour: 'grey', text: 'T-FORCE' },
  'tforce-delta': { top: 'flat', bar: 'wide', text: 'T-FORCE' },
  'crucial-pro': { top: 'chamfer', text: 'CRUCIAL PRO' },
  bare: { bare: true },
};
const GENERIC = { top: 'chamfer', bar: 'full', text: null };

// Top edge of the spreader from X0 to X1 at height y, as [x, y] points (left to right).
const TOPS = {
  flat: (y) => [[X0, y], [X1, y]],
  chamfer: (y) => [[X0, y - 0.45], [X0 + 0.45, y], [X1 - 0.45, y], [X1, y - 0.45]],
  angled: (y) => [[X0, y - 0.8], [X0 + 1.3, y - 0.8], [X0 + 2.1, y], [X1 - 3.6, y], [X1 - 3.0, y - 0.4], [X1, y - 0.4]],
  peaks: (y) => [[X0, y - 0.7], [X0 + 0.7, y], [X0 + 4.6, y], [X0 + 5.2, y - 0.55], [X1 - 5.2, y - 0.55], [X1 - 4.6, y], [X1 - 0.7, y], [X1, y - 0.7]],
  swoop: (y) => [[X0, y - 1.1], [X0 + 1.6, y - 0.95], [X0 + 4.2, y - 0.35], [X0 + 6.5, y], [X1 - 0.5, y], [X1, y - 0.5]],
  comb: (y) => teeth(y, 11, 0.42, 0.5, 0.04),
  fins: (y) => teeth(y, 6, 0.6, 0.62, 0.18),
};
// n teeth of `depth`; `fill` = share of each pitch that is tooth; `slope` = how far the flanks lean.
function teeth(y, n, depth, fill, slope) {
  const pts = [[X0, y - depth]];
  const pitch = (X1 - X0) / n;
  for (let i = 0; i < n; i++) {
    const a = X0 + pitch * (i + (1 - fill) / 2);
    const b = a + pitch * fill;
    pts.push([a, y - depth], [a + slope, y], [b - slope, y], [b, y - depth]);
  }
  pts.push([X1, y - depth]);
  return pts;
}

const geoCache = new Map();
// One mesh for the whole spreader: the side outline extruded across the module's thickness.
function spreaderGeometry(top, y0, y1) {
  const key = `${top}:${y0}:${y1}`;
  if (!geoCache.has(key)) {
    const s = new THREE.Shape();
    s.moveTo(X0, y0);
    for (const [x, y] of (TOPS[top] ?? TOPS.flat)(y1)) s.lineTo(x, Math.max(y, y0 + 0.4));
    s.lineTo(X1, y0);
    s.lineTo(X0, y0);
    geoCache.set(key, share(new THREE.ExtrudeGeometry(s, { depth: 0.66, bevelEnabled: false }).translate(0, 0, -0.33)));
  }
  return geoCache.get(key);
}

function bareStick(u, pcb, pcbTop) {
  boxMM(u, -L / 2, L / 2, SEAT, pcbTop, -0.06, 0.06, pcb);
  const chips = [];
  for (let i = 0; i < 8; i++) {
    const x = -L / 2 + 1.0 + i * 1.5 + (i > 3 ? 0.6 : 0);
    chips.push([x, x + 1.1, SEAT + 0.9, SEAT + 2.1, 0.06, 0.16]);
  }
  instancedBoxes(u, chips, mat('chip'));
  boxMM(u, -3.2, 3.2, pcbTop - 0.75, pcbTop - 0.15, 0.06, 0.066, finish('flat', 'white'), { cast: false });
}

export function buildRAM(part, { theme } = {}) {
  const g = new THREE.Group();
  g.name = 'ram';
  const look = lookOf(part, theme);
  const line = LINES[look.style] ?? GENERIC;
  const h = part.heightMM ? part.heightMM / 10 : line.bare ? 3.12 : DEFAULT_H;
  const colour = look.colour ?? line.colour ?? 'black';
  const lit = !!part.rgb && look.zones?.length !== 0 && !line.bare;
  const bar = lit ? line.bar ?? 'full' : null;
  const body = finish(look.finish === 'metal' ? 'heatsink' : 'anodised', colour);
  const second = finish('bare', look.accent ?? (isPale(colour) ? 'grey' : 'silver'));
  const led = bar === 'dots' ? ledMaterial() : null;
  const soft = bar && bar !== 'dots' ? diffuserMaterial() : null;
  const top = SEAT + h;
  const barH = !bar ? 0 : bar === 'wide' ? 0.95 : bar === 'dots' ? 0.3 : 0.55;
  const y0 = SEAT + 0.45;
  const y1 = Math.round((top - barH) * 100) / 100;
  const units = [];
  for (let i = 0; i < ramModules(part); i++) {
    const u = new THREE.Group();
    u.name = `ram-${i}`;
    const pcbTop = Math.min(top - 0.2, SEAT + 3.1);
    boxMM(u, -L / 2 + 0.3, L / 2 - 0.3, SEAT, SEAT + 0.25, -0.065, 0.065, mat('gold'), { cast: false });
    if (line.bare) {
      bareStick(u, colour === 'green' ? finish('flat', 0x1d5c34) : mat('pcb'), pcbTop);
    } else {
      boxMM(u, -L / 2, L / 2, SEAT, Math.min(pcbTop, y0 + 0.2), -0.06, 0.06, mat('pcb'));
      const sp = new THREE.Mesh(spreaderGeometry(bar ? 'flat' : line.top, y0, y1), body);
      sp.castShadow = true;
      sp.receiveShadow = true;
      u.add(sp);
      if (line.stripe) boxMM(u, X0 + 0.6, X1 - 0.6, y0 + 0.35, y0 + (y1 - y0) * 0.45, -0.345, 0.345, second, { cast: false });
      if (bar === 'full') boxMM(u, X0 + 0.12, X1 - 0.12, y1, top, -0.3, 0.3, soft, { cast: false });
      else if (bar === 'wide') boxMM(u, X0 - 0.05, X1 + 0.05, y1, top, -0.42, 0.42, soft, { cast: false });
      else if (bar === 'inset') {
        boxMM(u, X0 + 1.1, X1 - 1.1, y1, top, -0.24, 0.24, soft, { cast: false });
        for (const [a, b] of [[X0, X0 + 1.1], [X1 - 1.1, X1]]) boxMM(u, a, b, y1, top - 0.08, -0.33, 0.33, body);
      } else if (bar === 'dots') {
        boxMM(u, X0, X1, y1, top, -0.33, 0.33, second);
        const dots = [];
        for (let k = 0; k < 12; k++) dots.push([X0 + 0.5 + k * 1.05, X0 + 1.0 + k * 1.05, top, top + 0.02, -0.18, 0.18]);
        instancedBoxes(u, dots, led, { cast: false });
      }
      if (line.text) {
        const t = textPlane(line.text, 4.2, 0.62, { fg: isPale(colour) ? '#3a3e45' : '#c9ced6', align: 'center' });
        t.position.set(0, y0 + (y1 - y0) * 0.72, 0.336);
        u.add(detail(t, 1));
      }
    }
    g.add(u);
    units.push(u);
  }
  g.userData.units = units;
  g.userData.leds = [led, soft].filter(Boolean);
  g.userData.approx = part.heightMM ? [] : [`height not in the data, ${h * 10} mm assumed`];
  return g;
}
