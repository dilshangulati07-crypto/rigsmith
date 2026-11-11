// Shared PBR materials. Each one is created once and reused across meshes.
import * as THREE from 'three';
import { share } from './resources.js';
import * as tex from './textures.js';

/**
 * Give a material's maps the same density on every part, whatever the mesh's size. Most
 * parts are one unit cube scaled per mesh, so plain UVs would stretch a texture across a
 * 40 cm panel and a 5 mm chip alike. This maps by the vertex position in real centimetres
 * on the face's main axis instead (object space, so it moves with the part).
 * @param {number} tile size of one texture tile in cm
 */
export function detailUV(material, tile) {
  // Kept on the material so the tile size can be changed later (userData.detailTile.value = 1 / cm).
  material.userData.detailTile = { value: 1 / tile };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.detailTile = material.userData.detailTile;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float detailTile;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
      {
        vec3 dS = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
        #ifdef USE_INSTANCING
          dS *= vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        #endif
        vec3 dP = position * dS;
        vec3 dN = abs(normal);
        vec2 dUv = (dN.x > dN.y && dN.x > dN.z ? dP.zy : (dN.y > dN.z ? dP.xz : dP.xy)) * detailTile;
        #ifdef USE_MAP
          vMapUv = dUv;
        #endif
        #ifdef USE_BUMPMAP
          vBumpMapUv = dUv;
        #endif
        #ifdef USE_ROUGHNESSMAP
          vRoughnessMapUv = dUv;
        #endif
      }`);
  };
  material.customProgramCacheKey = () => 'detail-uv';
  return material;
}

const std = (o) => new THREE.MeshStandardMaterial(o);
// Finishes: each takes the base look and adds the surface texture at a real-world scale.
const powderCoat = (o) => detailUV(std({ ...o, roughnessMap: tex.grain(), bumpMap: tex.grain(), bumpScale: 0.35 }), 1.1);
const sandblasted = (o) => detailUV(std({ ...o, roughnessMap: tex.grain(), bumpMap: tex.grain(), bumpScale: 0.6 }), 0.7);
const moulded = (o) => detailUV(std({ ...o, roughnessMap: tex.grain(), bumpMap: tex.grain(), bumpScale: 0.2 }), 0.9);
const brushedMetal = (o, tile = 3) => detailUV(std({ ...o, roughnessMap: tex.brushed(), bumpMap: tex.brushed(), bumpScale: 0.03 }), tile);

const cache = new Map();

const ghost = (color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2, depthWrite: false, depthTest: false, toneMapped: false });
const guide = (color) => new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false, toneMapped: false });

const defs = {
  // Powder-coated steel: the coating hides most of the metal, so it reads as a matte paint.
  caseSteel: () => powderCoat({ color: 0x1b1e23, metalness: 0.35, roughness: 0.62 }),
  caseInner: () => powderCoat({ color: 0x16191e, metalness: 0.25, roughness: 0.74 }),
  frameAlu: () => brushedMetal({ color: 0x2c3139, metalness: 0.9, roughness: 0.42 }),
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
  pcb: () => detailUV(std({ color: 0xffffff, map: tex.pcb(), bumpMap: tex.pcb(), bumpScale: 0.5, metalness: 0.15, roughness: 0.5 }), 6),
  heatsink: () => brushedMetal({ color: 0x3a404a, metalness: 0.9, roughness: 0.46 }, 2.5),
  aluLight: () => brushedMetal({ color: 0x9aa1aa, metalness: 1, roughness: 0.44 }, 2.5),
  // Nickel-plated copper (heatpipes, cold plates, the CPU's heat spreader) and bare copper.
  nickel: () => std({ color: 0xd2cec4, metalness: 1, roughness: 0.2 }),
  copper: () => std({ color: 0xc8794a, metalness: 1, roughness: 0.28 }),
  usbBlue: () => std({ color: 0x1846c8, metalness: 0, roughness: 0.4 }),
  steelBright: () => std({ color: 0xb4b9c0, metalness: 1, roughness: 0.3 }),
  plastic: () => moulded({ color: 0x0e1013, metalness: 0, roughness: 0.62 }),
  plasticGloss: () => std({ color: 0x101216, metalness: 0, roughness: 0.14 }),
  // Fan blades: smoked polycarbonate, slightly see-through.
  fanBlade: () => std({ color: 0x14171b, metalness: 0, roughness: 0.42, transparent: true, opacity: 0.9 }),
  rubber: () => moulded({ color: 0x0b0c0e, metalness: 0, roughness: 0.95 }),
  sleeve: () => std({ color: 0x121418, metalness: 0, roughness: 0.85, bumpMap: tex.weave(), bumpScale: 1.2 }),
  tubeBraid: () => std({ color: 0x0d0e11, metalness: 0, roughness: 0.8, bumpMap: tex.weave(), bumpScale: 1.4 }),
  radiatorCore: () => detailUV(std({ color: 0xffffff, map: tex.radiatorCore(), bumpMap: tex.radiatorCore(), bumpScale: 1, metalness: 0.6, roughness: 0.6 }), 0.9),
  psuBody: () => sandblasted({ color: 0x141619, metalness: 0.45, roughness: 0.66 }),
  brass: () => new THREE.MeshStandardMaterial({ color: 0xb08a4a, metalness: 1, roughness: 0.38 }),
  gold: () => new THREE.MeshStandardMaterial({ color: 0xd4a640, metalness: 1, roughness: 0.28 }),
  socketPga: () => new THREE.MeshStandardMaterial({ color: 0xd9d2c0, metalness: 0, roughness: 0.6 }),
  chip: () => new THREE.MeshStandardMaterial({ color: 0x0c0d0f, metalness: 0.2, roughness: 0.42 }),
  ssdPcb: () => new THREE.MeshStandardMaterial({ color: 0x10261d, metalness: 0.2, roughness: 0.55 }),
  driveShell: () => sandblasted({ color: 0x2a2e35, metalness: 0.8, roughness: 0.42 }),
  hddAlu: () => sandblasted({ color: 0x6c727b, metalness: 1, roughness: 0.42 }),
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

/** Tileable alpha mask of round holes for perforated steel / mesh panels. */
export function perforationTexture(anisotropy = 4) {
  return tex.perforation(anisotropy).alpha;
}

/** Mesh panel material with holes, repeated so each tile is `pitch` cm. Owned by the caller (not shared). */
export function meshPanelMaterial(widthCm, heightCm, pitch = 0.7, anisotropy = 4) {
  const { alpha, normal } = tex.perforation(anisotropy);
  const tile = (t) => {
    const c = t.clone();
    c.repeat.set(widthCm / pitch, heightCm / pitch);
    c.needsUpdate = true;
    return c;
  };
  return new THREE.MeshStandardMaterial({
    color: 0x1a1d22, metalness: 0.6, roughness: 0.5,
    alphaMap: tile(alpha), normalMap: tile(normal), normalScale: new THREE.Vector2(0.8, 0.8),
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
}

/**
 * Glass follows the quality level: real transmission (what is behind it is refracted, at the
 * cost of one extra scene pass) at Ultra, a thin alpha-blended sheet otherwise.
 */
export function setMaterialQuality(quality) {
  const ultra = quality === 'ultra';
  for (const [name, o] of [['glass', { opacity: 0.16, tint: 0xdfe8ee, base: 0x1c232b }], ['glassTint', { opacity: 0.3, tint: 0xb9c4cc, base: 0x20262e }]]) {
    const m = mat(name);
    if ((m.transmission > 0) === ultra) continue;
    m.transmission = ultra ? 1 : 0;
    m.thickness = 0; // a thin sheet: no sideways shift of what is behind it
    m.transparent = !ultra;
    m.opacity = ultra ? 1 : o.opacity;
    m.color.set(ultra ? o.tint : o.base);
    m.needsUpdate = true;
  }
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
