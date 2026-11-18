// Shared PBR materials. Each one is created once and reused across meshes.
import * as THREE from 'three';
import { share } from './resources.js?v=5b4c14becb';
import * as tex from './textures.js?v=5b4c14becb';
import { COLOURS } from './look.js?v=5b4c14becb';

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

/**
 * Alpha-blended glass (Low and High) that keeps its reflections: plain alpha blending would
 * scale the reflection by the opacity too, so a clear pane showed almost none. Here only the
 * tint is scaled by the opacity and the reflection is added at full strength
 * (premultiplied alpha). With real transmission (Ultra) the shader is unchanged.
 */
function thinGlass(m) {
  m.premultipliedAlpha = true;
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        #ifndef USE_TRANSMISSION
          gl_FragColor.rgb = outgoingLight - totalDiffuse * (1.0 - diffuseColor.a);
        #endif`)
      .replace('#include <premultiplied_alpha_fragment>', '');
  };
  m.customProgramCacheKey = () => 'thin-glass';
  return m;
}

const ghost = (color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2, depthWrite: false, depthTest: false, toneMapped: false });
const guide = (color) => new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false, toneMapped: false });

const defs = {
  // Powder-coated steel: the coating hides most of the metal, so it reads as a matte paint.
  caseSteel: () => powderCoat({ color: 0x212328, metalness: 0.35, roughness: 0.62 }),
  caseInner: () => powderCoat({ color: 0x1f2227, metalness: 0.25, roughness: 0.74 }),
  frameAlu: () => brushedMetal({ color: 0x383d45, metalness: 0.9, roughness: 0.42 }),
  glass: () => thinGlass(new THREE.MeshPhysicalMaterial({
    color: 0x1c232b, metalness: 0, roughness: 0.03, ior: 1.5,
    transparent: true, opacity: 0.16, depthWrite: false, envMapIntensity: 0.22,
  })),
  // Acrylic: slightly darker and less clear than tempered glass.
  glassTint: () => thinGlass(new THREE.MeshPhysicalMaterial({
    color: 0x20262e, metalness: 0, roughness: 0.12, ior: 1.49,
    transparent: true, opacity: 0.3, depthWrite: false, envMapIntensity: 0.2,
  })),
  glassPrint: () => new THREE.MeshStandardMaterial({ color: 0x07080a, metalness: 0, roughness: 0.2 }),
  pcb: () => detailUV(std({ color: 0xffffff, map: tex.pcb(), bumpMap: tex.pcb(), bumpScale: 0.5, metalness: 0.15, roughness: 0.5 }), 6),
  heatsink: () => brushedMetal({ color: 0x3a404a, metalness: 0.9, roughness: 0.46 }, 2.5),
  aluLight: () => brushedMetal({ color: 0x9aa1aa, metalness: 1, roughness: 0.44 }, 2.5),
  // Nickel-plated copper (heatpipes, cold plates, the CPU's heat spreader) and bare copper.
  nickel: () => std({ color: 0xd2cec4, metalness: 1, roughness: 0.2 }),
  copper: () => std({ color: 0xc8794a, metalness: 1, roughness: 0.28 }),
  usbBlue: () => std({ color: 0x1846c8, metalness: 0, roughness: 0.4 }),
  steelBright: () => std({ color: 0xb4b9c0, metalness: 1, roughness: 0.3 }),
  plastic: () => moulded({ color: 0x18191d, metalness: 0, roughness: 0.62 }),
  plasticGloss: () => std({ color: 0x16181c, metalness: 0, roughness: 0.14 }),
  // Fan blades: smoked polycarbonate, slightly see-through.
  fanBlade: () => std({ color: 0x1d2025, metalness: 0, roughness: 0.42, transparent: true, opacity: 0.9 }),
  rubber: () => moulded({ color: 0x131417, metalness: 0, roughness: 0.95 }),
  sleeve: () => std({ color: 0x1b1d21, metalness: 0, roughness: 0.85, bumpMap: tex.weave(), bumpScale: 1.2 }),
  tubeBraid: () => std({ color: 0x17181b, metalness: 0, roughness: 0.8, bumpMap: tex.weave(), bumpScale: 1.4 }),
  radiatorCore: () => detailUV(std({ color: 0xffffff, map: tex.radiatorCore(), bumpMap: tex.radiatorCore(), bumpScale: 1, metalness: 0.6, roughness: 0.6 }), 0.9),
  psuBody: () => sandblasted({ color: 0x1e2024, metalness: 0.45, roughness: 0.66 }),
  brass: () => new THREE.MeshStandardMaterial({ color: 0xb08a4a, metalness: 1, roughness: 0.38 }),
  gold: () => new THREE.MeshStandardMaterial({ color: 0xd4a640, metalness: 1, roughness: 0.28 }),
  socketPga: () => new THREE.MeshStandardMaterial({ color: 0xd9d2c0, metalness: 0, roughness: 0.6 }),
  chip: () => new THREE.MeshStandardMaterial({ color: 0x141518, metalness: 0.2, roughness: 0.42 }),
  ssdPcb: () => new THREE.MeshStandardMaterial({ color: 0x10261d, metalness: 0.2, roughness: 0.55 }),
  driveShell: () => sandblasted({ color: 0x2a2e35, metalness: 0.8, roughness: 0.42 }),
  hddAlu: () => sandblasted({ color: 0x6c727b, metalness: 1, roughness: 0.42 }),
  // Lines: not tone-mapped so they match the CSS palette exactly.
  ghostLine: () => new THREE.LineDashedMaterial({ color: 0x8a93a0, dashSize: 1.2, gapSize: 0.8, transparent: true, opacity: 0.55, toneMapped: false }),
  ghostLineFaint: () => new THREE.LineDashedMaterial({ color: 0x8a93a0, dashSize: 0.6, gapSize: 0.6, transparent: true, opacity: 0.28, toneMapped: false }),
  highlight: () => new THREE.LineBasicMaterial({ color: 0x2f6bff, depthTest: false, transparent: true, opacity: 0.95, toneMapped: false }),
  // Build by hand: x-ray ghost of where a part goes (valid, wrong, hint) and its guide box.
  ghostOk: () => ghost(0x3ddc97),
  ghostBad: () => ghost(0xff4d4d),
  ghostHint: () => ghost(0x2f6bff),
  guideOk: () => guide(0x3ddc97),
  guideBad: () => guide(0xff4d4d),
  guideHint: () => guide(0x2f6bff),
  // Emissive LEDs: intensity above the bloom threshold so only these glow.
  ledWhite: () => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xd8e4f2, emissiveIntensity: 4 }),
  // The accent blue has low luminance, so it needs more intensity than white to clear the bloom threshold.
  ledAccent: () => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x2f6bff, emissiveIntensity: 9 }),
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

