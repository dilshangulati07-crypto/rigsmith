// Cables in 3D for "Build by hand": each cable is swept along the curve sampled by
// cable-route.js with its real cross-section (the 24-pin wide and thick, SATA flat, fan leads
// round), with a plug head at each end. Styles: stock black, white, a custom colour, or
// sleeved (striped) main cables. Also the glowing port markers and the waypoint handles.
// Geometry is rebuilt only for a cable whose route changed and disposed when it goes;
// materials, the stripe texture and the marker/handle geometry are made once.
// reveal() draws a cable only up to a fraction of its length (the Auto-build cinematic).
import * as THREE from 'three';
import { mat } from './materials.js';
import { weave, wireWeave } from './textures.js';
import { DETAIL_HIGH } from './resources.js';
import { NO_PICK_LAYER } from './case.js';
import { CABLE_SPECS } from './cable-plan.js';

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const PROFILE = 12;    // points around the cross-section
const STRIPE_CM = 0.9; // sleeve stripe period along the cable

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

// Cross-section: a superellipse, boxy for flat cables and round for round ones.
function profile(w, t) {
  const round = Math.abs(w - t) < 0.01;
  const n = round ? 2 : 5;
  const pts = [];
  for (let k = 0; k <= PROFILE; k++) {
    const a = (k / PROFILE) * Math.PI * 2;
    const c = Math.cos(a); const s = Math.sin(a);
    const x = (w / 2) * Math.sign(c) * Math.abs(c) ** (2 / n);
    const y = (t / 2) * Math.sign(s) * Math.abs(s) ** (2 / n);
    const nx = Math.sign(c) * Math.abs(c) ** (2 - 2 / n) / (w / 2);
    const ny = Math.sign(s) * Math.abs(s) ** (2 - 2 / n) / (t / 2);
    const l = Math.hypot(nx, ny) || 1;
    pts.push({ x, y, nx: nx / l, ny: ny / l, u: k / PROFILE });
  }
  return pts;
}

/**
 * Sweep a cross-section along `samples` (root-space points). The width lies along `axis` at
 * the start (the socket's long side) and is carried along the curve by parallel transport.
 */
