// Procedural PSU at the standard size for its form factor: body, fan and grille on the
// underside, honeycomb rear with AC inlet and switch, modular sockets (or a cable exit) on
// the inside face, and a side label with brand and wattage. look: body colour (white where
// the unit is sold in white), the brand's label accent, and lit zones on the few units with them.
// Local axes: +X = inside face (toward the case front), -X = rear, -Y = fan side, +Z = label side.
import * as THREE from 'three';
import { mat, finish, meshPanelMaterial, diffuserMaterial } from '../materials.js?v=5b4c14becb';
import { lookOf, COLOURS } from '../look.js?v=5b4c14becb';
import { boxMM, instancedBoxes, instanced, cylinderZ, labelTexture, detail } from '../resources.js?v=5b4c14becb';
import { makeFan } from '../fan-model.js?v=5b4c14becb';
import { psuDims, psuSockets } from '../layout.js?v=5b4c14becb';

export function buildPSU(part, { anisotropy = 4, theme } = {}) {
  const look = lookOf(part, theme);
  const colour = look.colour ?? 'black';
  const white = colour === 'white';
  const body = finish(look.finish === 'metal' ? 'alu' : 'anodised', colour);
  const wire = white ? finish('alu', 'white') : mat('heatsink');
  const leds = [];
  const { len, h, w } = psuDims(part);
  const g = new THREE.Group();
  g.name = 'psu';
  const x0 = -len / 2; const x1 = len / 2;
  const y0 = -h / 2; const y1 = h / 2;
  const z0 = -w / 2; const z1 = w / 2;

  boxMM(g, x0, x1, y0, y1, z0, z1, body);

  // Fan under a wire grille (fans face down in a bottom-mounted PSU).
  const fanSize = Math.min(len, w) * 0.86;
  const fanSoft = look.has('fan') ? diffuserMaterial({ opacity: 0.9 }) : null;
  if (fanSoft) leds.push(fanSoft);
  const fan = makeFan(fanSize, 1.2, { frame: false, ring: false, light: fanSoft ? 'blades' : null, soft: fanSoft ?? undefined, bladeMat: white ? finish('blade', 'white') : undefined });
  fan.group.rotation.x = Math.PI / 2;
  fan.group.position.set(0, y0 + 0.75, 0);
  g.add(fan.group);
  for (let i = 1; i <= 4; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry((fanSize / 2) * (i / 4), 0.05, 6, 48), wire);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y0 - 0.05;
    g.add(ring);
  }
  boxMM(g, -fanSize / 2, fanSize / 2, y0 - 0.1, y0 - 0.02, -0.05, 0.05, wire, { cast: false });
  boxMM(g, -0.05, 0.05, y0 - 0.1, y0 - 0.02, -fanSize / 2, fanSize / 2, wire, { cast: false });

  // Rear: honeycomb vent, AC inlet and power switch.
  const vent = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.58, h * 0.8), meshPanelMaterial(w * 0.58, h * 0.8, 0.45, anisotropy, { pattern: 'hex', colour }));
  vent.rotation.y = -Math.PI / 2;
  vent.position.set(x0 - 0.01, 0, z0 + w * 0.33);
  g.add(vent);
  boxMM(g, x0 - 0.15, x0, -1.2, 1.2, z1 - 4.4, z1 - 1.4, mat('plastic'));
  boxMM(g, x0 - 0.2, x0, -0.7, 0.7, z1 - 5.6, z1 - 4.8, mat('plasticGloss'));

  // Inside face: modular sockets, or a sleeved cable exit on non-modular units.
  const face = psuSockets(part);
  if (face.modular) {
    instancedBoxes(g, face.sockets.map(({ y, z }) => [x1, x1 + 0.12, y - 0.6, y + 0.6, z - 0.9, z + 0.9]), mat('plastic'));
  } else {
    boxMM(g, x1, x1 + 0.3, -1.6, 1.6, -2, 2, mat('rubber'));
  }

  // Case screws on the rear corners and the pin cavities of the modular sockets.
  const sc = [];
  for (const y of [y0 + 0.6, y1 - 0.6]) for (const z of [z0 + 0.6, z1 - 0.6]) sc.push({ p: [x0 - 0.03, y, z], r: [0, Math.PI / 2, 0] });
  detail(instanced(g, cylinderZ(0.28, 0.08, 10), sc, mat('steelBright'), { cast: false }), 1);
  if (face.modular) detail(instancedBoxes(g, face.sockets.map(({ y, z }) => [x1 + 0.12, x1 + 0.13, y - 0.42, y + 0.42, z - 0.72, z + 0.72]), mat('chip'), { cast: false }), 1);

  // Side label.
  const accent = look.accent && COLOURS[look.accent] ? `#${COLOURS[look.accent].toString(16).padStart(6, '0')}` : null;
  const label = labelTexture([[part?.brand ?? '', 30], [`${part?.wattage ?? ''} W`, 46], [part?.efficiency ?? '', 18, 400, '"IBM Plex Mono", monospace']],
    { width: 320, height: 160, accent, ...(white ? { bg: '#e6e8ea', fg: '#23262b' } : {}) });
  const sticker = new THREE.Mesh(new THREE.PlaneGeometry(len * 0.62, h * 0.62), new THREE.MeshStandardMaterial({ map: label, roughness: 0.55, metalness: 0.1 }));
  sticker.position.set(0, 0, z1 + 0.01);
  g.add(sticker);

  if (look.has('logo')) {
    // Lit logo strip on the label side.
    const soft = diffuserMaterial();
    leds.push(soft);
    boxMM(g, x0 + 0.8, x0 + 1.15, -h * 0.3, h * 0.3, z1, z1 + 0.04, soft, { cast: false });
  }
  g.userData.leds = leds;
  g.userData.rotor = fan.rotor;
  return g;
}