// ---------------------------------------------------------------- coloured finishes
// A surface finish in a named colour (look.js COLOURS), made once per pair and shared. Black
// reuses the base materials above, so a black build draws with exactly the same set as before.
const BLACK = { sleeve: 'tubeBraid', steel: 'caseSteel', inner: 'caseInner', alu: 'frameAlu', heatsink: 'heatsink', plastic: 'plastic', gloss: 'plasticGloss', anodised: 'psuBody', blade: 'fanBlade' };
// `pale`: paint on metal hides the metal, so light colours stay white instead of turning chrome.
const FINISH = {
  steel: (color, pale) => powderCoat({ color, metalness: pale ? 0.06 : 0.35, roughness: 0.6 }),
  inner: (color, pale) => powderCoat({ color, metalness: pale ? 0.05 : 0.25, roughness: 0.74 }),
  alu: (color, pale) => brushedMetal({ color, metalness: pale ? 0.35 : 0.9, roughness: 0.42 }),
  heatsink: (color, pale) => brushedMetal({ color, metalness: pale ? 0.35 : 0.9, roughness: 0.46 }, 2.5),
  bare: (color) => brushedMetal({ color, metalness: 1, roughness: 0.4 }, 2.5),
  plastic: (color) => moulded({ color, metalness: 0, roughness: 0.62 }),
  gloss: (color) => std({ color, metalness: 0, roughness: 0.14 }),
  anodised: (color, pale) => sandblasted({ color, metalness: pale ? 0.2 : 0.45, roughness: 0.66 }),
  mirror: (color) => std({ color, metalness: 1, roughness: 0.07 }),
  blade: (color, pale) => std({ color, metalness: 0, roughness: 0.42, transparent: !pale, opacity: pale ? 1 : 0.9 }),
  wood: (color) => detailUV(std({ color, map: tex.woodGrain(), roughness: 0.7, metalness: 0 }), 6),
  flat: (color) => std({ color, metalness: 0, roughness: 0.5 }),
  sleeve: (color) => std({ color, metalness: 0, roughness: 0.8, bumpMap: tex.weave(), bumpScale: 1.4 }),
};
const lum = (hex) => (0.2126 * ((hex >> 16) & 255) + 0.7152 * ((hex >> 8) & 255) + 0.0722 * (hex & 255)) / 255;

