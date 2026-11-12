// Small product shots of parts for the build-by-hand tray, rendered with the viewer's own
// renderer and lighting (no second WebGL context). Each shot is drawn into a corner of the
// main canvas with the scissor test, copied out in the same task, and the caller redraws the
// main frame afterwards, so nothing is ever shown on screen.
import * as THREE from 'three';
import { compensateToneMapping } from './renderer.js';

const box = new THREE.Box3();
const sphere = new THREE.Sphere();
const size = new THREE.Vector2();
const css = new THREE.Vector2();

/**
 * @param {{renderer: THREE.WebGLRenderer, scene: THREE.Scene}} viewer
 * @param {{width?: number, height?: number, background?: string}} opts size in device pixels
 */
export function createThumbnailer(viewer, { width = 160, height = 120, background = '#181C22' } = {}) {
  const scene = new THREE.Scene();
  scene.background = compensateToneMapping(background);
  scene.environment = viewer.scene.environment;
  scene.environmentIntensity = 1.25;
  const camera = new THREE.PerspectiveCamera(26, width / height, 0.5, 500);
  camera.layers.enable(1); // clones live on the no-pick layer
  const key = new THREE.DirectionalLight(0xfff4ea, 2.6);
  key.position.set(1, 1.4, 1.2);
  camera.add(key);
  scene.add(camera);

  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d');

  /**
   * Render `object` (not attached anywhere) seen from local direction `dir`. Returns a data
   * URL, or null when the canvas is too small to hold the shot.
   */
  function shoot(object, dir = [0.3, 0.3, 1]) {
    const { renderer } = viewer;
    scene.environment = viewer.scene.environment; // follows the studio lighting once it has loaded
    camera.layers.mask = viewer.camera.layers.mask; // the same detail layers as the quality level
    renderer.getDrawingBufferSize(size);
    if (size.x < width || size.y < height) return null;
    scene.add(object);
    object.updateMatrixWorld(true);
    box.setFromObject(object).getBoundingSphere(sphere);
    const r = Math.max(sphere.radius, 0.5);
    const dist = r / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2) * 0.98;
    camera.position.copy(sphere.center).addScaledVector(new THREE.Vector3(...dir).normalize(), dist);
    camera.lookAt(sphere.center);
    camera.near = Math.max(0.1, dist - r * 2);
    camera.far = dist + r * 2;
    camera.updateProjectionMatrix();

    const pr = renderer.getPixelRatio();
    renderer.getSize(css);
    const target = renderer.getRenderTarget();
    renderer.setRenderTarget(null);
    renderer.setScissorTest(true);
    renderer.setViewport(0, 0, width / pr, height / pr);
    renderer.setScissor(0, 0, width / pr, height / pr);
    renderer.render(scene, camera);
    ctx.drawImage(renderer.domElement, 0, size.y - height, width, height, 0, 0, width, height);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, css.x, css.y);
    renderer.setRenderTarget(target);
    scene.remove(object);
    return out.toDataURL('image/png');
  }

  return {
    shoot,
    dispose() {
      key.dispose();
      scene.clear();
    },
  };
}
