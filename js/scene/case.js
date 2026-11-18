// Procedural case from caseLayout(): real outer size, panel types from the data
// (sidePanel, frontPanel, vented top where the case has top mounts), rear openings that line
// up with the board's I/O and slots, tray, standoffs for every supported board size, PSU
// shroud, grommets, feet and front I/O. The product line (look.style -> LINES) sets the colour,
// the hole pattern of the mesh, wood slats, seamless or angled corner glass and lit strips.
// Also the dashed "ghost" case for the empty state.
// Axes as in layout.js. The group's origin is the centre of the case floor.
import * as THREE from 'three';
import { mat, finish, meshPanelMaterial, diffuserMaterial } from './materials.js?v=fe48996dc3';
import { lookOf } from './look.js?v=fe48996dc3';
import { boxMM, cylinderZ, instanced, instancedBoxes, detail } from './resources.js?v=fe48996dc3';
import { STANDOFFS, BOARD_DIMS } from './board-layout.js?v=fe48996dc3';
import { WALL, SIDE, FOOT, STANDOFF } from './layout.js?v=fe48996dc3';
import { boardPoint } from './layout-math.js?v=fe48996dc3';

const FRAME = 0.6;  // aluminium edge profile
const BORDER = 1.6; // solid border around mesh panels

// pattern / pitch: hole shape and spacing (cm) of the mesh panels. front: overrides the data's
// front panel ('slats' = wood slats over a dark backing). seamless: front and side glass meet
// with no corner pillar. chamfer: an angled glass pane across that corner (cm). glassTop: glass
// roof. strips: lit strips down the front. trim: a wood strip across the front.
const LINES = {
  'corsair-airflow': { pattern: 'tri', pitch: 1.0 },
  'nzxt-h': { pitch: 0.42 },
  'nzxt-h9': { pitch: 0.42, seamless: true },
  o11: { seamless: true },
  'o11-vision': { seamless: true, glassTop: true },
  lancool: { pitch: 0.4 },
  'a4-h2o': { pattern: 'slot', pitch: 1.1 },
  'dan-a3': { pitch: 0.45 },
  'fractal-north': { front: 'slats' },
  'fractal-pop': { pattern: 'hex', pitch: 0.8 },
  'fractal-meshify': { pattern: 'diamond', pitch: 0.9 },
  'fractal-terra': { pattern: 'slot', pitch: 0.9, trim: true },
  'fractal-ridge': { pattern: 'slot', pitch: 0.8 },
  'cm-q300l': { pattern: 'hex', pitch: 0.9 },
  'cm-nr200': { pitch: 0.5 },
  'cm-td500': { pattern: 'diamond', pitch: 1.3 },
  'bequiet-500dx': { pitch: 0.5, strips: true },
  'hyte-y60': { seamless: true, chamfer: 7 },
  'phanteks-g360a': { pitch: 0.3 },
  'phanteks-nv': { seamless: true },
  'montech-air': { pitch: 0.5 },
  'montech-sky': { seamless: true },
  'deepcool-ch': { pattern: 'hex', pitch: 0.7 },
  'jonsbo-d31': { pitch: 0.5 },
  'asus-ap201': { pitch: 0.36 },
};

/** Layer 1 is rendered but not ray-cast: panels you look through, ghost lines, helpers. */
export const NO_PICK_LAYER = 1;

function noPick(obj) {
  obj.traverse((o) => o.layers.set(NO_PICK_LAYER));
  return obj;
}

// Mesh plane with a solid border frame. Plane lies in local XY, facing +Z.
function meshPanel(parent, w, h, anisotropy, { thickness = WALL, frameMat = mat('caseSteel'), pattern = 'round', pitch = 0.7, colour = 'black' } = {}) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w - BORDER * 2 + 0.2, h - BORDER * 2 + 0.2), meshPanelMaterial(w, h, pitch, anisotropy, { pattern, colour }));
  m.renderOrder = 1;
  g.add(m);
  const t = thickness / 2;
  boxMM(g, -w / 2, w / 2, h / 2 - BORDER, h / 2, -t, t, frameMat);
  boxMM(g, -w / 2, w / 2, -h / 2, -h / 2 + BORDER, -t, t, frameMat);
  boxMM(g, -w / 2, -w / 2 + BORDER, -h / 2 + BORDER, h / 2 - BORDER, -t, t, frameMat);
  boxMM(g, w / 2 - BORDER, w / 2, -h / 2 + BORDER, h / 2 - BORDER, -t, t, frameMat);
  parent.add(g);
  return g;
}

