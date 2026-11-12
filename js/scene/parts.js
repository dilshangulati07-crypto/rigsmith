// Model factory: one interface for every part type.
//   createModel(part, ctx) -> Promise<THREE.Group>
// It uses models/<partId>.glb when models/index.json lists that id (1 unit = 1 cm, same
// axes and origin as the procedural model), otherwise the procedural model for the type.
// The manifest avoids a 404 request per part. To add a part type: write a builder in
// js/scene/models/ and register it in TYPES.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildCase } from './case.js';
import { buildMotherboard } from './models/motherboard.js';
import { buildPSU } from './models/psu.js';
import { buildStorage } from './models/storage.js';
import { buildFans, fansFromGLB } from './models/fans.js';
import { buildCPU } from './models/cpu.js';
import { buildCooler } from './models/cooler.js';
import { buildRAM } from './models/ram.js';
import { buildGPU } from './models/gpu.js';

// build(part, ctx): procedural. fromGLB(scene, part, ctx): optional adapter for a loaded model.
// ctx = { caseLayout, anisotropy, theme } (theme: the viewer's black / white build theme, see look.js)
// Models may set userData: units (separately placed pieces), rotors (spinning fans),
// leds (owned LED materials for the lighting controls), approx (assumed sizes, shown on hover).
// Order matters: the case is built first.
const TYPES = {
  case: { build: (p, ctx) => buildCase(p, ctx.caseLayout, ctx) },
  motherboard: { build: (p, ctx) => buildMotherboard(p, ctx) },
  cpu: { build: (p, ctx) => buildCPU(p, ctx) },
  cooler: { build: (p, ctx) => buildCooler(p, ctx) },
  ram: { build: (p, ctx) => buildRAM(p, ctx) },
  gpu: { build: (p, ctx) => buildGPU(p, ctx) },
  psu: { build: (p, ctx) => buildPSU(p, ctx) },
  storage: { build: (p, ctx) => buildStorage(p, ctx) },
  fans: { build: (p, ctx) => buildFans(p, ctx), fromGLB: fansFromGLB },
};

export const MODELLED = Object.freeze(Object.keys(TYPES));
export const canModel = (category) => category in TYPES;

let manifest = null;
function glbIds() {
  manifest ??= fetch('models/index.json')
    .then((r) => (r.ok ? r.json() : { models: [] }))
    .then((j) => new Set(Array.isArray(j.models) ? j.models : []))
    .catch(() => new Set());
  return manifest;
}

let loader = null;
async function loadGLB(part, ctx) {
  loader ??= new GLTFLoader();
  const gltf = await loader.loadAsync(`models/${encodeURIComponent(part.id)}.glb`);
  const scene = gltf.scene;
  scene.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  const g = TYPES[part.category].fromGLB?.(scene, part, ctx) ?? scene;
  // Case models: a node named "side-panel" is used by the side panel toggle.
  if (part.category === 'case') g.userData.sidePanel = scene.getObjectByName('side-panel') ?? null;
  return g;
}

/**
 * @param {object} part a part from the catalogue
 * @param {{caseLayout?: object, anisotropy?: number, theme?: string}} ctx
 * @returns {Promise<import('three').Group>}
 */
export async function createModel(part, ctx = {}) {
  const type = TYPES[part.category];
  if (!type) throw new Error(`No 3D model for category "${part.category}"`);
  if ((await glbIds()).has(part.id)) {
    try {
      const g = await loadGLB(part, ctx);
      g.userData.source = 'glb';
      g.userData.rotors ??= [g.getObjectByName('rotor')].filter(Boolean);
      return g;
    } catch (err) {
      console.warn(`Rigsmith: models/${part.id}.glb failed to load, using the procedural model.`, err);
    }
  }
  const g = type.build(part, ctx);
  g.userData.source = 'procedural';
  if (g.userData.rotor && !g.userData.rotors) g.userData.rotors = [g.userData.rotor];
  return g;
}
