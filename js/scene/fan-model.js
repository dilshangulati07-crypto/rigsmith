// Procedural fan: square frame, hub, pitched blades, optional LED ring.
// Local +Z is the airflow (outflow) side. Rotate the returned group to orient it.
import * as THREE from 'three';
import { mat } from './materials.js';
import { share } from './resources.js';

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
    const rIn = size * 0.14;
    const rOut = size * 0.455;
    const chord = size * 0.25;
    const g = new THREE.BoxGeometry(rOut - rIn, chord, 0.1);
    g.translate(rIn + (rOut - rIn) / 2, 0, 0);
    g.rotateX(0.55); // blade pitch
    return g;
  });
}

/**
 * @param {number} size  frame size in cm (12 = 120 mm fan)
 * @param {number} depth thickness in cm (2.5 = 25 mm)
 * @param {{frame?: boolean, ring?: boolean, blades?: number}} opts
 * @returns {{group: THREE.Group, rotor: THREE.Group}}
 */
export function makeFan(size = 12, depth = 2.5, opts = {}) {
  const { frame = true, ring = true, blades = frame ? 7 : 9 } = opts;
  const group = new THREE.Group();
  group.name = 'fan';

  if (frame) {
    const f = new THREE.Mesh(frameGeometry(size, depth), mat('plastic'));
    f.castShadow = true;
    f.receiveShadow = true;
    group.add(f);
  }

  const rotor = new THREE.Group();
  rotor.name = 'rotor';
  const hub = new THREE.Mesh(
    cached(`hub:${size}:${depth}`, () => new THREE.CylinderGeometry(size * 0.14, size * 0.14, depth * 0.8, 32).rotateX(Math.PI / 2)),
    mat('plasticGloss'),
  );
  rotor.add(hub);
  const bladeGeo = bladeGeometry(size, depth);
  for (let i = 0; i < blades; i++) {
    const b = new THREE.Mesh(bladeGeo, mat('plasticGloss'));
    b.rotation.z = (i / blades) * Math.PI * 2;
    rotor.add(b);
  }
  group.add(rotor);

  if (frame && ring) {
    const ringGeo = cached(`ring:${size}`, () => new THREE.TorusGeometry(size * 0.468, 0.09, 8, 72));
    for (const side of [1, -1]) {
      const r = new THREE.Mesh(ringGeo, mat('ledWhite'));
      r.position.z = side * (depth / 2 - 0.15);
      group.add(r);
    }
  }

  return { group, rotor };
}
