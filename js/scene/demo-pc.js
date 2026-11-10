// Procedural showcase PC for the landing page: mid tower, glass side, ATX board,
// 360 mm AIO at the front, 3-slot GPU, rear exhaust fan, accent power LED.
// Axes (cm): +X = case front, +Y = up, +Z = glass side. Rear I/O is at -X.
// Phase 4 replaces this with the data-driven model factory in parts.js / case.js.
import * as THREE from 'three';
import { mat, meshPanelMaterial } from './materials.js';
import { makeFan } from './fan-model.js';

const D = 45;   // case depth (x)
const H = 47;   // case height (y), body only
const W = 23;   // case width (z)
const FOOT = 1.2;

const boxCache = new Map();
function boxGeo(w, h, d) {
  const key = `${w}|${h}|${d}`;
  if (!boxCache.has(key)) boxCache.set(key, new THREE.BoxGeometry(w, h, d));
  return boxCache.get(key);
}

function box(parent, w, h, d, material, x, y, z, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(boxGeo(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = receive;
  parent.add(m);
  return m;
}

function tube(parent, points, radius, material) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, radius, 12, false), material);
  m.castShadow = true;
  parent.add(m);
  return m;
}

function buildCase(root, anisotropy) {
  const shell = new THREE.Group();
  shell.name = 'case';
  root.add(shell);

  // Solid panels
  box(shell, D, 0.3, W, mat('caseSteel'), 0, 0.15, 0);                       // bottom
  box(shell, 0.3, H, W, mat('caseSteel'), -D / 2 + 0.15, H / 2, 0);           // rear
  box(shell, D, H, 0.3, mat('caseSteel'), 0, H / 2, -W / 2 + 0.15);           // right side (behind board)
  box(shell, D - 0.6, H - 0.6, 0.05, mat('caseInner'), 0, H / 2, -W / 2 + 0.33, { cast: false }); // tray face

  // Perforated mesh panels: front and top. They don't cast shadows so light reaches inside.
  const front = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.6, H - 0.6), meshPanelMaterial(W, H, 0.7, anisotropy));
  front.rotation.y = Math.PI / 2;
  front.position.set(D / 2 - 0.15, H / 2, 0);
  shell.add(front);

  const top = new THREE.Mesh(new THREE.PlaneGeometry(D - 0.6, W - 0.6), meshPanelMaterial(D, W, 0.7, anisotropy));
  top.rotation.x = -Math.PI / 2;
  top.position.set(0, H - 0.15, 0);
  shell.add(top);

  // Tempered glass side with a black print band around the edge, like real panels.
  const glass = box(shell, D - 0.4, H - 0.4, 0.4, mat('glass'), 0, H / 2, W / 2 - 0.2, { cast: false, receive: false });
  glass.renderOrder = 2;
  const band = 1.4;
  const gz = W / 2 - 0.42;
  box(shell, D - 0.4, band, 0.04, mat('glassPrint'), 0, H - 0.2 - band / 2, gz, { cast: false });
  box(shell, D - 0.4, band, 0.04, mat('glassPrint'), 0, 0.2 + band / 2, gz, { cast: false });
  box(shell, band, H - 0.4, 0.04, mat('glassPrint'), -D / 2 + 0.2 + band / 2, H / 2, gz, { cast: false });
  box(shell, band, H - 0.4, 0.04, mat('glassPrint'), D / 2 - 0.2 - band / 2, H / 2, gz, { cast: false });

  // Thin aluminium frame along all 12 edges.
  const t = 0.7;
  for (const y of [t / 2, H - t / 2]) for (const z of [-W / 2 + t / 2, W / 2 - t / 2]) box(shell, D, t, t, mat('frameAlu'), 0, y, z);
  for (const x of [-D / 2 + t / 2, D / 2 - t / 2]) for (const z of [-W / 2 + t / 2, W / 2 - t / 2]) box(shell, t, H, t, mat('frameAlu'), x, H / 2, z);
  for (const x of [-D / 2 + t / 2, D / 2 - t / 2]) for (const y of [t / 2, H - t / 2]) box(shell, t, t, W, mat('frameAlu'), x, y, 0);

  // Feet
  for (const x of [-D / 2 + 5, D / 2 - 5]) for (const z of [-W / 2 + 3, W / 2 - 3]) box(shell, 6, FOOT, 3, mat('rubber'), x, -FOOT / 2, z);

  // PSU shroud with a brushed trim line on its front edge.
  const shroudLen = D / 2 + 15;
  box(shell, shroudLen, 9, W - 0.8, mat('caseSteel'), -D / 2 + shroudLen / 2, 4.5 + 0.3, -0.1);
  box(shell, shroudLen, 0.12, 0.12, mat('aluLight'), -D / 2 + shroudLen / 2, 9.3, W / 2 - 0.55);

  // Cable grommets in the tray, right of the board.
  for (const y of [15, 25, 35]) box(shell, 1.6, 6, 0.4, mat('rubber'), 8.2, y, -W / 2 + 0.5);

  // Front-panel I/O and power button on the top, front edge.
  box(shell, 0.9, 0.12, 0.35, mat('plastic'), D / 2 - 3.5, H + 0.01, W / 2 - 7, { cast: false });
  box(shell, 0.9, 0.12, 0.35, mat('plastic'), D / 2 - 3.5, H + 0.01, W / 2 - 8.2, { cast: false });
  const button = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.3, 32), mat('aluLight'));
  button.position.set(D / 2 - 3.5, H + 0.1, W / 2 - 4);
  shell.add(button);
  const led = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.08, 8, 40), mat('ledAccent'));
  led.rotation.x = Math.PI / 2;
  led.position.set(D / 2 - 3.5, H + 0.18, W / 2 - 4);
  shell.add(led);
}

