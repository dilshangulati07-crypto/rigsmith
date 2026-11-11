// Image-based lighting. Starts with three.js's built-in RoomEnvironment (always available),
// then swaps in a studio HDRI: vendor/hdri/studio_small_08 from Poly Haven (CC0), 1k at High
// and 2k at Ultra. Low keeps the room. If the file is missing or fails, the room stays.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const HDRI = { high: 'vendor/hdri/studio_small_08_1k.hdr', ultra: 'vendor/hdri/studio_small_08_2k.hdr' };
const ROOM_INTENSITY = 0.75;
const HDRI_INTENSITY = 1.0;
// Turn the studio so its softbox sits front-left of the case, where the key light is.
const HDRI_ROTATION = 0.9;

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {{onChange?: () => void}} opts
 */
export function createEnvironment(renderer, scene, { onChange } = {}) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomScene = new RoomEnvironment();
  const room = pmrem.fromScene(roomScene, 0.04);
  roomScene.dispose();
  const loaded = new Map(); // level -> render target
  let level = 'low';
  let disposed = false;
  let ready = Promise.resolve();

  function apply() {
    const rt = loaded.get(level);
    scene.environment = (rt ?? room).texture;
    scene.environmentIntensity = rt ? HDRI_INTENSITY : ROOM_INTENSITY;
    scene.environmentRotation.set(0, rt ? HDRI_ROTATION : 0, 0);
    onChange?.();
  }

  async function load(lv) {
    if (loaded.has(lv) || !HDRI[lv]) return;
    try {
      const { RGBELoader } = await import('three/addons/loaders/RGBELoader.js');
      const hdr = await new RGBELoader().loadAsync(HDRI[lv]);
      if (disposed) { hdr.dispose(); return; }
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      loaded.set(lv, pmrem.fromEquirectangular(hdr));
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
