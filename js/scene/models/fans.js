// Case fans: one fan per unit in the pack (packCount), real size and thickness, LED rings
// only on RGB fans. The layout positions each unit separately.
import * as THREE from 'three';
import { makeFan } from '../fan-model.js';
import { ledMaterial } from '../materials.js';

export function buildFans(part) {
  const g = new THREE.Group();
  g.name = 'fans';
  const size = (part.sizeMM ?? 120) / 10;
  const depth = (part.thicknessMM ?? 25) / 10;
  const units = [];
  const rotors = [];
  const led = part.rgb === true ? ledMaterial() : null;
  for (let i = 0; i < (part.packCount ?? 1); i++) {
    const f = makeFan(size, depth, { ring: !!led, led: led ?? undefined, blades: part.sizeMM >= 140 ? 7 : 9 });
    f.group.name = `fan-${i}`;
    g.add(f.group);
    units.push(f.group);
    rotors.push(f.rotor);
  }
  g.userData.units = units;
  g.userData.rotors = rotors;
  g.userData.leds = led ? [led] : [];
  return g;
}

/** A .glb fan model is one fan: clone it per unit and spin the node named "rotor" if present. */
export function fansFromGLB(scene, part) {
  const g = new THREE.Group();
  g.name = 'fans';
  const units = [];
  const rotors = [];
  for (let i = 0; i < (part.packCount ?? 1); i++) {
    const unit = i ? scene.clone(true) : scene;
    g.add(unit);
    units.push(unit);
    const rotor = unit.getObjectByName('rotor');
    if (rotor) rotors.push(rotor);
  }
  g.userData.units = units;
  g.userData.rotors = rotors;
  return g;
}