function buildBoard(root) {
  const g = new THREE.Group();
  g.name = 'motherboard';
  root.add(g);

  // ATX: 24.4 x 30.5 cm. (u, v) is measured from the board's rear-top corner.
  const x0 = -D / 2 + 2.6;
  const y0 = H - 2.8;
  const zf = -W / 2 + 0.3 + 0.6 + 0.16; // tray + standoffs + PCB thickness
  const on = (u, v, w, h, d, material) => box(g, w, h, d, material, x0 + u + w / 2, y0 - v - h / 2, zf + d / 2);

  box(g, 24.4, 30.5, 0.16, mat('pcb'), x0 + 12.2, y0 - 15.25, zf - 0.08);
  on(0, 0.8, 3.2, 17, 3.8, mat('plastic'));          // I/O shroud
  on(2.9, 0.8, 0.3, 17, 3.85, mat('aluLight'));
  on(4, 1, 11, 3.2, 3.0, mat('heatsink'));           // VRM heatsinks
  on(3.4, 4.4, 2.8, 10, 3.0, mat('heatsink'));
  on(4, 1, 11, 0.12, 3.05, mat('aluLight'));
  on(4.5, 13.4, 11, 2.0, 0.5, mat('heatsink'));      // M.2 covers
  on(4.5, 23.2, 11, 1.8, 0.5, mat('heatsink'));
  on(3.5, 25.6, 9, 0.7, 1.1, mat('plastic'));        // spare PCIe slots
  on(3.5, 28.6, 9, 0.7, 1.1, mat('plastic'));
  on(15.5, 23, 7.5, 6, 1.0, mat('heatsink'));        // chipset heatsink
  on(15.5, 23, 7.5, 0.12, 1.05, mat('aluLight'));
  on(23.2, 5.5, 1.0, 5.3, 1.6, mat('plastic'));      // 24-pin connector

  // RAM: four sticks with heatspreaders and a light bar.
  for (let i = 0; i < 4; i++) {
    const u = 15.6 + i * 0.95;
    on(u - 0.1, 1.8, 0.9, 14.1, 0.6, mat('plastic'));
    const stick = box(g, 0.7, 13.3, 3.6, mat('heatsink'), x0 + u + 0.35, y0 - 2.2 - 6.65, zf + 0.6 + 1.8);
    stick.name = 'ram';
    box(g, 0.5, 12.9, 0.45, mat('ledWhite'), x0 + u + 0.35, y0 - 2.2 - 6.65, zf + 0.6 + 3.6 + 0.2, { cast: false });
  }

  // AIO pump block on the CPU socket.
  const px = x0 + 11.2;
  const py = y0 - 9.2;
  on(7.6, 5.6, 7.2, 7.2, 0.5, mat('plastic'));
  const pump = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.6, 3.0, 48).rotateX(Math.PI / 2), mat('plasticGloss'));
  pump.position.set(px, py, zf + 0.5 + 1.5);
  pump.castShadow = true;
  g.add(pump);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 0.15, 48).rotateX(Math.PI / 2), mat('aluLight'));
  cap.position.set(px, py, zf + 3.6);
  g.add(cap);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.9, 0.12, 8, 64), mat('ledWhite'));
  ring.position.set(px, py, zf + 3.55);
  g.add(ring);

  return { pump: new THREE.Vector3(px, py, zf + 2.0), x0, y0, zf };
}

