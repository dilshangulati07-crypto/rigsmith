// Still renders of whole builds for preset cards and compare columns. One offscreen viewer
// per page (one WebGL context, whatever the number of cards) built from the same renderer,
// stage and build scene as the 3D view, so a thumbnail looks like the build in the builder.
// Builds render one at a time, in the viewer's colour theme, powered on with the lighting lit;
// js/ui/build-thumb.js caches the images.
import * as THREE from 'three';
import { createViewer } from './renderer.js?v=00a22f4faf';
import { createStage } from './stage.js?v=00a22f4faf';
import { createBuildScene } from './build-scene.js?v=00a22f4faf';
import { FOOT } from './layout.js?v=00a22f4faf';
import { emptyBuild } from '../state.js?v=00a22f4faf';
import { createEffects } from './effects.js?v=00a22f4faf';
import { loadTheme } from './look.js?v=00a22f4faf';

const VIEW_DIR = new THREE.Vector3(0.62, 0.32, 0.72).normalize(); // the viewer's 3/4 preset

/**
 * @param {{width?: number, height?: number}} opts CSS pixels of the render (device pixels = x DPR, max 2)
 * @returns {{ render(build): Promise<string|null>, dispose(): void }}
 */
export function createBuildThumbs({ width = 400, height = 300 } = {}) {
  const holder = document.createElement('div');
  holder.setAttribute('aria-hidden', 'true');
  holder.style.cssText = `position:fixed;left:-${width + 100}px;top:0;width:${width}px;height:${height}px;pointer-events:none;overflow:hidden;`;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100%;display:block;';
  holder.append(canvas);
  document.body.append(holder);

  const viewer = createViewer(canvas, { fov: 30, quality: 'high', staticShadows: true });
  const stage = createStage(viewer.scene, { shadowMapSize: 1024 });
  const bscene = createBuildScene({ viewer, anisotropy: Math.min(4, viewer.maxAnisotropy), reducedMotion: true, theme: loadTheme() });
  const fx = createEffects({ viewer, scene: bscene, reducedMotion: true });
  const { camera } = viewer;
  const center = new THREE.Vector3();

  async function render(build) {
    await viewer.envReady; // every thumbnail under the same studio lighting
    bscene.sync(build);
    while (bscene.busy) await new Promise((r) => setTimeout(r, 16));
    const c = bscene.layout.case;
    center.set(0, FOOT + c.H / 2, 0);
    const radius = 0.5 * Math.hypot(c.D, c.H, c.W);
    stage.fit(center, radius);
    // Fit the case's bounding sphere in the narrower field of view, a little tight.
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    const dist = (radius / Math.sin(Math.min(vfov, hfov) / 2)) * 0.86;
    camera.position.copy(center).addScaledVector(VIEW_DIR, dist);
    camera.near = Math.max(1, dist - radius * 2);
    camera.far = dist + radius * 3;
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    fx.refresh();
    fx.setPower(true, { instant: true });
    fx.update(0);
    viewer.invalidateShadows();
    try { await viewer.compile(); } catch { /* warm-up only */ }
    // Render and read back in the same task (no preserveDrawingBuffer needed).
    viewer.render();
    return canvas.toDataURL('image/jpeg', 0.84);
  }

  return {
    render,
    dispose() {
      bscene.sync(emptyBuild());
      holder.remove();
    },
  };
}
