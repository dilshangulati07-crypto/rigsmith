// Product-photo stage shared by the landing hero and the builder viewer: a dark floor that
// fades out radially (no visible horizon), a soft shadow-casting key light and a cool rim.
import * as THREE from 'three';
import { share } from './resources.js';

let floorMat = null;
function floorMaterial() {
  if (floorMat) return floorMat;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, '#fff');
  grad.addColorStop(0.35, '#bbb');
  grad.addColorStop(1, '#000');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  floorMat = share(new THREE.MeshStandardMaterial({
    color: 0x0f1115, metalness: 0, roughness: 0.9,
    alphaMap: share(new THREE.CanvasTexture(c)), transparent: true, depthWrite: false,
  }));
  return floorMat;
}

/**
 * @param {THREE.Scene} scene
 * @param {{shadowMapSize?: number}} opts
 * @returns {{key: THREE.DirectionalLight, rim: THREE.DirectionalLight, floor: THREE.Mesh, fit: (center: THREE.Vector3, radius: number) => void}}
 */
export function createStage(scene, { shadowMapSize = 1024 } = {}) {
  const key = new THREE.DirectionalLight(0xfff4ea, 2.2);
  key.castShadow = true;
  key.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  scene.add(key, key.target);

  const rim = new THREE.DirectionalLight(0xbcd0ff, 1.1);
  scene.add(rim, rim.target);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), floorMaterial());
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.layers.set(1); // never picked
  scene.add(floor);

  // Aim the lights and size the shadow camera and floor around an object.
  function fit(center, radius) {
    const r = Math.max(radius, 10);
    key.position.set(center.x + r * 1.3, center.y + r * 2.4, center.z + r * 1.75);
    key.target.position.copy(center);
    const cam = key.shadow.camera;
    cam.left = -r * 1.2; cam.right = r * 1.2; cam.top = r * 1.2; cam.bottom = -r * 1.2;
    cam.near = r * 0.8; cam.far = r * 6;
    cam.updateProjectionMatrix();
    rim.position.set(center.x - r * 1.8, center.y + r * 1.4, center.z - r * 1.6);
    rim.target.position.copy(center);
    floor.scale.set(r * 8, r * 8, 1);
    floor.position.set(center.x, 0, center.z);
  }
  fit(new THREE.Vector3(0, 23, 0), 33);

  return { key, rim, floor, fit };
}