export function sweepGeometry(samples, { w, t }, axis) {
  const n = samples.length;
  const P = samples.map(v3);
  const T = P.map((p, i) => P[Math.min(n - 1, i + 1)].clone().sub(P[Math.max(0, i - 1)]).normalize());
  const B = new Array(n);
  let b = axis ? v3(axis) : new THREE.Vector3(0, 0, 1);
  b.addScaledVector(T[0], -b.dot(T[0]));
  if (b.lengthSq() < 1e-6) b = new THREE.Vector3(1, 0, 0).cross(T[0]);
  if (b.lengthSq() < 1e-6) b = new THREE.Vector3(0, 1, 0).cross(T[0]);
  B[0] = b.normalize();
  for (let i = 1; i < n; i++) {
    const nb = B[i - 1].clone().addScaledVector(T[i], -B[i - 1].dot(T[i]));
    B[i] = nb.lengthSq() > 1e-8 ? nb.normalize() : B[i - 1].clone();
  }
  const prof = profile(w, t);
  const m = prof.length;
  const pos = new Float32Array(n * m * 3);
  const nor = new Float32Array(n * m * 3);
  const uv = new Float32Array(n * m * 2);
  const N = new THREE.Vector3();
  let arc = 0;
  for (let i = 0; i < n; i++) {
    if (i) arc += P[i].distanceTo(P[i - 1]);
    N.crossVectors(T[i], B[i]);
    for (let k = 0; k < m; k++) {
      const q = prof[k];
      const o = (i * m + k) * 3;
      pos[o] = P[i].x + B[i].x * q.x + N.x * q.y;
      pos[o + 1] = P[i].y + B[i].y * q.x + N.y * q.y;
      pos[o + 2] = P[i].z + B[i].z * q.x + N.z * q.y;
      nor[o] = B[i].x * q.nx + N.x * q.ny;
      nor[o + 1] = B[i].y * q.nx + N.y * q.ny;
      nor[o + 2] = B[i].z * q.nx + N.z * q.ny;
      uv[(i * m + k) * 2] = q.u * 2;
      uv[(i * m + k) * 2 + 1] = arc / STRIPE_CM;
    }
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < m - 1; k++) {
      const a = i * m + k; const c = a + m;
      idx.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// Diagonal sleeve stripes in the accent colour on near-black, tiled along the cable.
function stripeCanvas(color) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#121418';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = color;
  for (let k = -64; k < 128; k += 32) {
    g.beginPath();
    g.moveTo(k, 0); g.lineTo(k + 14, 0); g.lineTo(k + 14 + 64, 64); g.lineTo(k + 64, 64);
    g.closePath();
    g.fill();
  }
  return c;
}

/**
 * @param {{viewer: object, root: THREE.Object3D}} opts root = the build root (layout space)
 */
export function createCables({ viewer, root }) {
  const group = new THREE.Group();
  group.name = 'cables';
  root.add(group);
  const overlay = new THREE.Group(); // markers and handles, drawn on top
  overlay.name = 'cable-overlay';
  root.add(overlay);

  const stripe = new THREE.CanvasTexture(stripeCanvas('#ff5a1f'));
  stripe.wrapS = THREE.RepeatWrapping;
  stripe.wrapT = THREE.RepeatWrapping;
  stripe.colorSpace = THREE.SRGBColorSpace;
  stripe.anisotropy = 4;
  // Sleeve weave as a bump map. Flat power cables repeat a ridged version once per wire
  // across their width, so a 24-pin reads as twelve wires side by side.
  const bump = (wires) => {
    const t = (wires > 1 ? wireWeave() : weave()).clone();
    t.repeat.set(wires > 1 ? wires : 3, 2);
    t.needsUpdate = true;
    return t;
  };
  const body = (o) => new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0, bumpMap: bump(1), bumpScale: 1.1, ...o });
  const mats = {
    black: body({ color: 0x15171b }),
    white: body({ color: 0xe6e8ec, roughness: 0.6 }),
    custom: body({ color: 0xff5a1f, roughness: 0.6 }),
    sleeved: body({ map: stripe, roughness: 0.8 }),
    headWhite: new THREE.MeshStandardMaterial({ color: 0xf2f3f5, roughness: 0.45, metalness: 0 }),
    selected: new THREE.MeshStandardMaterial({ color: 0xff5a1f, emissive: 0xff5a1f, emissiveIntensity: 0.35, roughness: 0.5, metalness: 0 }),
  };
  let style = { kind: 'black', color: '#ff5a1f' };

  const cables = new Map(); // id -> { sig, mesh, heads: [Mesh, Mesh], spec, segs }
  let selectedId = null;

  // One variant of each style per wire count, made on first use and kept in step with it.
  const variants = new Map();
  function bodyMat(spec) {
    const kind = style.kind === 'white' || style.kind === 'custom' ? style.kind : style.kind === 'sleeved' && spec.main ? 'sleeved' : 'black';
    const wires = spec.wires ?? 1;
    if (wires <= 1) return mats[kind];
    const key = `${kind}|${wires}`;
    if (!variants.has(key)) {
      const m = mats[kind].clone();
      m.bumpMap = bump(wires);
      m.bumpScale = 1.6;
      variants.set(key, m);
    }
    const m = variants.get(key);
    m.color.copy(mats[kind].color);
    return m;
  }
  const headMat = () => (style.kind === 'white' ? mats.headWhite : mat('plastic'));
  function paint(id) {
    const c = cables.get(id);
    if (!c) return;
    c.mesh.material = id === selectedId ? mats.selected : bodyMat(c.spec);
    for (const h of c.heads) { h.material = headMat(); for (const k of h.children) k.material = h.material; }
  }

  // Plug head on a port: long side along the socket, sitting on top of it.
  const basis = new THREE.Matrix4();
  function head(spec, port) {
    const m = new THREE.Mesh(UNIT_BOX, headMat());
    const [long, short, depth] = spec.head;
    const d = v3(port.dir).normalize();
    let a = port.axis ? v3(port.axis) : new THREE.Vector3(1, 0, 0);
    a.addScaledVector(d, -a.dot(d));
    if (a.lengthSq() < 1e-6) a = new THREE.Vector3(0, 1, 0).cross(d);
    a.normalize();
    basis.makeBasis(a, d.clone().cross(a), d);
    m.quaternion.setFromRotationMatrix(basis);
    m.scale.set(long, short, depth);
    m.position.copy(v3(port.p)).addScaledVector(d, depth / 2 - 0.15);
    m.castShadow = true;
    // Latch on one long side of the housing (sizes are fractions of the housing: it is a scaled cube).
    if (spec.main) {
      const latch = new THREE.Mesh(UNIT_BOX, m.material);
      latch.scale.set(Math.min(0.5, 0.9 / long), 0.22, 0.75);
      latch.position.set(0, 0.5 + 0.11, 0.05);
      latch.layers.set(DETAIL_HIGH);
      m.add(latch);
    }
    return m;
  }

  /**
   * Show exactly these cables: [{ id, cable, samples, A, B }] (A/B = the two ports).
   * A cable is rebuilt only when its samples or ends change.
   */
  function sync(list) {
    const keep = new Set();
    for (const c of list) {
      keep.add(c.id);
      const spec = CABLE_SPECS[c.cable];
      const sig = `${c.cable}|${c.A.id}|${c.B.id}|${c.samples.length}|${c.samples[1]}|${c.samples[c.samples.length >> 1]}|${c.samples[c.samples.length - 2]}`;
      const old = cables.get(c.id);
      if (old?.sig === sig) continue;
      if (old) drop(c.id);
      const mesh = new THREE.Mesh(sweepGeometry(c.samples, spec, c.A.axis), bodyMat(spec));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.cableId = c.id;
      const heads = [head(spec, c.A), head(spec, c.B)];
      group.add(mesh, ...heads);
      cables.set(c.id, { sig, mesh, heads, spec, segs: c.samples.length - 1 });
      paint(c.id);
    }
    for (const id of [...cables.keys()]) if (!keep.has(id)) drop(id);
  }
  function drop(id) {
    const c = cables.get(id);
    if (!c) return;
    c.mesh.removeFromParent();
    c.mesh.geometry.dispose();
    for (const h of c.heads) h.removeFromParent();
    cables.delete(id);
  }

  // ---- markers and handles (pooled meshes, shared geometry)
  const markerGeo = new THREE.SphereGeometry(0.5, 16, 12);
  const ringGeo = new THREE.TorusGeometry(0.85, 0.09, 6, 28);
  const handleGeo = new THREE.SphereGeometry(0.42, 14, 10);
  const overlayMat = (color, opacity = 0.95) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false });
  const markerMats = {
    source: overlayMat(0xff5a1f),
    selected: overlayMat(0xffffff),
    valid: overlayMat(0x3ddc97),
    target: overlayMat(0x8a93a0, 0.55),
    hint: overlayMat(0xff5a1f),
  };
  const handleMats = { idle: overlayMat(0xe7eaee, 0.9), active: overlayMat(0xff5a1f) };
  const markers = [];
  const handles = [];
  function pooled(pool, geo) {
    const m = new THREE.Mesh(geo);
    m.renderOrder = 1000;
    m.layers.set(NO_PICK_LAYER);
    overlay.add(m);
    pool.push(m);
    return m;
  }
  let markerList = [];
  // Markers sit just out of the socket, along its plug direction.
  const markerPos = (m) => m.p.map((v, i) => v + m.dir[i] * 0.6);
  /** [{ id, p, dir, state: source | selected | valid | target | hint }] */
  function setMarkers(list) {
    markerList = list;
    while (markers.length < list.length) {
      const m = pooled(markers, markerGeo);
      const ring = new THREE.Mesh(ringGeo);
      ring.renderOrder = 1000;
      ring.layers.set(NO_PICK_LAYER);
      m.add(ring);
    }
    markers.forEach((m, i) => {
      const it = list[i];
      m.visible = !!it;
      if (!it) return;
      m.material = markerMats[it.state] ?? markerMats.target;
      m.children[0].material = m.material;
      m.children[0].visible = it.state !== 'target';
      m.position.copy(v3(markerPos(it)));
      m.lookAt(root.localToWorld(m.position.clone().add(v3(it.dir))));
      m.userData.marker = it;
    });
  }
  let handleList = [];
  /** Waypoint handles: [[x, y, z]...] or []; `active` = index being dragged. */
  function setHandles(points, active = -1) {
    handleList = points;
    while (handles.length < points.length) pooled(handles, handleGeo);
    handles.forEach((h, i) => {
      h.visible = i < points.length;
      if (!h.visible) return;
      h.position.copy(v3(points[i]));
      h.material = i === active ? handleMats.active : handleMats.idle;
    });
  }

  // ---- picking helpers (screen space; markers and handles are drawn on top)
  const tmp = new THREE.Vector3();
  function toScreen(p) {
    tmp.copy(v3(p));
    root.localToWorld(tmp);
    tmp.project(viewer.camera);
    const r = viewer.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((tmp.x + 1) / 2) * r.width, y: r.top + ((1 - tmp.y) / 2) * r.height, behind: tmp.z > 1 };
  }
  function nearest(list, toP, x, y, maxPx) {
    let best = null;
    let bestD = maxPx;
    list.forEach((it, i) => {
      const s = toScreen(toP(it));
      if (s.behind) return;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bestD) { bestD = d; best = { it, i }; }
    });
    return best;
  }
  const raycaster = new THREE.Raycaster();
  let pulse = 0;

  return {
    group,
    sync,
    setStyle(next) {
      style = { ...next };
      mats.custom.color.set(style.color);
      const c = stripeCanvas(style.color);
      stripe.image = c;
      stripe.needsUpdate = true;
      for (const id of cables.keys()) paint(id);
    },
    select(id) {
      const prev = selectedId;
      selectedId = id;
      paint(prev);
      paint(id);
    },
    get selected() { return selectedId; },
    setMarkers,
    setHandles,
    /** Marker under a client point: its item ({ id, ... }) or null. */
    markerAt: (x, y, px = 18) => nearest(markerList, markerPos, x, y, px)?.it ?? null,
    /** Index of the waypoint handle under a client point, or -1. */
    handleAt: (x, y, px = 16) => nearest(handleList, (p) => p, x, y, px)?.i ?? -1,
    /** Id of the cable under a normalised device point, or null. */
    cableAt(ndc) {
      raycaster.setFromCamera(ndc, viewer.camera);
      const hit = raycaster.intersectObjects([...cables.values()].map((c) => c.mesh), false)[0];
      return hit?.object.userData.cableId ?? null;
    },
    toScreen,
    update(dt) {
      pulse += dt;
      const s = 1 + 0.18 * Math.sin(pulse * 5);
      markers.forEach((m) => { if (m.visible) m.children[0].scale.setScalar(m.userData.marker?.state === 'target' ? 1 : s); });
    },
    /**
     * Draw cable `id` from its first end up to fraction `t` of its length (0 hides it, 1 is
     * whole). The index buffer runs along the cable, PROFILE quads per sample step.
     */
    reveal(id, t) {
      const c = cables.get(id);
      if (!c) return;
      const k = Math.round(Math.min(1, Math.max(0, t)) * c.segs);
      c.mesh.visible = k > 0;
      c.mesh.geometry.setDrawRange(0, k >= c.segs ? Infinity : k * PROFILE * 6);
      c.heads[0].visible = k > 0;
      c.heads[1].visible = k >= c.segs;
    },
    get count() { return cables.size; },
    clear() {
      for (const id of [...cables.keys()]) drop(id);
      setMarkers([]);
      setHandles([]);
      selectedId = null;
    },
    dispose() {
      this.clear();
      group.removeFromParent();
      overlay.removeFromParent();
      for (const m of [...markers, ...handles]) m.removeFromParent();
      markerGeo.dispose();
      ringGeo.dispose();
      handleGeo.dispose();
      stripe.dispose();
      for (const m of [...Object.values({ ...mats, ...markerMats, ...handleMats }), ...variants.values()]) {
        if (m.bumpMap) m.bumpMap.dispose();
        m.dispose();
      }
    },
  };
}