// Tempered glass sheet with the print band real panels have (black, or the case colour on
// light cases). Lies in local XY, facing +Z.
function glassPanel(parent, w, h, { tint = false, print = mat('glassPrint') } = {}) {
  const g = new THREE.Group();
  const glass = boxMM(g, -w / 2, w / 2, -h / 2, h / 2, -SIDE / 2, SIDE / 2, tint ? mat('glassTint') : mat('glass'), { cast: false, receive: false });
  glass.renderOrder = 2;
  const band = Math.min(1.4, w * 0.06);
  const z0 = -SIDE / 2 - 0.02;
  const z1 = -SIDE / 2;
  boxMM(g, -w / 2, w / 2, h / 2 - band, h / 2, z0, z1, print, { cast: false });
  boxMM(g, -w / 2, w / 2, -h / 2, -h / 2 + band, z0, z1, print, { cast: false });
  boxMM(g, -w / 2, -w / 2 + band, -h / 2 + band, h / 2 - band, z0, z1, print, { cast: false });
  boxMM(g, w / 2 - band, w / 2, -h / 2 + band, h / 2 - band, z0, z1, print, { cast: false });
  parent.add(g);
  return g;
}

// Rear panel: one extruded sheet with real openings for I/O, slots, PSU and the rear fan.
function rearPanel(parent, cl, anisotropy, M) {
  const { D, W, H, trayZ } = cl;
  const shape = new THREE.Shape();
  // Shape coords: s = world z, t = world y.
  shape.moveTo(-W / 2, 0); shape.lineTo(W / 2, 0); shape.lineTo(W / 2, H); shape.lineTo(-W / 2, H); shape.lineTo(-W / 2, 0);
  const rectHole = (s0, s1, t0, t1) => {
    const p = new THREE.Path();
    p.moveTo(s0, t0); p.lineTo(s0, t1); p.lineTo(s1, t1); p.lineTo(s1, t0); p.lineTo(s0, t0);
    shape.holes.push(p);
  };
  const holes = [];
  const io = cl.io; // null when the board's I/O faces the floor
  if (io) rectHole(io.z0, io.z1, io.y0, io.y1);

  // Expansion slots: one opening, filled with individual slot covers.
  const sz0 = trayZ + 1.0;
  const sz1 = Math.min(trayZ + 13, W / 2 - SIDE - 0.6);
  const st1 = cl.slots.length ? cl.slots[0] + 1.0 : 0;
  const st0 = cl.slots.length ? cl.slots[cl.slots.length - 1] - 1.0 : 0;
  if (st0 > WALL + 0.5 && sz1 - sz0 > 4) rectHole(sz0, sz1, st0, st1);

  if (cl.rearFan) {
    const { y, z, size } = cl.rearFan;
    const p = new THREE.Path();
    p.absarc(z, y, size * 0.47, 0, Math.PI * 2, true);
    shape.holes.push(p);
    holes.push({ kind: 'fan', y, z, r: size * 0.47 });
  }
  if (cl.psuOpening) {
    const o = cl.psuOpening;
    rectHole(o.z0, o.z1, o.y0, o.y1);
  }

  const geo = new THREE.ExtrudeGeometry(shape, { depth: WALL, bevelEnabled: false, curveSegments: 32 });
  const panel = new THREE.Mesh(geo, M.steel);
  panel.rotation.y = -Math.PI / 2; // shape x -> world +z, extrusion -> world -x
  panel.position.x = -D / 2 + WALL;
  panel.castShadow = true;
  panel.receiveShadow = true;
  parent.add(panel);

  // Slot covers with thin gaps, like real stamped brackets.
  const covers = [];
  if (st0 > WALL + 0.5 && sz1 - sz0 > 4) {
    for (const y of cl.slots) {
      covers.push(boxMM(parent, -D / 2 + 0.05, -D / 2 + WALL - 0.05, y - 0.9, y + 0.9, sz0 + 0.1, sz1 - 0.1, M.frame, { name: 'slot-cover' }));
    }
  }
  // Perforated grille in the fan opening.
  for (const h of holes) {
    const grille = new THREE.Mesh(new THREE.CircleGeometry(h.r, 40), meshPanelMaterial(h.r * 2, h.r * 2, 0.6, anisotropy, { colour: M.colour }));
    grille.rotation.y = -Math.PI / 2;
    grille.position.set(-D / 2 + WALL / 2, h.y, h.z);
    parent.add(grille);
  }
  return covers;
}

