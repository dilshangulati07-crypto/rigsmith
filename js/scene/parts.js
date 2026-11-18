// Model factory: one interface for every part type.
//   createModel(part, ctx) -> Promise<THREE.Group>
// It uses models/<partId>.glb when models/index.json lists that id (1 unit = 1 cm, same
// axes and origin as the procedural model), otherwise the procedural model for the type.
// models/index.json can also name one base model per category ("categories"): it is scaled
// into the procedural model's bounding box, so it matches every part's real dimensions, and
// the procedural model's placement data (pieces, sockets) is kept. The manifest avoids a 404
// request per part. To add a part type: write a builder in js/scene/models/ and register it in TYPES.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { disposeTree } from './resources.js?v=733eefba1e';
import { buildCase } from './case.js?v=733eefba1e';
import { buildMotherboard } from './models/motherboard.js?v=733eefba1e';
import { buildPSU } from './models/psu.js?v=733eefba1e';
import { buildStorage } from './models/storage.js?v=733eefba1e';
import { buildFans, fansFromGLB } from './models/fans.js?v=733eefba1e';
import { buildCPU } from './models/cpu.js?v=733eefba1e';
import { buildCooler } from './models/cooler.js?v=733eefba1e';
import { buildRAM } from './models/ram.js?v=733eefba1e';
import { buildGPU } from './models/gpu.js?v=733eefba1e';

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
function loadManifest() {
  manifest ??= fetch('models/index.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : {}))
    .then((j) => ({
      ids: new Set(Array.isArray(j.models) ? j.models : []),
      categories: j.categories && typeof j.categories === 'object' ? j.categories : {},
    }))
    .catch(() => ({ ids: new Set(), categories: {} }));
  return manifest;
}
const glbIds = async () => (await loadManifest()).ids;

// Category base model: the loaded scene scaled and centred into the procedural model's box.
// Only for models drawn as one piece (no separately placed units).
async function fitCategoryModel(entry, procedural) {
  if (procedural.userData.units?.length) return null;
  loader ??= new GLTFLoader();
  const gltf = await loader.loadAsync(`models/${encodeURIComponent(entry.file)}`);
  const model = gltf.scene;
  const want = new THREE.Box3().setFromObject(procedural);
  const have = new THREE.Box3().setFromObject(model);
  const ws = want.getSize(new THREE.Vector3());
  const hs = have.getSize(new THREE.Vector3());
  const k = new THREE.Vector3(ws.x / (hs.x || 1), ws.y / (hs.y || 1), ws.z / (hs.z || 1));
  if (entry.fit !== 'box') k.setScalar(Math.min(k.x, k.y, k.z)); // 'uniform' keeps proportions
  model.scale.copy(k);
  model.position.copy(want.getCenter(new THREE.Vector3())).sub(have.getCenter(new THREE.Vector3()).multiply(k));
  model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const g = new THREE.Group();
  g.name = procedural.name;
  g.add(model);
  g.userData = { ...procedural.userData, rotors: [], leds: [], approx: procedural.userData.approx ?? [] };
  return g;
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
  const base = (await loadManifest()).categories[part.category];
  if (base?.file) {
    try {
      const fitted = await fitCategoryModel(base, g);
      if (fitted) {
        fitted.userData.source = 'glb';
        disposeTree(g);
        return fitted;
      }
    } catch (err) {
      console.warn(`Rigsmith: models/${base.file} failed to load, using the procedural model.`, err);
    }
  }
  if (g.userData.rotor && !g.userData.rotors) g.userData.rotors = [g.userData.rotor];
  return g;
}
