// Shared PBR materials. Each one is created once and reused across meshes.
import * as THREE from 'three';

const cache = new Map();

const defs = {
  caseSteel: () => new THREE.MeshStandardMaterial({ color: 0x1b1e23, metalness: 0.55, roughness: 0.5 }),
  caseInner: () => new THREE.MeshStandardMaterial({ color: 0x16191e, metalness: 0.3, roughness: 0.7 }),
  frameAlu: () => new THREE.MeshStandardMaterial({ color: 0x2c3139, metalness: 0.85, roughness: 0.32 }),
  glass: () => new THREE.MeshPhysicalMaterial({
    color: 0x1c232b, metalness: 0, roughness: 0.03, ior: 1.5,
    transparent: true, opacity: 0.16, depthWrite: false, envMapIntensity: 1.6,
  }),
  glassPrint: () => new THREE.MeshStandardMaterial({ color: 0x07080a, metalness: 0, roughness: 0.2 }),
  pcb: () => new THREE.MeshStandardMaterial({ color: 0x1a1e24, metalness: 0.2, roughness: 0.6 }),
  heatsink: () => new THREE.MeshStandardMaterial({ color: 0x3a404a, metalness: 0.85, roughness: 0.36 }),
  aluLight: () => new THREE.MeshStandardMaterial({ color: 0x8f969f, metalness: 1, roughness: 0.3 }),
  plastic: () => new THREE.MeshStandardMaterial({ color: 0x0e1013, metalness: 0.05, roughness: 0.55 }),
  plasticGloss: () => new THREE.MeshStandardMaterial({ color: 0x15181c, metalness: 0.1, roughness: 0.25 }),
  rubber: () => new THREE.MeshStandardMaterial({ color: 0x0b0c0e, metalness: 0, roughness: 0.9 }),
  sleeve: () => new THREE.MeshStandardMaterial({ color: 0x121418, metalness: 0, roughness: 0.85 }),
  // Emissive LEDs: intensity above the bloom threshold so only these glow.
  ledWhite: () => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xd8e4f2, emissiveIntensity: 3 }),
  ledAccent: () => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff5a1f, emissiveIntensity: 4 }),
};

/** Get a shared material by name. */
export function mat(name) {
  if (!cache.has(name)) {
    const make = defs[name];
    if (!make) throw new Error(`Unknown material: ${name}`);
    cache.set(name, make());
  }
  return cache.get(name);
}

/** Small tileable alpha mask of round holes for perforated steel / mesh panels. */
export function perforationTexture(anisotropy = 4) {
  if (cache.has('tex:perf')) return cache.get('tex:perf');
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, size, size);
  g.fillStyle = '#000';
  // Staggered (hex) hole pattern: two holes per tile.
  const r = size * 0.2;
  for (const [x, y] of [[0.25, 0.25], [0.75, 0.75]]) {
    g.beginPath();
    g.arc(x * size, y * size, r, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy;
  cache.set('tex:perf', tex);
  return tex;
}

/** Mesh panel material with holes, repeated so each tile is `pitch` cm. */
export function meshPanelMaterial(widthCm, heightCm, pitch = 0.7, anisotropy = 4) {
  const tex = perforationTexture(anisotropy).clone();
  tex.repeat.set(widthCm / pitch, heightCm / pitch);
  tex.needsUpdate = true;
  return new THREE.MeshStandardMaterial({
    color: 0x1a1d22, metalness: 0.6, roughness: 0.5,
    alphaMap: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
}
