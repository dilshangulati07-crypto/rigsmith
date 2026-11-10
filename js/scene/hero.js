// Landing-page hero scene: demo PC on a floor, slow sway, power-on intro.
import * as THREE from 'three';
import { createViewer } from './renderer.js';
import { buildDemoPC } from './demo-pc.js';

const TARGET = new THREE.Vector3(0, 23, 0);
// Camera direction: front-left of the case, looking through the glass side.
const VIEW_DIR = new THREE.Vector3(0.58, 0.3, 0.76).normalize();

// Dark matte floor that fades out radially, so there is no visible horizon.
function floorMaterial() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, '#fff');
  grad.addColorStop(0.35, '#bbb');
  grad.addColorStop(1, '#000');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return new THREE.MeshStandardMaterial({
    color: 0x0f1115, metalness: 0, roughness: 0.9,
    alphaMap: new THREE.CanvasTexture(c), transparent: true, depthWrite: false,
  });
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{reducedMotion: boolean, onProgress?: (step: string, frac: number) => void, onQualityChange?: Function}} opts
 */
export async function startHero(canvas, { reducedMotion, onProgress, onQualityChange }) {
  onProgress?.('Starting renderer', 0.25);
  let pointer = { x: 0, y: 0 };
  let ready = false;

  const viewer = createViewer(canvas, {
    fov: 30,
    onQualityChange,
    onResize: () => { if (ready) frameCamera(); },
  });
  const { scene, camera } = viewer;

  function frameCamera() {
    // Keep ~80 cm of scene in view on both axes, whatever the canvas aspect.
    const fit = 80 / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    const dist = fit * Math.max(1, 1 / camera.aspect);
    camera.position.copy(VIEW_DIR).multiplyScalar(dist).add(TARGET);
    camera.position.x += pointer.x * 6;
    camera.position.y += pointer.y * 4;
    camera.lookAt(TARGET);
  }

  onProgress?.('Building scene', 0.5);
  scene.fog = new THREE.Fog(viewer.fogColor, 220, 520);

  const key = new THREE.DirectionalLight(0xfff4ea, 2.2);
  key.position.set(60, 110, 80);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -45;
  key.shadow.camera.right = 45;
  key.shadow.camera.top = 45;
  key.shadow.camera.bottom = -45;
  key.shadow.camera.near = 40;
  key.shadow.camera.far = 260;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  scene.add(key);

  const rim = new THREE.DirectionalLight(0xbcd0ff, 1.1);
  rim.position.set(-80, 60, -70);
  scene.add(rim);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(320, 320), floorMaterial());
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const pc = buildDemoPC({ anisotropy: Math.min(8, viewer.maxAnisotropy) });
  scene.add(pc.group);
  ready = true;
  frameCamera();

  onProgress?.('Compiling shaders', 0.75);
  await viewer.compile();

  // Power-on intro: LEDs and fans ramp up over ~1.6 s.
  let power = reducedMotion ? 1 : 0;
  let t = 0;
  pc.update(0, power);

  function frame(dt) {
    t += dt;
    if (power < 1) power = Math.min(1, power + dt / 1.6);
    pc.update(dt, power);
    pc.group.rotation.y = Math.sin(t * 0.16) * 0.5;
    frameCamera();
  }

  if (reducedMotion) {
    // Static image; re-rendered on resize by the viewer.
    viewer.render();
  } else {
    viewer.start(frame);
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      pointer = { x: (e.clientX - r.left) / r.width - 0.5, y: 0.5 - (e.clientY - r.top) / r.height };
    });
    canvas.addEventListener('pointerleave', () => { pointer = { x: 0, y: 0 }; });
  }

  onProgress?.('Ready', 1);

  return {
    viewer,
    /** Pause/resume the loop, e.g. when the hero scrolls out of view. */
    setActive(active) {
      if (reducedMotion) return;
      if (active) viewer.start();
      else viewer.stop();
    },
  };
}