function frontIO(parent, cl) {
  const { D, W, H } = cl;
  const x = D / 2 - 3.2;
  const y = H + 0.01;
  const zs = W / 2 - 3.2;
  const button = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.3, 32), mat('aluLight'));
  button.position.set(x, y + 0.1, zs);
  parent.add(button);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.07, 8, 40), mat('ledAccent'));
  ring.rotation.x = Math.PI / 2;
  ring.position.set(x, y + 0.17, zs);
  ring.name = 'power-led';
  parent.add(ring);
  // USB-A x2, USB-C, audio, laid out toward the back of the case.
  const top = (z0, z1, x0, x1, m = mat('plastic')) => boxMM(parent, x0, x1, H, H + 0.06, z0, z1, m, { cast: false });
  top(zs - 2.0, zs - 1.55, x - 0.6, x + 0.6);
  top(zs - 3.0, zs - 2.55, x - 0.6, x + 0.6);
  top(zs - 3.9, zs - 3.55, x - 0.45, x + 0.45, mat('plasticGloss'));
  const jack = new THREE.Mesh(cylinderZ(0.22, 0.08, 16), mat('plastic'));
  jack.rotation.x = Math.PI / 2;
  jack.position.set(x, H + 0.03, zs - 4.6);
  parent.add(jack);
}

/**
 * @param {object} part case part
 * @param {ReturnType<import('./layout.js?v=fe48996dc3').caseLayout>} cl
 * @param {{anisotropy?: number}} ctx
 */
