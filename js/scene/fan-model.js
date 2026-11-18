// Procedural fan: square frame with rubber corner pads and rear struts, hub with a label disc,
// swept and pitched blades in slightly see-through plastic, and the lighting of its product
// line (LINES): edge rings, halos, an infinity-mirror band, side light bars or a lit rotor.
// Local +Z is the airflow (outflow) side. Rotate the returned group to orient it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mat, finish } from './materials.js?v=fe48996dc3';
import { share, detail } from './resources.js?v=fe48996dc3';
import { isPale } from './look.js?v=fe48996dc3';

const geoCache = new Map();

function cached(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, share(make()));
  return geoCache.get(key);
}

function frameGeometry(size, depth) {
  return cached(`frame:${size}:${depth}`, () => {
    const h = size / 2;
    const r = size * 0.07;
    const s = new THREE.Shape();
    s.moveTo(-h + r, -h);
    s.lineTo(h - r, -h);
    s.quadraticCurveTo(h, -h, h, -h + r);
    s.lineTo(h, h - r);
    s.quadraticCurveTo(h, h, h - r, h);
    s.lineTo(-h + r, h);
    s.quadraticCurveTo(-h, h, -h, h - r);
    s.lineTo(-h, -h + r);
    s.quadraticCurveTo(-h, -h, -h + r, -h);
    const hole = new THREE.Path();
    hole.absarc(0, 0, size * 0.475, 0, Math.PI * 2, true);
    s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 28 });
    g.translate(0, 0, -depth / 2);
    return g;
  });
}

// Blade outlines: [chord, rake] as fractions of the fan size. `swept` is the common case-fan
// blade, `wide` the few broad blades of pressure fans, `sickle` many narrow curved ones.
const SHAPES = { swept: [0.27, 0], wide: [0.42, -0.04], sickle: [0.2, 0.09] };

// All blades of a rotor as one mesh (one draw call per fan instead of one per blade).
function bladesGeometry(size, count, shape) {
  return cached(`blades:${size}:${count}:${shape}`, () => {
    const rIn = size * 0.13;
    const rOut = size * 0.455;
    const [chord, rake] = SHAPES[shape] ?? SHAPES.swept;
    const c = size * chord * Math.min(1.25, 8 / count);
    const k = size * rake;
    // Swept outline: narrow at the hub, wide and raked back at the tip.
    const s = new THREE.Shape();
    s.moveTo(rIn, -c * 0.3);
    s.quadraticCurveTo(rIn + (rOut - rIn) * 0.55, -c * 0.62 + k * 0.5, rOut, -c * 0.2 + k);
    s.quadraticCurveTo(rOut * 1.01, c * 0.3 + k, rOut * 0.93, c * 0.62 + k);
    s.quadraticCurveTo(rIn + (rOut - rIn) * 0.4, c * 0.5 + k * 0.4, rIn, c * 0.3);
    const one = new THREE.ExtrudeGeometry(s, { depth: 0.09, bevelEnabled: false, curveSegments: 6 });
    one.translate(0, 0, -0.045);
    one.rotateX(0.5); // blade pitch
    const all = [];
    for (let i = 0; i < count; i++) all.push(one.clone().rotateZ((i / count) * Math.PI * 2));
    const g = mergeGeometries(all);
    one.dispose();
    all.forEach((x) => x.dispose());
    return g;
  });
}

// Four rubber pads on each face's corners, as one mesh.
function padGeometry(size, depth) {
  return cached(`pads:${size}:${depth}`, () => {
    const parts = [];
    const o = size / 2 - size * 0.065;
    const w = size * 0.1;
    for (const x of [-o, o]) for (const y of [-o, o]) for (const z of [-1, 1]) {
      parts.push(new THREE.BoxGeometry(w, w, 0.12).translate(x, y, z * (depth / 2 + 0.03)));
    }
    return mergeGeometries(parts);
  });
}

// Motor mount: four struts from the hub to the frame on the intake side.
function strutGeometry(size, depth) {
  return cached(`struts:${size}:${depth}`, () => {
    const parts = [];
    for (let i = 0; i < 4; i++) {
      parts.push(new THREE.BoxGeometry(size * 0.36, size * 0.035, 0.22)
        .translate(size * 0.3, 0, -depth / 2 + 0.13).rotateZ(Math.PI / 4 + (i * Math.PI) / 2 + 0.25));
    }
    parts.push(new THREE.CylinderGeometry(size * 0.15, size * 0.15, 0.22, 24).rotateX(Math.PI / 2).translate(0, 0, -depth / 2 + 0.13));
    return mergeGeometries(parts);
  });
}

