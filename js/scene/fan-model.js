// Procedural fan: square frame with rubber corner pads and rear struts, hub with a label disc,
// swept and pitched blades in slightly see-through plastic, optional LED ring.
// Local +Z is the airflow (outflow) side. Rotate the returned group to orient it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mat } from './materials.js';
import { share, detail } from './resources.js';

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

function bladeGeometry(size, depth) {
  return cached(`blade:${size}:${depth}`, () => {
    const rIn = size * 0.13;
    const rOut = size * 0.455;
    const c = size * 0.27;
    // Swept outline: narrow at the hub, wide and raked back at the tip.
    const s = new THREE.Shape();
    s.moveTo(rIn, -c * 0.3);
    s.quadraticCurveTo(rIn + (rOut - rIn) * 0.55, -c * 0.62, rOut, -c * 0.2);
    s.quadraticCurveTo(rOut * 1.01, c * 0.3, rOut * 0.93, c * 0.62);
    s.quadraticCurveTo(rIn + (rOut - rIn) * 0.4, c * 0.5, rIn, c * 0.3);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.09, bevelEnabled: false, curveSegments: 6 });
    g.translate(0, 0, -0.045);
    g.rotateX(0.5); // blade pitch
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

/**
 * @param {number} size  frame size in cm (12 = 120 mm fan)
 * @param {number} depth thickness in cm (2.5 = 25 mm)
 * @param {{frame?: boolean, ring?: boolean, blades?: number, led?: THREE.Material}} opts
 *   led: material for the LED ring (an owned ledMaterial() so the part can be recoloured)
 * @returns {{group: THREE.Group, rotor: THREE.Group}}
 */
export function makeFan(size = 12, depth = 2.5, opts = {}) {
  const { frame = true, ring = true, blades = frame ? 7 : 9, led = mat('ledWhite') } = opts;
  const group = new THREE.Group();
  group.name = 'fan';

  if (frame) {
    const f = new THREE.Mesh(frameGeometry(size, depth), mat('plastic'));
    f.castShadow = true;
    f.receiveShadow = true;
    group.add(f);
    // Corner pads and motor struts as one mesh (one draw call per fan).
    const extras = cached(`extras:${size}:${depth}`, () => mergeGeometries([padGeometry(size, depth), strutGeometry(size, depth)]));
    group.add(detail(new THREE.Mesh(extras, mat('rubber')), 1));
  }

  const rotor = new THREE.Group();
  rotor.name = 'rotor';
  const hub = new THREE.Mesh(
    cached(`hub:${size}:${depth}`, () => new THREE.CylinderGeometry(size * 0.14, size * 0.14, depth * 0.8, 32).rotateX(Math.PI / 2)),
    mat('plasticGloss'),
  );
  rotor.add(hub);
  const cap = new THREE.Mesh(cached(`cap:${size}`, () => new THREE.CircleGeometry(size * 0.1, 28)), mat('aluLight'));
  cap.position.z = depth * 0.4 + 0.01;
  rotor.add(detail(cap, 1));
  const bladeGeo = bladeGeometry(size, depth);
  for (let i = 0; i < blades; i++) {
    const b = new THREE.Mesh(bladeGeo, mat('fanBlade'));
    b.castShadow = true;
    b.rotation.z = (i / blades) * Math.PI * 2;
    rotor.add(b);
  }
  group.add(rotor);
  // Blur disc: invisible at rest, fades in as the fan speeds up.
  const blur = new THREE.Mesh(cached(`blur:${size}`, () => new THREE.CircleGeometry(size * 0.455, 40)), mat('fanBlur'));
  blur.position.z = depth * 0.42;
  blur.castShadow = false;
  blur.renderOrder = 1;
  group.add(blur);

  if (frame && ring) {
    const ringGeo = cached(`ring:${size}`, () => new THREE.TorusGeometry(size * 0.468, 0.09, 8, 72));
    for (const side of [1, -1]) {
      const r = new THREE.Mesh(ringGeo, led);
      r.position.z = side * (depth / 2 - 0.15);
      group.add(r);
    }
  }

  return { group, rotor };
}
