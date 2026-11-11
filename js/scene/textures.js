// Procedural surface textures drawn on a canvas (no image files): brushed metal, fine grain
// for powder-coat / sandblasted steel / moulded plastic, sleeve weave, PCB traces, radiator
// fins, perforation normals and a wood desk. Each is made once, tiles, and is shared.
// Greyscale textures serve as roughness and bump maps; see detailUV() in materials.js for how
// they keep the same density on parts of any size.
import * as THREE from 'three';
import { share } from './resources.js';

const cache = new Map();

/** Deterministic random numbers so every load draws the same texture. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function texture(c, { srgb = false, anisotropy = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = anisotropy;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return share(t);
}

function cached(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

const grey = (v) => `rgb(${v},${v},${v})`;

// Fine grain: per-pixel noise softened once. Bright on average, so as a roughness map it
// keeps the material's own roughness and only breaks up the highlight.
function grainCanvas(size, lo, seed) {
  const [c, g] = canvas(size);
  const img = g.createImageData(size, size);
  const r = rng(seed);
  for (let i = 0; i < size * size; i++) {
    const v = lo + (255 - lo) * (0.5 * r() + 0.5 * r());
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
export const grain = () => cached('grain', () => texture(grainCanvas(256, 150, 11)));

// Brushed metal: long thin streaks along U, wrapped at the edges so the tile repeats.
export const brushed = () => cached('brushed', () => {
  const size = 512;
  const [c, g] = canvas(size);
  g.fillStyle = grey(222);
  g.fillRect(0, 0, size, size);
  const r = rng(23);
  for (let i = 0; i < 5200; i++) {
    const y = Math.floor(r() * size);
    const x = r() * size;
    const len = 60 + r() * 380;
    g.fillStyle = grey(Math.round(190 + r() * 65));
    g.globalAlpha = 0.2 + r() * 0.4;
    g.fillRect(x, y, len, 1);
    if (x + len > size) g.fillRect(x - size, y, len, 1);
  }
  g.globalAlpha = 1;
  return texture(c, { anisotropy: 8 });
});

// Braided sleeve: two sets of diagonal strands crossing. `ridges` adds a rounded profile
// across U so a flat cable reads as separate wires lying side by side.
function weaveCanvas(ridges) {
  const size = 64;
  const [c, g] = canvas(size);
  g.fillStyle = grey(120);
  g.fillRect(0, 0, size, size);
  g.lineWidth = 3;
  for (const dir of [1, -1]) {
    g.strokeStyle = grey(dir > 0 ? 215 : 170);
    for (let k = -size; k < size * 2; k += 8) {
      g.beginPath();
      g.moveTo(k, 0);
      g.lineTo(k + dir * size, size);
      g.stroke();
    }
  }
  if (ridges) {
    const grad = g.createLinearGradient(0, 0, size, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0.9)');
    grad.addColorStop(0.22, 'rgba(0,0,0,0)');
    grad.addColorStop(0.78, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.9)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  return c;
}
export const weave = () => cached('weave', () => texture(weaveCanvas(false)));
export const wireWeave = () => cached('wireWeave', () => texture(weaveCanvas(true)));

// PCB: dark solder mask with slightly raised, slightly lighter traces, vias and bare pads.
// Used as colour and as bump, so the traces catch the light.
export function pcbCanvas(size = 512, seed = 5) {
  const [c, g] = canvas(size);
  g.fillStyle = '#12161b';
  g.fillRect(0, 0, size, size);
  const r = rng(seed);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // Trace bundles: parallel lines that run straight, jog 45 degrees, and run on.
  for (let b = 0; b < 46; b++) {
    const n = 2 + Math.floor(r() * 7);
    const pitch = 3 + Math.floor(r() * 2);
    const horizontal = r() < 0.5;
    let x = r() * size;
    let y = r() * size;
    const run1 = 30 + r() * 150;
    const jog = (r() < 0.5 ? -1 : 1) * (10 + r() * 40);
    const run2 = 30 + r() * 150;
    g.strokeStyle = r() < 0.2 ? '#222a33' : '#1b2129';
    g.lineWidth = 1.3;
    for (let i = 0; i < n; i++) {
      const o = i * pitch;
      g.beginPath();
      if (horizontal) {
        g.moveTo(x, y + o);
        g.lineTo(x + run1, y + o);
        g.lineTo(x + run1 + Math.abs(jog), y + o + jog);
        g.lineTo(x + run1 + Math.abs(jog) + run2, y + o + jog);
      } else {
        g.moveTo(x + o, y);
        g.lineTo(x + o, y + run1);
        g.lineTo(x + o + jog, y + run1 + Math.abs(jog));
        g.lineTo(x + o + jog, y + run1 + Math.abs(jog) + run2);
      }
      g.stroke();
    }
    // Vias where the bundle ends.
    g.fillStyle = '#2b333d';
    for (let i = 0; i < n; i += 2) {
      g.beginPath();
      g.arc(horizontal ? x : x + i * pitch, horizontal ? y + i * pitch : y, 1.6, 0, Math.PI * 2);
      g.fill();
    }
    x += 1; y += 1;
  }
  // Small SMD parts: body with two tinned ends.
  for (let i = 0; i < 130; i++) {
    const x = r() * size;
    const y = r() * size;
    const w = 5 + Math.floor(r() * 4);
    const h = 3;
    const vertical = r() < 0.5;
    g.save();
    g.translate(x, y);
    if (vertical) g.rotate(Math.PI / 2);
    g.fillStyle = '#8f949b';
    g.fillRect(-w / 2 - 1.5, -h / 2, w + 3, h);
    g.fillStyle = r() < 0.6 ? '#2a2420' : '#0c0d0f';
    g.fillRect(-w / 2, -h / 2, w, h);
    g.restore();
  }
  return c;
}
export const pcb = () => cached('pcb', () => texture(pcbCanvas(), { srgb: true, anisotropy: 8 }));

// Radiator core: flat coolant tubes across U with folded fins between them.
export const radiatorCore = () => cached('radiator', () => {
  const size = 64;
  const [c, g] = canvas(size);
  g.fillStyle = grey(38);
  g.fillRect(0, 0, size, size);
  g.strokeStyle = grey(120);
  g.lineWidth = 1;
  for (let x = 0; x < size; x += 4) {
    g.beginPath();
    g.moveTo(x, 10);
    g.lineTo(x + 2, size);
    g.lineTo(x + 4, 10);
    g.stroke();
  }
  g.fillStyle = grey(150);
  g.fillRect(0, 0, size, 10);
  return texture(c, { anisotropy: 8 });
});

/** Tangent-space normal map from a greyscale height canvas (wraps at the edges). */
export function normalFromHeight(src, strength = 2) {
  const w = src.width;
  const h = src.height;
  const s = src.getContext('2d').getImageData(0, 0, w, h).data;
  const [c, g] = canvas(w, h);
  const out = g.createImageData(w, h);
  const at = (x, y) => s[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const o = (y * w + x) * 4;
      out.data[o] = (-dx / l * 0.5 + 0.5) * 255;
      out.data[o + 1] = (dy / l * 0.5 + 0.5) * 255;
      out.data[o + 2] = (1 / l * 0.5 + 0.5) * 255;
      out.data[o + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
  return c;
}

/**
 * Perforated sheet: staggered round holes. Returns the alpha mask (white = steel) and a
 * normal map with a pressed rim around every hole, both tiling as one unit.
 */
export function perforation(anisotropy = 4) {
  return cached('perforation', () => {
    const size = 128;
    const [mask, g] = canvas(size);
    const [height, hg] = canvas(size);
    g.fillStyle = '#fff';
    g.fillRect(0, 0, size, size);
    hg.fillStyle = '#fff';
    hg.fillRect(0, 0, size, size);
    const r = size * 0.2;
    for (const [cx, cy] of [[0.25, 0.25], [0.75, 0.75]]) {
      g.fillStyle = '#000';
      g.beginPath();
      g.arc(cx * size, cy * size, r, 0, Math.PI * 2);
      g.fill();
      const grad = hg.createRadialGradient(cx * size, cy * size, r * 0.9, cx * size, cy * size, r * 1.45);
      grad.addColorStop(0, '#000');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      hg.fillStyle = grad;
      hg.beginPath();
      hg.arc(cx * size, cy * size, r * 1.45, 0, Math.PI * 2);
      hg.fill();
    }
    return { alpha: texture(mask, { anisotropy }), normal: texture(normalFromHeight(height, 3), { anisotropy }) };
  });
}

// Desk for photo mode: oak-like boards with grain lines and a few darker streaks.
export const wood = () => cached('wood', () => {
  const size = 512;
  const [c, g] = canvas(size);
  const r = rng(77);
  g.fillStyle = '#6b4a2f';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i++) {
    const y = r() * size;
    const x = r() * size;
    const len = 80 + r() * 420;
    const dark = r() < 0.5;
    g.strokeStyle = dark ? `rgba(40,24,12,${0.08 + r() * 0.18})` : `rgba(170,128,84,${0.06 + r() * 0.14})`;
    g.lineWidth = 0.6 + r() * 1.6;
    g.beginPath();
    g.moveTo(x, y);
    g.bezierCurveTo(x + len * 0.3, y + (r() - 0.5) * 6, x + len * 0.7, y + (r() - 0.5) * 6, x + len, y + (r() - 0.5) * 4);
    g.stroke();
    if (x + len > size) { g.translate(-size, 0); g.stroke(); g.translate(size, 0); }
  }
  // Board seams.
  g.fillStyle = 'rgba(20,12,6,0.55)';
  for (const y of [0, size / 2]) g.fillRect(0, y, size, 2);
  return texture(c, { srgb: true, anisotropy: 8 });
});
