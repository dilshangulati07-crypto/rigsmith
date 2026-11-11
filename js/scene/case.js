// Procedural case from caseLayout(): real outer size, panel types from the data
// (sidePanel, frontPanel, vented top where the case has top mounts), rear openings that line
// up with the board's I/O and slots, tray, standoffs for every supported board size, PSU
// shroud, grommets, feet and front I/O. Also the dashed "ghost" case for the empty state.
// Axes as in layout.js. The group's origin is the centre of the case floor.
import * as THREE from 'three';
import { mat, meshPanelMaterial } from './materials.js';
import { boxMM, cylinderZ } from './resources.js';
import { STANDOFFS, BOARD_DIMS } from './board-layout.js';
import { WALL, SIDE, FOOT, STANDOFF } from './layout.js';
import { boardPoint } from './layout-math.js';

const FRAME = 0.6;  // aluminium edge profile
const BORDER = 1.6; // solid border around mesh panels

/** Layer 1 is rendered but not ray-cast: panels you look through, ghost lines, helpers. */
export const NO_PICK_LAYER = 1;

function noPick(obj) {
  obj.traverse((o) => o.layers.set(NO_PICK_LAYER));
  return obj;
}

// Mesh plane with a solid border frame. Plane lies in local XY, facing +Z.
function meshPanel(parent, w, h, anisotropy, { thickness = WALL, frameMat = mat('caseSteel') } = {}) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w - BORDER * 2 + 0.2, h - BORDER * 2 + 0.2), meshPanelMaterial(w, h, 0.7, anisotropy));
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

// Tempered glass sheet with the black print band real panels have. Lies in local XY, facing +Z.
function glassPanel(parent, w, h, { tint = false } = {}) {
  const g = new THREE.Group();
  const glass = boxMM(g, -w / 2, w / 2, -h / 2, h / 2, -SIDE / 2, SIDE / 2, tint ? mat('glassTint') : mat('glass'), { cast: false, receive: false });
  glass.renderOrder = 2;
  const band = Math.min(1.4, w * 0.06);
  const z0 = -SIDE / 2 - 0.02;
  const z1 = -SIDE / 2;
  boxMM(g, -w / 2, w / 2, h / 2 - band, h / 2, z0, z1, mat('glassPrint'), { cast: false });
  boxMM(g, -w / 2, w / 2, -h / 2, -h / 2 + band, z0, z1, mat('glassPrint'), { cast: false });
  boxMM(g, -w / 2, -w / 2 + band, -h / 2 + band, h / 2 - band, z0, z1, mat('glassPrint'), { cast: false });
  boxMM(g, w / 2 - band, w / 2, -h / 2 + band, h / 2 - band, z0, z1, mat('glassPrint'), { cast: false });
  parent.add(g);
  return g;
}