function buildGPU(root, board) {
  const g = new THREE.Group();
  g.name = 'gpu';
  root.add(g);
  const len = 30.4;
  const xRear = -D / 2 + 0.8;
  const top = board.y0 - 16.4;
  const zIn = board.zf + 0.2;
  const height = 12.6;
  const cx = xRear + len / 2;
  const cz = zIn + height / 2;

  box(g, len, 0.35, height + 0.2, mat('frameAlu'), cx, top - 0.175, cz);       // backplate
  box(g, len - 0.4, 5.2, height, mat('heatsink'), cx, top - 0.35 - 2.6, cz);   // shroud
  box(g, 22, 0.22, 0.08, mat('ledWhite'), cx + 2, top - 1.6, zIn + height + 0.04, { cast: false });
  box(g, 26, 0.1, 0.06, mat('aluLight'), cx + 1, top - 4.2, zIn + height + 0.03, { cast: false });
  box(g, 2.0, 0.8, 0.9, mat('plastic'), cx + 6, top + 0.4, zIn + 9.5);          // 12V-2x6 connector

  const fans = [];
  for (const dx of [-10, 0, 10]) {
    const f = makeFan(9, 1.4, { frame: false });
    f.group.rotation.x = -Math.PI / 2;
    f.group.position.set(cx + dx, top - 0.35 - 5.2 - 0.75, cz);
    g.add(f.group);
    fans.push(f.rotor);
  }
  return { fans, connector: new THREE.Vector3(cx + 6, top + 0.8, zIn + 9.5) };
}

function buildCooling(root) {
  const fans = [];
  // 360 mm radiator behind the front mesh, 3 intake fans on its inner face.
  const rx = D / 2 - 1.2 - 1.35;
  const ry = H / 2 + 0.5;
  box(root, 2.7, 39.7, 12, mat('heatsink'), rx, ry, 0);
  box(root, 3.0, 2.4, 12.4, mat('plastic'), rx, ry + 19.85 + 1.2, 0);
  box(root, 3.0, 2.4, 12.4, mat('plastic'), rx, ry - 19.85 - 1.2, 0);
  for (const dy of [-12.4, 0, 12.4]) {
    const f = makeFan(12, 2.5);
    f.group.rotation.y = -Math.PI / 2;
    f.group.position.set(rx - 1.35 - 1.25, ry + dy, 0);
    root.add(f.group);
    fans.push(f.rotor);
  }
  // Rear exhaust fan.
  const rear = makeFan(12, 2.5);
  rear.group.rotation.y = -Math.PI / 2;
  rear.group.position.set(-D / 2 + 0.3 + 1.25, 36, 3.5);
  root.add(rear.group);
  fans.push(rear.rotor);

  return { fans, radiatorPort: new THREE.Vector3(rx - 1.5, ry + 19.85 + 1.2, -2.5) };
}

