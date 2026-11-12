// Case fans: one fan per unit in the pack (packCount), real size and thickness, in the frame,
// blade and lighting style of the product line (look.style, see fan-model.js). The layout
// positions each unit separately.
import * as THREE from 'three';
import { makeFan, fanLook } from '../fan-model.js';
import { ledMaterial, diffuserMaterial } from '../materials.js';
import { lookOf } from '../look.js';

export function buildFans(part, { theme } = {}) {
  const g = new THREE.Group();
  g.name = 'fans';
  const size = (part.sizeMM ?? 120) / 10;
  const depth = (part.thicknessMM ?? 25) / 10;
  const units = [];
  const rotors = [];
  const look = lookOf(part, theme);
  const lit = part.rgb === true && look.zones?.length !== 0;
  const style = fanLook(look, { lit, blades: part.look?.blades ?? (look.style ? null : part.sizeMM >= 140 ? 7 : 9) });
  const led = lit ? ledMaterial() : null;
  // Frosted parts (lit blades, halos, light bars) glow softer than the bare LEDs behind them.
  const soft = lit && style.light !== 'edge' ? diffuserMaterial({ opacity: style.light === 'blades' ? 0.9 : 1 }) : null;
  for (let i = 0; i < (part.packCount ?? 1); i++) {
    const f = makeFan(size, depth, { ...style, led: led ?? undefined, soft: soft ?? undefined });
    f.group.name = `fan-${i}`;
    g.add(f.group);
    units.push(f.group);
    rotors.push(f.rotor);
  }
  g.userData.units = units;
  g.userData.rotors = rotors;
  g.userData.leds = [led, soft].filter(Boolean);
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
