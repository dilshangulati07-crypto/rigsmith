// Image-based lighting with a product-photo rig baked in. The base is three.js's built-in
// RoomEnvironment (Low, and until the file loads) or a studio HDRI: vendor/hdri/studio_small_08
// from Poly Haven (CC0), 1k at High and 2k at Ultra. On top of it sit emissive softboxes, baked
// into the same environment map, so they cost nothing per frame (a real-time light costs every
// lit pixel; on integrated graphics each one took 10-15 % of the frame):
//   fill     a large dim panel on the glass side: what faces the glass (board, memory, card) reads
//   front    a soft panel low in front of the case: lifts the front and the shroud
//   rim      tall strips behind the case, cool blue on the glass side and warm on the other,
//            and a white one across the top: coloured edge highlights on glossy parts
//   key      a large softbox where the shadow-casting key light is (stage.js), so glossy parts
//            show its reflection
//   floor    a light-grey disc under the subject, matching the stage's studio sweep
// Directions are in the case's frame: +X front, +Z glass side, +Y up.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const HDRI = { high: 'vendor/hdri/studio_small_08_1k.hdr', ultra: 'vendor/hdri/studio_small_08_2k.hdr' };
const ROOM_INTENSITY = 0.75;
const HDRI_INTENSITY = 1.0;
// Turn the studio so its softbox sits front-left of the case, where the key light is.
const HDRI_ROTATION = 0.9;

const FLOOR = 0.42; // radiance of the light-grey studio floor
// [direction, width, height, radiance]: a panel `width` x `height` at distance 9, facing the origin.
const SOFTBOXES = [
  { name: 'key', dir: [1.0, 1.7, 1.9], w: 7, h: 5, k: 4.5 },
  { name: 'fill', dir: [0.15, 0.35, 1], w: 9, h: 6, k: 1.5 },
  { name: 'fill-back', dir: [0.2, 0.4, -1], w: 8, h: 6, k: 0.6 },
  { name: 'front', dir: [1, 0.1, 0.25], w: 6, h: 3, k: 0.7 },
  { name: 'rim-left', dir: [-1, 0.35, 0.75], w: 2.2, h: 8, k: 10, c: 0x5f8cff },
  { name: 'rim-right', dir: [-1, 0.35, -0.75], w: 2.2, h: 8, k: 5, c: 0xffd9bd },
  { name: 'rim-top', dir: [-0.6, 1, 0], w: 8, h: 0.9, k: 6 },
];

function addSoftboxes(scene) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const made = [];
  const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color().setScalar(FLOOR), toneMapped: false }));
  floor.position.y = -0.5; // inside the RoomEnvironment box too
  scene.add(floor);
  made.push(floor);
  for (const s of SOFTBOXES) {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(s.c ?? 0xffffff).multiplyScalar(s.k), side: THREE.DoubleSide, toneMapped: false });
    const mesh = new THREE.Mesh(geo, m);
    mesh.name = `softbox-${s.name}`;
    mesh.position.set(...s.dir).normalize().multiplyScalar(9);
    mesh.scale.set(s.w, s.h, 1);
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
    made.push(mesh);
  }
  return () => {
    for (const m of made) { m.removeFromParent(); m.material.dispose(); }
    geo.dispose();
    floor.geometry.dispose();
  };
}

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {{onChange?: () => void}} opts
 */
export function createEnvironment(renderer, scene, { onChange } = {}) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomScene = new RoomEnvironment();
  const removeRoomBoxes = addSoftboxes(roomScene);
  const room = pmrem.fromScene(roomScene, 0.04);
  removeRoomBoxes();
  roomScene.dispose();
  const loaded = new Map(); // level -> render target
  let level = 'low';
  let disposed = false;
  let ready = Promise.resolve();

  function apply() {
    const rt = loaded.get(level);
    scene.environment = (rt ?? room).texture;
    scene.environmentIntensity = rt ? HDRI_INTENSITY : ROOM_INTENSITY;
    scene.environmentRotation.set(0, 0, 0); // the studio's turn is baked in
    onChange?.();
  }

  // The HDRI as the backdrop of a scene that holds the softboxes, captured into one map.
  function bakeStudio(hdr) {
    const studio = new THREE.Scene();
    studio.background = hdr;
    studio.backgroundRotation.set(0, HDRI_ROTATION, 0);
    const removeBoxes = addSoftboxes(studio);
    const rt = pmrem.fromScene(studio, 0, 0.1, 100);
    removeBoxes();
    return rt;
  }

  async function load(lv) {
    if (loaded.has(lv) || !HDRI[lv]) return;
    try {
      const { RGBELoader } = await import('three/addons/loaders/RGBELoader.js');
      const hdr = await new RGBELoader().loadAsync(HDRI[lv]);
      if (disposed) { hdr.dispose(); return; }
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      loaded.set(lv, bakeStudio(hdr));
      hdr.dispose();
    } catch (err) {
      console.warn(`Rigsmith: studio lighting (${HDRI[lv]}) did not load, using the built-in room.`, err);
    }
  }

  apply();
  return {
    /** Resolves when the lighting for the current level is in place (or has fallen back). */
    get ready() { return ready; },
    get isStudio() { return loaded.has(level); },
    setLevel(lv) {
      level = lv;
      apply();
      ready = load(lv).then(() => { if (!disposed && level === lv) apply(); });
      return ready;
    },
    dispose() {
      disposed = true;
      room.dispose();
      for (const rt of loaded.values()) rt.dispose();
      pmrem.dispose();
    },
  };
}