function buildCables(root, board, gpu, cooling) {
  const p = board.pump;
  const r = cooling.radiatorPort;
  // AIO tubes go forward of the RAM, then along the top to the radiator end tank.
  for (const off of [0, 2.2]) {
    tube(root, [
      [p.x + 3.2, p.y + 0.8 - off * 0.6, p.z + 0.5],
      [p.x + 6, p.y + 1.6 - off * 0.4, p.z + 4.2 + off * 0.4],
      [p.x + 15, p.y + 4 - off * 0.3, -2 + off],
      [r.x - 6, r.y - 1, r.z + off],
      [r.x, r.y, r.z + off],
    ], 0.6, mat('sleeve'));
  }
  // 24-pin bundle into the middle grommet, GPU power cable into the top one.
  const c24 = [board.x0 + 24.2, board.y0 - 8.2, board.zf + 0.8];
  tube(root, [c24, [c24[0] + 1.2, c24[1], c24[2] + 0.3], [8.2, c24[1] - 4, -W / 2 + 2], [8.2, 25, -W / 2 + 0.6]], 0.75, mat('sleeve'));
  const g = gpu.connector;
  tube(root, [[g.x, g.y, g.z], [g.x, g.y + 2.5, g.z], [g.x + 5, g.y + 3, -4], [8.2, 15, -W / 2 + 1.5], [8.2, 15, -W / 2 + 0.6]], 0.45, mat('sleeve'));
  // CPU 8-pin along the top edge of the board.
  tube(root, [[board.x0 + 2.4, board.y0 - 0.5, board.zf + 0.8], [board.x0 + 2.4, board.y0 + 1.1, board.zf + 0.4], [board.x0 + 2.4, board.y0 + 1.6, -W / 2 + 0.6]], 0.45, mat('sleeve'));
}

/** Builds the showcase PC. Call update(dt, power) each frame; power 0..1 drives LEDs and fan speed. */
export function buildDemoPC({ anisotropy = 4 } = {}) {
  const root = new THREE.Group();
  root.name = 'demo-pc';
  const inner = new THREE.Group();
  inner.position.y = FOOT;
  root.add(inner);

  buildCase(inner, anisotropy);
  const board = buildBoard(inner);
  const gpu = buildGPU(inner, board);
  const cooling = buildCooling(inner);
  buildCables(inner, board, gpu, cooling);

  // LED spill inside the case (physical units: candela, distances in cm).
  const spill = new THREE.PointLight(0xdce8ff, 0, 0, 2);
  spill.position.set(12, 30, 2);
  inner.add(spill);
  const spill2 = new THREE.PointLight(0xdce8ff, 0, 0, 2);
  spill2.position.set(-14, 38, 4);
  inner.add(spill2);

  const fans = [...gpu.fans, ...cooling.fans];
  const ledWhite = mat('ledWhite');
  const ledAccent = mat('ledAccent');
  const base = { white: ledWhite.emissiveIntensity, accent: ledAccent.emissiveIntensity };

  const RPS = 2; // visual fan speed in revolutions per second at full power
  function update(dt, power) {
    const spin = dt * RPS * Math.PI * 2 * power;
    for (let i = 0; i < fans.length; i++) fans[i].rotation.z += spin * (i < gpu.fans.length ? 1.3 : 1);
    // Power LED comes on first, then the white LEDs.
    ledAccent.emissiveIntensity = base.accent * Math.min(1, power * 3);
    const white = Math.max(0, (power - 0.2) / 0.8);
    ledWhite.emissiveIntensity = base.white * white;
    spill.intensity = 700 * white;
    spill2.intensity = 450 * white;
  }

  return { group: root, update, size: { depth: D, height: H + FOOT, width: W } };
}