// Rear panel: one extruded sheet with real openings for I/O, slots, PSU and the rear fan.
function rearPanel(parent, cl, anisotropy) {
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
  const panel = new THREE.Mesh(geo, mat('caseSteel'));
  panel.rotation.y = -Math.PI / 2; // shape x -> world +z, extrusion -> world -x
  panel.position.x = -D / 2 + WALL;
  panel.castShadow = true;
  panel.receiveShadow = true;
  parent.add(panel);

  // Slot covers with thin gaps, like real stamped brackets.
  const covers = [];
  if (st0 > WALL + 0.5 && sz1 - sz0 > 4) {
    for (const y of cl.slots) {
      covers.push(boxMM(parent, -D / 2 + 0.05, -D / 2 + WALL - 0.05, y - 0.9, y + 0.9, sz0 + 0.1, sz1 - 0.1, mat('frameAlu'), { name: 'slot-cover' }));
    }
  }
  // Perforated grille in the fan opening.
  for (const h of holes) {
    const grille = new THREE.Mesh(new THREE.CircleGeometry(h.r, 40), meshPanelMaterial(h.r * 2, h.r * 2, 0.6, anisotropy));
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
 * @param {ReturnType<import('./layout.js').caseLayout>} cl
 * @param {{anisotropy?: number}} ctx
 */
export function buildCase(part, cl, { anisotropy = 4 } = {}) {
  const { D, W, H, trayZ } = cl;
  const root = new THREE.Group();
  root.name = 'case';

  // ---- shell
  boxMM(root, -D / 2, D / 2, 0, WALL, -W / 2, W / 2, mat('caseSteel'));                         // floor
  boxMM(root, -D / 2, D / 2, 0, H, -W / 2, -W / 2 + WALL, mat('caseSteel'));                     // back side, behind the tray

  // Top: mesh where the case takes top fans or a radiator, with a solid strip for front I/O.
  if (cl.topVented) {
    const io = 6.5;
    boxMM(root, D / 2 - io, D / 2, H - WALL, H, -W / 2, W / 2, mat('caseSteel'));
    const top = meshPanel(root, D - io, W, anisotropy);
    top.rotation.x = -Math.PI / 2;
    top.position.set(-io / 2, H - WALL / 2, 0);
  } else {
    boxMM(root, -D / 2, D / 2, H - WALL, H, -W / 2, W / 2, mat('caseSteel'));
  }

  // Front panel per the data: mesh, glass or solid (also used when the data doesn't say).
  const fw = W - FRAME * 2;
  const fh = H - FRAME * 2;
  if (cl.frontPanel === 'mesh') {
    const f = meshPanel(root, fw, fh, anisotropy);
    f.rotation.y = Math.PI / 2;
    f.position.set(D / 2 - WALL / 2, H / 2, 0);
  } else if (cl.frontPanel === 'glass') {
    const f = noPick(glassPanel(root, fw, fh));
    f.rotation.y = Math.PI / 2;
    f.position.set(D / 2 - SIDE / 2, H / 2, 0);
  } else {
    boxMM(root, D / 2 - WALL * 1.6, D / 2, FRAME, H - FRAME, -W / 2 + FRAME, W / 2 - FRAME, mat('caseSteel'));
    // Side intake slots most solid fronts have.
    for (const z of [-W / 2 + FRAME + 0.6, W / 2 - FRAME - 0.6]) boxMM(root, D / 2 + 0.005, D / 2 + 0.01, H * 0.12, H * 0.88, z - 0.25, z + 0.25, mat('rubber'), { cast: false });
  }

  const covers = rearPanel(root, cl, anisotropy);

  // ---- window-side panel (toggled by the viewer)
  const side = new THREE.Group();
  side.name = 'side-panel';
  const sw = D - FRAME * 2;
  const sh = H - FRAME * 2;
  if (cl.sidePanel === 'glass' || cl.sidePanel === 'acrylic') {
    glassPanel(side, sw, sh, { tint: cl.sidePanel === 'acrylic' });
  } else if (cl.sidePanel === 'mesh') {
    meshPanel(side, sw, sh, anisotropy);
  } else {
    boxMM(side, -sw / 2, sw / 2, -sh / 2, sh / 2, -WALL / 2, WALL / 2, mat('caseSteel'));
  }
  side.position.set(0, H / 2, W / 2 - SIDE / 2);
  noPick(side);
  root.add(side);

  // ---- aluminium frame along the 12 edges
  const t = FRAME;
  const edges = new THREE.Group();
  for (const y of [t / 2, H - t / 2]) for (const z of [-W / 2 + t / 2, W / 2 - t / 2]) boxMM(edges, -D / 2, D / 2, y - t / 2, y + t / 2, z - t / 2, z + t / 2, mat('frameAlu'));
  for (const x of [-D / 2 + t / 2, D / 2 - t / 2]) for (const z of [-W / 2 + t / 2, W / 2 - t / 2]) boxMM(edges, x - t / 2, x + t / 2, 0, H, z - t / 2, z + t / 2, mat('frameAlu'));
  for (const x of [-D / 2 + t / 2, D / 2 - t / 2]) for (const y of [t / 2, H - t / 2]) boxMM(edges, x - t / 2, x + t / 2, y - t / 2, y + t / 2, -W / 2, W / 2, mat('frameAlu'));
  root.add(edges);

  // ---- feet
  const fx = Math.min(5, D * 0.12);
  for (const x of [-D / 2 + fx, D / 2 - fx]) {
    for (const z of [-W / 2 + 2.5, W / 2 - 2.5]) boxMM(root, x - 3, x + 3, -FOOT, 0, z - 1.4, z + 1.4, mat('rubber'));
  }

  // ---- interior: tray, standoffs, grommets, shroud
  const trayBottom = cl.shroud ? cl.shroud.y1 : WALL;
  boxMM(root, -D / 2 + WALL, D / 2 - WALL, trayBottom, H - WALL, trayZ - 0.12, trayZ, mat('caseInner'));

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
    boxMM(root, s.x0, s.x1, s.y1 - WALL, s.y1, s.z0, s.z1, mat('caseSteel'));
    boxMM(root, s.x1 - WALL, s.x1, WALL, s.y1, s.z0, s.z1, mat('caseSteel'));
    boxMM(root, s.x0, s.x1, WALL, s.y1, s.z1 - WALL, s.z1, mat('caseSteel'));
    boxMM(root, s.x0 + 1, s.x1 - 0.4, s.y1 - 0.06, s.y1 + 0.02, s.z1 - 0.45, s.z1 - 0.3, mat('frameAlu'), { cast: false });
    // Cable pass-through next to the tray.
    boxMM(root, s.x0 + 6, s.x0 + 16, s.y1, s.y1 + 0.02, s.z0 + 0.3, s.z0 + 1.6, mat('rubber'), { cast: false });
  }

  frontIO(root, cl);

  root.userData.slotCovers = covers;
  root.userData.standoffs = standoffs;
  root.userData.sidePanel = side;
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