// Light bars along two opposite frame edges, showing on both faces and the sides.
function sideBars(size, depth) {
  return cached(`bars:${size}:${depth}`, () => mergeGeometries([-1, 1].map((sy) => new THREE.BoxGeometry(size * 0.84, 0.2, depth + 0.04).translate(0, sy * (size / 2 - 0.08), 0))));
}

// Look per fan line (look.style in the data). Colours are look.js names; `light` is where the
// LEDs sit: 'edge' thin rings in the frame, 'halo' wide rings on both faces, 'infinity' a
// mirror band with LED lines, 'sides' light bars along two frame edges, 'blades' a lit rotor.
const LINES = {
  noctua: { frame: 'beige', blade: 'brown', pad: 'brown', blades: 9 },
  'noctua-redux': { frame: 'grey', blade: 0x8b9097, pad: 'gunmetal', blades: 9 },
  'arctic-p': { shape: 'wide', blades: 5, pads: false },
  'lianli-unifan-sl': { light: 'sides', links: true, blades: 7, pads: false },
  'lianli-unifan-tl': { light: 'infinity', links: true, blades: 7, pads: false },
  'corsair-rx': { light: 'blades', blades: 7 },
  'bequiet-silent-wings': { blades: 7, pads: false },
  'thermalright-tl': { light: 'blades', blades: 9 },
  'deepcool-fc': { light: 'blades', blades: 9 },
  'cm-sickleflow': { light: 'blades', shape: 'sickle', blades: 9 },
  'phanteks-d30': { light: 'halo', blades: 7, pads: false },
};

/**
 * makeFan() options for a fan line.
 * @param {{style?: string, colour?: string, themed?: boolean}} look lookOf(part), or a plain { style, colour }
 * @param {{lit?: boolean, blades?: number|null}} o lit: this part has LEDs (a line with no
 *   lighting of its own then gets an edge ring); blades: blade count from the data
 * @returns {object} spread into makeFan's opts, together with `led` / `soft`
 */
export function fanLook(look, { lit = false, blades = null } = {}) {
  const line = LINES[look?.style] ?? {};
  const colour = look?.themed || !line.frame ? look?.colour ?? 'black' : line.frame;
  const pale = isPale(colour);
  const light = lit ? line.light ?? 'edge' : null;
  return {
    blades: blades ?? line.blades ?? null,
    shape: line.shape ?? 'swept',
    frameMat: finish('plastic', colour),
    bladeMat: finish('blade', look?.themed || !line.blade ? (pale ? colour : 'black') : line.blade),
    padMat: line.pads === false ? null : finish('plastic', line.pad ?? (pale ? 'grey' : 0x0b0c0e)),
    links: !!line.links,
    light,
  };
}

const HSL = { h: 0, s: 0, l: 0 };

/**
 * @param {number} size  frame size in cm (12 = 120 mm fan)
 * @param {number} depth thickness in cm (2.5 = 25 mm)
 * @param {{frame?: boolean, ring?: boolean, blades?: number|null, led?: THREE.Material, soft?: THREE.Material,
 *   shape?: string, light?: string|null, links?: boolean, frameMat?: THREE.Material, bladeMat?: THREE.Material, padMat?: THREE.Material|null}} opts
 *   led: material for the LEDs (an owned ledMaterial() so the part can be recoloured);
 *   soft: an owned diffuserMaterial() for frosted lit parts; the rest comes from fanLook()
 * @returns {{group: THREE.Group, rotor: THREE.Group}}
 */
