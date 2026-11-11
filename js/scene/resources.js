// Shared-resource bookkeeping. Geometries, materials and textures that many models reuse
// are registered with share(); disposeTree() frees everything else a model owns.
import * as THREE from 'three';

const SHARED = new WeakSet();

/** Mark a geometry / material / texture as shared so disposeTree() leaves it alone. */
export function share(resource) {
  SHARED.add(resource);
  return resource;
}

export const isShared = (r) => SHARED.has(r);

const TEXTURE_KEYS = ['map', 'alphaMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'bumpMap'];

function disposeMaterial(m) {
  if (isShared(m)) return;
  for (const k of TEXTURE_KEYS) if (m[k] && !isShared(m[k])) m[k].dispose();
  m.dispose();
}

/** Dispose every non-shared GPU resource under `root` and detach it. */
export function disposeTree(root) {
  root.removeFromParent();
  root.traverse((o) => {
    if (o.isInstancedMesh) o.dispose();
    if (o.geometry && !isShared(o.geometry)) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(disposeMaterial);
  });
}

// ---------------------------------------------------------------- shared primitives
const UNIT_BOX = share(new THREE.BoxGeometry(1, 1, 1));
const cylCache = new Map();

/** Shared cylinder along local Z (radial segments scale with size). */
export function cylinderZ(radius, height, segments = 24) {
  const key = `${radius}|${height}|${segments}`;
  if (!cylCache.has(key)) cylCache.set(key, share(new THREE.CylinderGeometry(radius, radius, height, segments).rotateX(Math.PI / 2)));
  return cylCache.get(key);
}

/**
 * Axis-aligned box from min/max corners, using one shared unit cube scaled per mesh.
 * @returns {THREE.Mesh}
 */
export function boxMM(parent, x0, x1, y0, y1, z0, z1, material, { cast = true, receive = true, name } = {}) {
  const m = new THREE.Mesh(UNIT_BOX, material);
  m.scale.set(Math.abs(x1 - x0) || 0.001, Math.abs(y1 - y0) || 0.001, Math.abs(z1 - z0) || 0.001);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.castShadow = cast;
  m.receiveShadow = receive;
  if (name) m.name = name;
  parent.add(m);
  return m;
}

/** Box by centre and size. */
export function boxC(parent, [x, y, z], [w, h, d], material, opts) {
  return boxMM(parent, x - w / 2, x + w / 2, y - h / 2, y + h / 2, z - d / 2, z + d / 2, material, opts);
}

/**
 * Many small boxes with one material in a single draw call.
 * @param {Array<[x0,x1,y0,y1,z0,z1]>} list
 */
export function instancedBoxes(parent, list, material, { cast = true } = {}) {
  if (!list.length) return null;
  const mesh = new THREE.InstancedMesh(UNIT_BOX, material, list.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  list.forEach(([x0, x1, y0, y1, z0, z1], i) => {
    m.compose(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), q, new THREE.Vector3(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)));
    mesh.setMatrixAt(i, m);
  });
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  parent.add(mesh);
  return mesh;
}

/** Small canvas texture with text, e.g. a product label. Owned by the caller's model. */
export function labelTexture(lines, { width = 256, height = 128, bg = '#15181c', fg = '#c9ced6', accent = null } = {}) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, width, height);
  if (accent) {
    g.fillStyle = accent;
    g.fillRect(0, height - 6, width, 6);
  }
  g.fillStyle = fg;
  g.textBaseline = 'top';
  let y = height * 0.14;
  lines.forEach(([text, size, weight = 600, family = '"Barlow Condensed", "Arial Narrow", sans-serif']) => {
    g.font = `${weight} ${size}px ${family}`;
    g.fillText(String(text).toUpperCase(), width * 0.07, y, width * 0.86);
    y += size * 1.15;
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