export function buildCase(part, cl, { anisotropy = 4, theme } = {}) {
  const { D, W, H, trayZ } = cl;
  const root = new THREE.Group();
  root.name = 'case';
  const look = lookOf(part, theme);
  const line = LINES[look.style] ?? {};
  const colour = look.colour ?? 'black';
  const dark = colour === 'black';
  // Painted steel, the darker inside, and the edge profile (bare aluminium only on a black case).
  const M = { colour, steel: finish('steel', colour), inner: finish('inner', colour), frame: dark ? mat('frameAlu') : finish(look.finish === 'metal' ? 'alu' : 'steel', colour),
    print: dark ? mat('glassPrint') : finish('gloss', colour) };
  const mesh = { frameMat: M.steel, pattern: line.pattern, pitch: line.pitch, colour };
  const chamfer = line.chamfer ?? 0;
  const leds = [];

  // ---- shell
  boxMM(root, -D / 2, D / 2, 0, WALL, -W / 2, W / 2, M.steel);                         // floor
  boxMM(root, -D / 2, D / 2, 0, H, -W / 2, -W / 2 + WALL, M.steel, { name: 'back-side' }); // back side, behind the tray

  // Top: mesh where the case takes top fans or a radiator, with a solid strip for front I/O.
  if (cl.topVented) {
    const io = 6.5;
    boxMM(root, D / 2 - io, D / 2, H - WALL, H, -W / 2, W / 2, M.steel);
    const top = line.glassTop ? noPick(glassPanel(root, D - io, W - FRAME * 2, { print: M.print })) : meshPanel(root, D - io, W, anisotropy, mesh);
    top.rotation.x = -Math.PI / 2;
    top.position.set(-io / 2, H - WALL / 2, 0);
  } else {
    boxMM(root, -D / 2, D / 2, H - WALL, H, -W / 2, W / 2, M.steel);
  }

  // Front panel per the data: mesh, glass or solid (also used when the data doesn't say).
  const fw = W - FRAME * 2;
  const fh = H - FRAME * 2;
  const front = line.front ?? cl.frontPanel;
  if (front === 'slats') {
    // Wood slats over a dark mesh backing.
    boxMM(root, D / 2 - WALL * 1.6, D / 2 - WALL, FRAME, H - FRAME, -W / 2 + FRAME, W / 2 - FRAME, mat('chip'));
    const slats = [];
    for (let z = -fw / 2 + 0.5; z + 1.0 <= fw / 2 - 0.3; z += 1.75) slats.push([D / 2 - WALL, D / 2 + 0.5, FRAME + 0.4, H - FRAME - 0.4, z, z + 1.0]);
    instancedBoxes(root, slats, finish('wood', colour === 'white' ? 'oak' : look.accent ?? 'walnut'));
  } else if (front === 'mesh') {
    const f = meshPanel(root, fw, fh, anisotropy, mesh);
    f.rotation.y = Math.PI / 2;
    f.position.set(D / 2 - WALL / 2, H / 2, 0);
  } else if (front === 'glass') {
    const f = noPick(glassPanel(root, fw - chamfer, fh, { print: M.print }));
    f.rotation.y = Math.PI / 2;
    f.position.set(D / 2 - SIDE / 2, H / 2, -chamfer / 2);
  } else {
    boxMM(root, D / 2 - WALL * 1.6, D / 2, FRAME, H - FRAME, -W / 2 + FRAME, W / 2 - FRAME, M.steel);
    // Side intake slots most solid fronts have.
    for (const z of [-W / 2 + FRAME + 0.6, W / 2 - FRAME - 0.6]) boxMM(root, D / 2 + 0.005, D / 2 + 0.01, H * 0.12, H * 0.88, z - 0.25, z + 0.25, mat('rubber'), { cast: false });
  }
  if (line.trim) boxMM(root, D / 2, D / 2 + 0.12, H * 0.08, H * 0.2, -W / 2 + FRAME, W / 2 - FRAME, finish('wood', look.accent ?? 'walnut'));
  if (line.strips) {
    // Lit strips down both sides of the front.
    const soft = diffuserMaterial();
    leds.push(soft);
    for (const z of [-W / 2 + FRAME + 1.9, W / 2 - FRAME - 1.9]) boxMM(root, D / 2, D / 2 + 0.06, H * 0.14, H * 0.86, z - 0.22, z + 0.22, soft, { cast: false });
  }
  if (chamfer) {
    // The angled pane between the front and side glass.
    const pane = noPick(glassPanel(root, chamfer * Math.SQRT2, fh, { print: M.print }));
    pane.rotation.y = Math.PI / 4;
    pane.position.set(D / 2 - chamfer / 2, H / 2, W / 2 - chamfer / 2);
  }

  const covers = rearPanel(root, cl, anisotropy, M);

  // ---- window-side panel (toggled by the viewer)
  const side = new THREE.Group();
  side.name = 'side-panel';
  const sw = D - FRAME * 2 - chamfer;
  const sh = H - FRAME * 2;
  if (cl.sidePanel === 'glass' || cl.sidePanel === 'acrylic') {
    glassPanel(side, sw, sh, { tint: cl.sidePanel === 'acrylic', print: M.print });
  } else if (cl.sidePanel === 'mesh') {
    meshPanel(side, sw, sh, anisotropy, mesh);
  } else {
    boxMM(side, -sw / 2, sw / 2, -sh / 2, sh / 2, -WALL / 2, WALL / 2, M.steel);
  }
  side.position.set(-chamfer / 2, H / 2, W / 2 - SIDE / 2);
  noPick(side);
  root.add(side);

  // ---- aluminium frame along the 12 edges
  const t = FRAME;
  const edges = new THREE.Group();
  for (const y of [t / 2, H - t / 2]) for (const z of [-W / 2 + t / 2, W / 2 - t / 2]) boxMM(edges, -D / 2, D / 2, y - t / 2, y + t / 2, z - t / 2, z + t / 2, M.frame);
  for (const x of [-D / 2 + t / 2, D / 2 - t / 2]) for (const z of [-W / 2 + t / 2, W / 2 - t / 2]) {
    if (line.seamless && x > 0 && z > 0) continue; // glass meets glass at this corner
    boxMM(edges, x - t / 2, x + t / 2, 0, H, z - t / 2, z + t / 2, M.frame);
  }
  for (const x of [-D / 2 + t / 2, D / 2 - t / 2]) for (const y of [t / 2, H - t / 2]) boxMM(edges, x - t / 2, x + t / 2, y - t / 2, y + t / 2, -W / 2, W / 2, M.frame);
  root.add(edges);

  // ---- feet: a plastic riser with a rubber pad under it
  const fx = Math.min(5, D * 0.12);
  for (const x of [-D / 2 + fx, D / 2 - fx]) {
    for (const z of [-W / 2 + 2.5, W / 2 - 2.5]) {
      boxMM(root, x - 3, x + 3, -FOOT * 0.6, 0, z - 1.4, z + 1.4, mat('plastic'));
      boxMM(root, x - 2.6, x + 2.6, -FOOT, -FOOT * 0.6, z - 1.1, z + 1.1, mat('rubber'));
    }
  }

  // ---- small hardware (High and Ultra)
  const hw = new THREE.Group();
  hw.name = 'case-hardware';
  const sideways = [0, Math.PI / 2, 0];
  // Thumbscrews holding both side panels at the rear, PSU screws around its opening.
  const thumbs = [];
  for (const z of [-W / 2 + 0.5, W / 2 - 0.5]) for (const y of [H * 0.2, H * 0.8]) thumbs.push({ p: [-D / 2 - 0.25, y, z], r: sideways });
  instanced(hw, cylinderZ(0.45, 0.5, 14), thumbs, mat('steelBright'));
  const screws = [];
  if (cl.psuOpening) {
    const o = cl.psuOpening;
    for (const y of [o.y0 - 0.35, o.y1 + 0.35]) for (const z of [o.z0 + 0.6, o.z1 - 0.6]) screws.push({ p: [-D / 2 - 0.02, y, z], r: sideways });
  }
  if (cl.rearFan) {
    const f = cl.rearFan;
    const o = f.size / 2 - 0.75;
    for (const dy of [-o, o]) for (const dz of [-o, o]) screws.push({ p: [-D / 2 - 0.02, f.y + dy, f.z + dz], r: sideways });
  }
  instanced(hw, cylinderZ(0.26, 0.08, 10), screws, mat('steelBright'), { cast: false });
  // Slot-cover screws along the expansion bracket.
  instanced(hw, cylinderZ(0.22, 0.08, 10), cl.slots.map((y) => ({ p: [-D / 2 + WALL + 0.02, y + 0.55, trayZ + 0.55], r: sideways })), mat('steelBright'), { cast: false });
  // Cable tie points on the tray beside each grommet, and a dust filter frame under the PSU.
  const ties = [];
  for (const g of cl.grommets) for (const dy of [-2.2, 0, 2.2]) ties.push([g.x + 1.5, g.x + 2.3, g.y + dy - 0.12, g.y + dy + 0.12, trayZ, trayZ + 0.18]);
  instancedBoxes(hw, ties, M.inner);
  if (cl.shroud) {
    const s = cl.shroud;
    // Vent slots in the shroud top, and the shroud's cable badge strip.
    const slots = [];
    const xa = s.x0 + (s.x1 - s.x0) * 0.12;
    const xb = s.x0 + (s.x1 - s.x0) * 0.5;
    for (let x = xa; x < xb; x += 0.9) slots.push([x, x + 0.45, s.y1, s.y1 + 0.012, s.z0 + (s.z1 - s.z0) * 0.25, s.z1 - (s.z1 - s.z0) * 0.25]);
    instancedBoxes(hw, slots, mat('chip'), { cast: false });
    boxMM(hw, -D / 2 + 1.5, -D / 2 + 17, -0.12, 0, s.z0 + 1, s.z1 - 1, mat('plastic'), { cast: false });
  }
  root.add(detail(hw, 1));

  // ---- interior: tray, standoffs, grommets, shroud
  const trayBottom = cl.shroud ? cl.shroud.y1 : WALL;
  boxMM(root, -D / 2 + WALL, D / 2 - WALL, trayBottom, H - WALL, trayZ - 0.12, trayZ, M.inner);

  // Standoffs for every board size the case takes; each lists the sizes it serves (userData.forms).
  const standoffs = [];
  for (const ff of cl.formFactors) {
    for (const [u, v] of STANDOFFS[ff] ?? []) {
      if (u > BOARD_DIMS[ff].w || v > BOARD_DIMS[ff].h) continue;
      const [x, y] = boardPoint(cl.frame, u, v);
      const same = standoffs.find((m) => Math.hypot(m.position.x - x, m.position.y - y) < 0.5);
      if (same) { same.userData.forms.push(ff); continue; }
      const s = new THREE.Mesh(cylinderZ(0.28, STANDOFF, 6), mat('brass'));
      s.name = 'standoff';
      s.position.set(x, y, trayZ + STANDOFF / 2);
      s.userData.forms = [ff];
      root.add(s);
      standoffs.push(s);
    }
  }

  for (const g of cl.grommets) {
    boxMM(root, g.x - 0.9, g.x + 0.9, g.y - 3.2, g.y + 3.2, trayZ, trayZ + 0.25, mat('rubber'));
    boxMM(root, g.x - 0.25, g.x + 0.25, g.y - 2.8, g.y + 2.8, trayZ + 0.25, trayZ + 0.27, mat('plastic'), { cast: false });
  }
  // CPU power cut-out above the board.
  const above = H - WALL - cl.boardTopY;
  if (above > 1.6 && !cl.ioDown) boxMM(root, cl.boardX0 + 2, cl.boardX0 + 9, cl.boardTopY + above / 2 - 0.6, cl.boardTopY + above / 2 + 0.6, trayZ, trayZ + 0.25, mat('rubber'));

  if (cl.shroud) {
    const s = cl.shroud;
    boxMM(root, s.x0, s.x1, s.y1 - WALL, s.y1, s.z0, s.z1, M.steel);
    boxMM(root, s.x1 - WALL, s.x1, WALL, s.y1, s.z0, s.z1, M.steel);
    boxMM(root, s.x0, s.x1, WALL, s.y1, s.z1 - WALL, s.z1, M.steel);
    boxMM(root, s.x0 + 1, s.x1 - 0.4, s.y1 - 0.06, s.y1 + 0.02, s.z1 - 0.45, s.z1 - 0.3, M.frame, { cast: false });
  }
  // Cable cut-outs: slots in the shroud top, or rubber-edged slots in the tray under the board.
  for (const c of cl.cutouts) {
    if (c.kind === 'shroud') boxMM(root, c.x - c.w / 2, c.x + c.w / 2, c.y, c.y + 0.02, c.z - 0.65, c.z + 0.65, mat('rubber'), { cast: false });
    else boxMM(root, c.x - c.w / 2, c.x + c.w / 2, c.y - 0.6, c.y + 0.6, trayZ, trayZ + 0.22, mat('rubber'), { cast: false });
  }

  frontIO(root, cl);

  root.userData.leds = leds;
  root.userData.slotCovers = covers;
  root.userData.standoffs = standoffs;
  root.userData.sidePanel = side;
  root.userData.backSide = root.getObjectByName('back-side');
  return root;
}

/** Dashed outline of a typical case, shown before a case is chosen. */
export function buildGhostCase(cl) {
  const { D, W, H, trayZ } = cl;
  const g = new THREE.Group();
  g.name = 'ghost-case';
  const outline = (w, h, d, x, y, z, m) => {
    const shape = new THREE.BoxGeometry(w, h, d);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(shape), m);
    shape.dispose();
    e.computeLineDistances();
    e.position.set(x, y, z);
    g.add(e);
  };
  outline(D, H, W, 0, H / 2, 0, mat('ghostLine'));
  const big = BOARD_DIMS[cl.largest];
  outline(big.w, big.h, 0.01, cl.boardX0 + big.w / 2, cl.boardTopY - big.h / 2, trayZ + 0.4, mat('ghostLineFaint'));
  if (cl.shroud) outline(cl.shroud.x1 - cl.shroud.x0, cl.shroud.y1, cl.shroud.z1 - cl.shroud.z0, (cl.shroud.x0 + cl.shroud.x1) / 2, cl.shroud.y1 / 2, (cl.shroud.z0 + cl.shroud.z1) / 2, mat('ghostLineFaint'));
  outline(D, 0.01, W, 0, -FOOT, 0, mat('ghostLineFaint'));
  return noPick(g);
}
