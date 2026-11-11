// Shared PBR materials. Each one is created once and reused across meshes.
import * as THREE from 'three';
import { share } from './resources.js';

const cache = new Map();

const ghost = (color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2, depthWrite: false, depthTest: false, toneMapped: false });
const guide = (color) => new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false, toneMapped: false });

const defs = {
  caseSteel: () => new THREE.MeshStandardMaterial({ color: 0x1b1e23, metalness: 0.55, roughness: 0.5 }),
  caseInner: () => new THREE.MeshStandardMaterial({ color: 0x16191e, metalness: 0.3, roughness: 0.7 }),
  frameAlu: () => new THREE.MeshStandardMaterial({ color: 0x2c3139, metalness: 0.85, roughness: 0.32 }),
  glass: () => new THREE.MeshPhysicalMaterial({
    color: 0x1c232b, metalness: 0, roughness: 0.03, ior: 1.5,
    transparent: true, opacity: 0.16, depthWrite: false, envMapIntensity: 1.6,
  }),
  // Acrylic: slightly darker and less clear than tempered glass.
  glassTint: () => new THREE.MeshPhysicalMaterial({
    color: 0x20262e, metalness: 0, roughness: 0.12, ior: 1.49,
    transparent: true, opacity: 0.3, depthWrite: false, envMapIntensity: 1.2,
  }),
  glassPrint: () => new THREE.MeshStandardMaterial({ color: 0x07080a, metalness: 0, roughness: 0.2 }),
  pcb: () => new THREE.MeshStandardMaterial({ color: 0x1a1e24, metalness: 0.2, roughness: 0.6 }),
  heatsink: () => new THREE.MeshStandardMaterial({ color: 0x3a404a, metalness: 0.85, roughness: 0.36 }),
  aluLight: () => new THREE.MeshStandardMaterial({ color: 0x8f969f, metalness: 1, roughness: 0.36 }),
  plastic: () => new THREE.MeshStandardMaterial({ color: 0x0e1013, metalness: 0.05, roughness: 0.55 }),
  plasticGloss: () => new THREE.MeshStandardMaterial({ color: 0x15181c, metalness: 0.1, roughness: 0.25 }),
  rubber: () => new THREE.MeshStandardMaterial({ color: 0x0b0c0e, metalness: 0, roughness: 0.9 }),
  sleeve: () => new THREE.MeshStandardMaterial({ color: 0x121418, metalness: 0, roughness: 0.85 }),
  psuBody: () => new THREE.MeshStandardMaterial({ color: 0x141619, metalness: 0.5, roughness: 0.62 }),
  brass: () => new THREE.MeshStandardMaterial({ color: 0xb08a4a, metalness: 1, roughness: 0.38 }),
  gold: () => new THREE.MeshStandardMaterial({ color: 0xd4a640, metalness: 1, roughness: 0.28 }),
  socketPga: () => new THREE.MeshStandardMaterial({ color: 0xd9d2c0, metalness: 0, roughness: 0.6 }),
  chip: () => new THREE.MeshStandardMaterial({ color: 0x0c0d0f, metalness: 0.2, roughness: 0.42 }),
  ssdPcb: () => new THREE.MeshStandardMaterial({ color: 0x10261d, metalness: 0.2, roughness: 0.55 }),
  driveShell: () => new THREE.MeshStandardMaterial({ color: 0x2a2e35, metalness: 0.75, roughness: 0.38 }),
  hddAlu: () => new THREE.MeshStandardMaterial({ color: 0x6c727b, metalness: 1, roughness: 0.4 }),
  // Lines: not tone-mapped so they match the CSS palette exactly.
  ghostLine: () => new THREE.LineDashedMaterial({ color: 0x8a93a0, dashSize: 1.2, gapSize: 0.8, transparent: true, opacity: 0.55, toneMapped: false }),
  ghostLineFaint: () => new THREE.LineDashedMaterial({ color: 0x8a93a0, dashSize: 0.6, gapSize: 0.6, transparent: true, opacity: 0.28, toneMapped: false }),
  highlight: () => new THREE.LineBasicMaterial({ color: 0xff5a1f, depthTest: false, transparent: true, opacity: 0.95, toneMapped: false }),
  // Build by hand: x-ray ghost of where a part goes (valid, wrong, hint) and its guide box.
  ghostOk: () => ghost(0x3ddc97),
  ghostBad: () => ghost(0xff4d4d),
  ghostHint: () => ghost(0xff5a1f),
  guideOk: () => guide(0x3ddc97),
  guideBad: () => guide(0xff4d4d),
  guideHint: () => guide(0xff5a1f),
  // Emissive LEDs: intensity above the bloom threshold so only these glow.
  ledWhite: () => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xd8e4f2, emissiveIntensity: 3 }),
  // Orange has low luminance, so it needs more intensity than white to clear the bloom threshold.
  ledAccent: () => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff5a1f, emissiveIntensity: 6 }),
  // Motion blur disc over spinning fan blades; effects.js sets its opacity from the fan speed.
  fanBlur: () => new THREE.MeshBasicMaterial({ color: 0x2a2f36, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
};

/** Get a shared material by name. */
export function mat(name) {
  if (!cache.has(name)) {
    const make = defs[name];
    if (!make) throw new Error(`Unknown material: ${name}`);
    cache.set(name, share(make()));
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
  cache.set('tex:perf', share(tex));
  return tex;
}

/** Mesh panel material with holes, repeated so each tile is `pitch` cm. Owned by the caller (not shared). */
export function meshPanelMaterial(widthCm, heightCm, pitch = 0.7, anisotropy = 4) {
  const tex = perforationTexture(anisotropy).clone();
  tex.repeat.set(widthCm / pitch, heightCm / pitch);
  tex.needsUpdate = true;
  return new THREE.MeshStandardMaterial({
    color: 0x1a1d22, metalness: 0.6, roughness: 0.5,
    alphaMap: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
}

/**
 * LED material owned by one part (not shared), so each part can have its own colour.
 * Starts dark: effects.js drives colour and intensity. Disposed with the part's model.
 */
export function ledMaterial(hex = 0xd8e4f2) {
  const m = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: hex, emissiveIntensity: 0 });
  m.userData.led = true;
  return m;
}
