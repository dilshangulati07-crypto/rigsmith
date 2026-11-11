// Contact shadow (Ultra): the soft dark patch directly under the case that a shadow map alone
// does not give. A camera under the floor looks up and records how close things are to the
// floor; that image is blurred and laid on the floor. Re-rendered only when the scene's
// shadows change, so it costs nothing per frame in a still view.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const HEIGHT = 16; // cm above the floor that still darkens it
const SIZE = 512;

const BlurShader = {
  uniforms: { tDiffuse: { value: null }, step: { value: new THREE.Vector2() } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 step; varying vec2 vUv;
    void main() {
      vec4 s = texture2D(tDiffuse, vUv) * 0.227;
      s += (texture2D(tDiffuse, vUv + step * 1.385) + texture2D(tDiffuse, vUv - step * 1.385)) * 0.316;
      s += (texture2D(tDiffuse, vUv + step * 3.231) + texture2D(tDiffuse, vUv - step * 3.231)) * 0.0703;
      gl_FragColor = s;
    }`,
};

/**
 * @param {object} viewer from createViewer()
 * @param {THREE.Object3D[]} hide objects to leave out (the floor itself)
 */
export function createContactShadow(viewer, hide = []) {
  const { renderer, scene } = viewer;
  const rtA = new THREE.WebGLRenderTarget(SIZE, SIZE, { generateMipmaps: false });
  const rtB = new THREE.WebGLRenderTarget(SIZE, SIZE, { generateMipmaps: false });

  const group = new THREE.Group();
  group.name = 'contact-shadow';
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: rtA.texture, transparent: true, depthWrite: false, opacity: 0.9, toneMapped: false }),
  );
  plane.scale.y = -1; // the camera looks up, so the image is mirrored
  plane.renderOrder = 1;
  plane.layers.set(1);
  group.add(plane);
  const camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, HEIGHT);
  camera.rotation.x = Math.PI / 2;
  camera.layers.enableAll();
  group.add(camera);
  group.visible = false;
  scene.add(group);

  // Depth as alpha: closer to the floor = darker.
  const depth = new THREE.MeshDepthMaterial();
  depth.depthTest = false;
  depth.depthWrite = false;
  depth.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
      'gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * 0.85 );',
    );
  };
  const blur = new THREE.ShaderMaterial(BlurShader);
  blur.depthTest = false;
  const quad = new FullScreenQuad(blur);

  function pass(from, to, x, y) {
    blur.uniforms.tDiffuse.value = from.texture;
    blur.uniforms.step.value.set(x / SIZE, y / SIZE);
    renderer.setRenderTarget(to);
    quad.render(renderer);
  }

  function update() {
    if (!group.visible) return;
    const background = scene.background;
    const alpha = renderer.getClearAlpha();
    const target = renderer.getRenderTarget();
    const shown = hide.map((o) => o.visible);
    hide.forEach((o) => { o.visible = false; });
    plane.visible = false;
    scene.background = null;
    scene.overrideMaterial = depth;
    renderer.setClearAlpha(0);
    viewer.post.withAuxHidden(() => {
      renderer.setRenderTarget(rtA);
      renderer.clear();
      renderer.render(scene, camera);
    });
    scene.overrideMaterial = null;
    for (const r of [2.2, 1.1]) {
      pass(rtA, rtB, r, 0);
      pass(rtB, rtA, 0, r);
    }
    renderer.setRenderTarget(target);
    renderer.setClearAlpha(alpha);
    scene.background = background;
    plane.visible = true;
    hide.forEach((o, i) => { o.visible = shown[i]; });
  }
  const off = viewer.onShadowUpdate(update);

  return {
    group,
    /** Centre the patch under an object of this footprint radius (cm). */
    fit(center, radius) {
      const s = radius * 2.6;
      group.position.set(center.x, 0.04, center.z);
      plane.scale.set(s, -1, s);
      camera.left = -s / 2; camera.right = s / 2; camera.top = s / 2; camera.bottom = -s / 2;
      camera.updateProjectionMatrix();
    },
    setVisible(on) { group.visible = on; },
    dispose() {
      off();
      group.removeFromParent();
      rtA.dispose();
      rtB.dispose();
      plane.geometry.dispose();
      plane.material.dispose();
      depth.dispose();
      quad.dispose();
      blur.dispose();
    },
  };
}