/**
 * Shared material: finish `kind` in `colour` (a look.js colour name, or a hex number).
 * @param {'steel'|'inner'|'alu'|'heatsink'|'bare'|'plastic'|'gloss'|'anodised'|'mirror'|'blade'|'wood'|'flat'} kind
 */
export function finish(kind, colour = 'black') {
  if (colour === 'black' && BLACK[kind]) return mat(BLACK[kind]);
  const hex = typeof colour === 'number' ? colour : COLOURS[colour] ?? COLOURS.black;
  const key = `${kind}:${hex}`;
  if (!cache.has(key)) {
    const make = FINISH[kind];
    if (!make) throw new Error(`Unknown finish: ${kind}`);
    cache.set(key, share(make(hex, lum(hex) > 0.45)));
  }
  return cache.get(key);
}

/** Tileable alpha mask of round holes for perforated steel / mesh panels. */
export function perforationTexture(anisotropy = 4) {
  return tex.perforation(anisotropy).alpha;
}

/** Mesh panel material with holes, repeated so each tile is `pitch` cm. Owned by the caller (not shared). */
export function meshPanelMaterial(widthCm, heightCm, pitch = 0.7, anisotropy = 4, { pattern = 'round', colour = 'black' } = {}) {
  const { alpha, normal } = tex.perforation(anisotropy, pattern);
  const pale = colour === 'white' || colour === 'silver';
  const tile = (t) => {
    const c = t.clone();
    c.repeat.set(widthCm / pitch, heightCm / pitch);
    c.needsUpdate = true;
    return c;
  };
  return new THREE.MeshStandardMaterial({
    color: colour === 'black' ? 0x25282e : COLOURS[colour] ?? 0x25282e, metalness: pale ? 0.1 : 0.6, roughness: 0.5,
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

/**
 * Frosted plastic over LEDs (light bars, lit fan blades, pump caps): milky white when off,
 * and a softer, wider glow than a bare LED when lit (`gain` scales what effects.js sets).
 * Owned by one part, like ledMaterial(). `opacity` < 1 for translucent blades.
 */
export function diffuserMaterial({ gain = 0.55, opacity = 1, tint = 0xc4c9cf } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.6, metalness: 0, emissive: 0xd8e4f2, emissiveIntensity: 0, transparent: opacity < 1, opacity });
  m.userData.led = true;
  m.userData.gain = gain;
  return m;
}

/**
 * A small display (AIO pump screens, PSU read-outs): its own picture, lit only while the PC
 * is on. It keeps its colours: the lighting controls only switch it on and off.
 * @param {THREE.Texture} texture owned by the caller's model
 */
export function screenMaterial(texture) {
  const m = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.15, metalness: 0, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0 });
  m.userData.led = true;
  m.userData.screen = true;
  return m;
}