export function makeFan(size = 12, depth = 2.5, opts = {}) {
  const { frame = true, ring = true, led = mat('ledWhite'), soft = led, shape = 'swept', links = false } = opts;
  const blades = opts.blades ?? (frame ? 7 : 9);
  const light = opts.light === undefined ? (ring ? 'edge' : null) : opts.light;
  const frameMat = opts.frameMat ?? mat('plastic');
  const padMat = opts.padMat === undefined ? mat('rubber') : opts.padMat;
  const litRotor = light === 'blades';
  const group = new THREE.Group();
  group.name = 'fan';

  if (frame) {
    const f = new THREE.Mesh(frameGeometry(size, depth), frameMat);
    f.castShadow = true;
    f.receiveShadow = true;
    group.add(f);
    // Motor struts, with the corner pads where the fan has them (one draw call per fan).
    const extras = padMat
      ? cached(`extras:${size}:${depth}`, () => mergeGeometries([padGeometry(size, depth), strutGeometry(size, depth)]))
      : strutGeometry(size, depth);
    group.add(detail(new THREE.Mesh(extras, padMat ?? frameMat), 1));
    // Daisy-chain fans: the interlocking contact keys on two opposite sides.
    if (links) {
      const keys = cached(`links:${size}:${depth}`, () => mergeGeometries([-1, 1].flatMap((sx) => [-1, 1].map((sy) => new THREE.BoxGeometry(0.16, size * 0.16, depth * 0.5).translate(sx * (size / 2 + 0.05), sy * size * 0.26, 0)))));
      group.add(detail(new THREE.Mesh(keys, mat('steelBright')), 1));
    }
  }

  const rotor = new THREE.Group();
  rotor.name = 'rotor';
  if (light === 'infinity') rotor.scale.set(0.86, 0.86, 1); // a smaller rotor inside the mirror band
  const hub = new THREE.Mesh(
    cached(`hub:${size}:${depth}`, () => new THREE.CylinderGeometry(size * 0.14, size * 0.14, depth * 0.8, 32).rotateX(Math.PI / 2)),
    litRotor ? soft : mat('plasticGloss'),
  );
  rotor.add(hub);
  const cap = new THREE.Mesh(cached(`cap:${size}`, () => new THREE.CircleGeometry(size * 0.1, 28)), mat('aluLight'));
  cap.position.z = depth * 0.4 + 0.01;
  rotor.add(detail(cap, 1));
  const bladeMat = litRotor ? soft : opts.bladeMat ?? mat('fanBlade');
  const b = new THREE.Mesh(bladesGeometry(size, blades, shape), bladeMat);
  b.castShadow = true;
  rotor.add(b);
  group.add(rotor);
  // Blur disc: invisible at rest, fades in as the fan speeds up. Dark, so not over lit or pale blades.
  if (!litRotor && bladeMat.color.getHSL(HSL).l < 0.3) {
    const blur = new THREE.Mesh(cached(`blur:${size}`, () => new THREE.CircleGeometry(size * 0.455, 40)), mat('fanBlur'));
    blur.position.z = depth * 0.42;
    blur.castShadow = false;
    blur.renderOrder = 1;
    group.add(blur);
  }

  if (!frame || !light) return { group, rotor };
  const add = (geo, material, z = 0) => {
    const m = new THREE.Mesh(geo, material);
    m.position.z = z;
    group.add(m);
    return m;
  };
  if (light === 'edge') {
    const ringGeo = cached(`ring:${size}`, () => new THREE.TorusGeometry(size * 0.468, 0.09, 8, 72));
    for (const side of [1, -1]) add(ringGeo, led, side * (depth / 2 - 0.15));
  } else if (light === 'halo') {
    // Wide frosted rings on both faces.
    const halo = cached(`halo:${size}`, () => new THREE.RingGeometry(size * 0.44, size * 0.497, 64));
    add(halo, soft, depth / 2 + 0.012);
    add(halo, soft, -depth / 2 - 0.012).rotation.y = Math.PI;
  } else if (light === 'infinity') {
    // Mirror band around a smaller rotor, with LED lines repeating inside it.
    add(cached(`band:${size}`, () => new THREE.RingGeometry(size * 0.385, size * 0.478, 64)), mat('plasticGloss'), depth / 2 - 0.06);
    const lines = cached(`inf:${size}`, () => mergeGeometries([0.4, 0.43, 0.46].map((r) => new THREE.TorusGeometry(size * r, 0.03, 6, 72))));
    add(lines, led, depth / 2 - 0.04);
    add(sideBars(size, depth), soft);
  } else if (light === 'sides') {
    add(sideBars(size, depth), soft);
  } else if (litRotor) {
    // LEDs in the hub light the frosted rotor from the middle.
    rotor.add(new THREE.Mesh(cached(`hubled:${size}`, () => new THREE.TorusGeometry(size * 0.145, 0.05, 6, 40)), led));
  }
  return { group, rotor };
}
