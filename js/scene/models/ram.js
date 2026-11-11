// Memory: one stick per module in the kit, at the real module height from the data, with
// heatspreaders and an LED diffuser along the top when the part has RGB.
// Stick local: +X along the module, +Y = up out of the slot (height), +Z across; origin = slot centre on the board.
import * as THREE from 'three';
import { mat, ledMaterial } from '../materials.js';
import { boxMM } from '../resources.js';
import { RAM_LENGTH, ramModules } from '../layout-board.js';

const DEFAULT_H = 3.4;
const SEAT = 0.3; // the module's bottom edge sits this far into the slot's height

export function buildRAM(part) {
  const g = new THREE.Group();
  g.name = 'ram';
  const h = part.heightMM ? part.heightMM / 10 : DEFAULT_H;
  const L = RAM_LENGTH;
  const led = part.rgb ? ledMaterial() : null;
  const units = [];
  for (let i = 0; i < ramModules(part); i++) {
    const u = new THREE.Group();
    u.name = `ram-${i}`;
    const top = SEAT + h;
    const pcbTop = Math.min(top - 0.2, SEAT + 3.1);
    boxMM(u, -L / 2, L / 2, SEAT, pcbTop, -0.06, 0.06, mat('pcb'));
    boxMM(u, -L / 2 + 0.3, L / 2 - 0.3, SEAT, SEAT + 0.25, -0.065, 0.065, mat('gold'), { cast: false });
    // Heatspreaders on both faces, a top rail, and the LED bar on RGB kits.
    const sh0 = SEAT + 0.45;
    const shTop = led ? top - 0.55 : top;
    for (const z of [-1, 1]) boxMM(u, -L / 2 + 0.1, L / 2 - 0.1, sh0, shTop, z * 0.07, z * 0.33, mat('heatsink'));
    boxMM(u, -L / 2 + 0.1, L / 2 - 0.1, shTop - 0.2, shTop, -0.33, 0.33, mat('aluLight'));
    if (led) {
      boxMM(u, -L / 2 + 0.25, L / 2 - 0.25, shTop, top - 0.05, -0.26, 0.26, led, { cast: false });
      boxMM(u, -L / 2 + 0.1, L / 2 - 0.1, top - 0.05, top, -0.3, 0.3, mat('plasticGloss'), { cast: false });
    }
    g.add(u);
    units.push(u);
  }
  g.userData.units = units;
  g.userData.leds = led ? [led] : [];
  g.userData.approx = part.heightMM ? [] : [`height not in the data, ${DEFAULT_H * 10} mm assumed`];
  return g;
}
