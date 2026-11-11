// Product-photo stage shared by the landing hero, the builder viewer and the thumbnails: a
// seamless graphite floor that fades out radially (no visible horizon), a soft
// shadow-casting key light and a cool rim. With a viewer it also follows the quality level:
// Ultra adds a contact shadow under the case, a soft reflection in the floor and a larger
// shadow map. Photo mode can swap the backdrop (studio dark, studio light, desk).
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { detailUV } from './materials.js';
import * as tex from './textures.js';
import { createContactShadow } from './contact-shadow.js';

export const BACKDROPS = Object.freeze([
  { id: 'dark', label: 'Studio dark', background: CONFIG.scene.background, floor: 0x121418, roughness: 0.78 },
  { id: 'light', label: 'Studio light', background: 0xcfd3d8, floor: 0xc4c8ce, roughness: 0.62 },
  { id: 'desk', label: 'Desk', background: 0x121418, floor: 0xffffff, roughness: 0.48, wood: true },
]);

function fadeTexture() {
  const [c, g] = tex.canvas(256);
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, '#fff');
  grad.addColorStop(0.35, '#bbb');
  grad.addColorStop(1, '#000');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

// Soft mirror image of the scene, added on top of the floor: blurred, and fading with
// distance from the centre. `vUv` is the projective coordinate three.js's Reflector supplies.
const ReflectionShader = {
  name: 'FloorReflection',
  uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, strength: { value: 0.3 } },
  vertexShader: `uniform mat4 textureMatrix; varying vec4 vUv; varying vec2 vPlane;
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vPlane = uv - 0.5;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float strength; varying vec4 vUv; varying vec2 vPlane;
    void main() {
      vec2 uv = vUv.xy / vUv.w;
      vec4 sum = vec4(0.0);
      for (int x = -2; x <= 2; x++) for (int y = -2; y <= 2; y++) sum += texture2D(tDiffuse, uv + vec2(float(x), float(y)) * 0.0035);
      sum /= 25.0;
      float fade = 1.0 - smoothstep(0.12, 0.5, length(vPlane));
      gl_FragColor = vec4(sum.rgb * sum.a * strength * fade, 1.0);
    }`,
};

/**
 * @param {THREE.Scene} scene
 * @param {{shadowMapSize?: number, viewer?: object}} opts viewer: from createViewer(), enables the Ultra extras and backdrops
 */
export function createStage(scene, { shadowMapSize = 1024, viewer = null } = {}) {
  const key = new THREE.DirectionalLight(0xfff4ea, 2.2);
  key.castShadow = true;
  key.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  scene.add(key, key.target);

  const rim = new THREE.DirectionalLight(0xbcd0ff, 1.1);
  scene.add(rim, rim.target);

  const floorMat = detailUV(new THREE.MeshStandardMaterial({
    color: BACKDROPS[0].floor, metalness: 0, roughness: BACKDROPS[0].roughness,
    roughnessMap: tex.grain(), alphaMap: fadeTexture(), transparent: true, depthWrite: false,
    envMapIntensity: 0.3, // a matte sweep: the studio softbox must not show up as a bright patch
  }), 2.4);
  // detailUV() only remaps colour, bump and roughness, so the alpha fade keeps the plane's own UVs.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.layers.set(1); // never picked
  scene.add(floor);

  let contact = null;
  let reflection = null;
  let ultra = false;
  let backdrop = 'dark';
  let last = { center: new THREE.Vector3(0, 23, 0), radius: 33 };

  async function enableUltra() {
    if (!viewer || reflection) return;
    contact = createContactShadow(viewer, [floor]);
    const { Reflector } = await import('three/addons/objects/Reflector.js');
    if (reflection) return;
    reflection = new Reflector(new THREE.PlaneGeometry(1, 1), { textureWidth: 1024, textureHeight: 1024, shader: ReflectionShader, multisample: 0 });
    reflection.material.transparent = true;
    reflection.material.depthWrite = false;
    reflection.material.blending = THREE.AdditiveBlending;
    reflection.rotation.x = -Math.PI / 2;
    reflection.position.y = 0.02;
    reflection.renderOrder = 2;
    reflection.layers.set(1);
    // The mirror pass: no background (so empty space adds nothing), no floor, same detail layers.
    const mirror = reflection.onBeforeRender;
    reflection.onBeforeRender = (renderer, s, camera) => {
      const bg = s.background;
      const alpha = renderer.getClearAlpha();
      const hide = [floor, contact.group].filter((o) => o.visible);
      hide.forEach((o) => { o.visible = false; });
      s.background = null;
      renderer.setClearAlpha(0);
      reflection.camera.layers.mask = camera.layers.mask;
      mirror.call(reflection, renderer, s, camera);
      renderer.setClearAlpha(alpha);
      s.background = bg;
      hide.forEach((o) => { o.visible = true; });
    };
    scene.add(reflection);
    apply();
    fit(last.center, last.radius);
    viewer.invalidateShadows();
  }

  function apply() {
    const b = BACKDROPS.find((x) => x.id === backdrop);
    floorMat.color.set(b.floor);
    floorMat.roughness = b.roughness;
    const map = b.wood ? tex.wood() : null;
    if (floorMat.map !== map) {
      floorMat.map = map;
      floorMat.needsUpdate = true;
    }
    floorMat.userData.detailTile.value = 1 / (b.wood ? 60 : 2.4);
    viewer?.setBackground(b.background);
    contact?.setVisible(ultra);
    if (reflection) {
      reflection.visible = ultra;
      reflection.material.uniforms.strength.value = b.id === 'light' ? 0.16 : 0.3;
    }
  }

  // Aim the lights and size the shadow camera and floor around an object.
  function fit(center, radius) {
    last = { center: center.clone(), radius };
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
    contact?.fit(center, r);
    if (reflection) {
      reflection.scale.set(r * 6, r * 6, 1);
      reflection.position.set(center.x, 0.02, center.z);
    }
  }
  fit(last.center, last.radius);

  return {
    key, rim, floor, fit,
    /** Follow the viewer's quality level. */
    setQuality(quality) {
      ultra = quality === 'ultra';
      const size = ultra ? Math.max(4096, shadowMapSize) : shadowMapSize;
      if (key.shadow.mapSize.x !== size) {
        key.shadow.mapSize.set(size, size);
        key.shadow.map?.dispose();
        key.shadow.map = null;
      }
      apply();
      return ultra ? enableUltra() : Promise.resolve();
    },
    /** @param {'dark'|'light'|'desk'} id */
    setBackdrop(id) {
      if (!BACKDROPS.some((b) => b.id === id)) return;
      backdrop = id;
      apply();
    },
    get backdrop() { return backdrop; },
  };
}
