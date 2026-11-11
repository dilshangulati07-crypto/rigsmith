// Post-processing pipeline for High and Ultra (Low renders straight to the canvas).
//   High:  scene -> [depth of field] -> bloom -> tone mapping
//          (the vignette is a CSS overlay at High: a full-screen pass costs ~10 fps on integrated graphics)
//   Ultra: scene -> ambient occlusion (GTAO) -> [depth of field] -> bloom -> tone mapping
//          -> vignette -> SMAA
// The Ultra passes are loaded only when Ultra is first used. Depth of field is for photo mode.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const VignetteShader = {
  name: 'Vignette',
  uniforms: { tDiffuse: { value: null }, amount: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float amount; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - amount * smoothstep(0.25, 0.95, dot(d, d) * 2.0);
      gl_FragColor = c;
    }`,
};

// Objects the depth / normal passes must not see: anything you look through (glass, mesh
// panels, fan blur discs), lines, and helpers flagged with userData.noAux.
const skipInAux = (o) => o.isLine || o.isPoints || o.userData.noAux === true
  || (o.isMesh && !Array.isArray(o.material) && (o.material.transmission > 0 || (o.material.transparent && !o.material.depthWrite)));

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 * @param {{vignette?: number}} opts
 */
export function createPost(renderer, scene, camera, { vignette = 0 } = {}) {
  // MSAA render target keeps edges clean through post-processing.
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  // Threshold well above 1: only emissive LEDs bloom, never lit surfaces or metal highlights.
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.7, 0.45, 1.5);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const vig = new ShaderPass(VignetteShader);
  vig.uniforms.amount.value = vignette;
  vig.enabled = false; // Ultra only, see applyLevel()
  composer.addPass(vig);

  let gtao = null;
  let smaa = null;
  let bokeh = null;
  let ultra = false;
  let width = 1;
  let height = 1;
  const dof = { on: false, focus: 100, blur: 0.4 };

  // Hide see-through objects while a pass renders depth or normals with an override material.
  const hidden = [];
  function hideAux() {
    scene.traverse((o) => { if (o.visible && skipInAux(o)) { o.visible = false; hidden.push(o); } });
  }
  function showAux() {
    for (const o of hidden) o.visible = true;
    hidden.length = 0;
  }

  async function loadUltra() {
    if (gtao) return;
    const [{ GTAOPass }, { SMAAPass }] = await Promise.all([
      import('three/addons/postprocessing/GTAOPass.js'),
      import('three/addons/postprocessing/SMAAPass.js'),
    ]);
    if (gtao) return;
    // Radius in scene units (cm): occlusion in corners and between parts, not across the case.
    gtao = new GTAOPass(scene, camera, width, height, undefined,
      { radius: 5, distanceExponent: 1, thickness: 2, scale: 1.5, samples: 16, distanceFallOff: 1, screenSpaceRadius: false },
      { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    gtao.blendIntensity = 1;
    gtao.overrideVisibility = hideAux;
    gtao.restoreVisibility = showAux;
    composer.insertPass(gtao, 1);
    smaa = new SMAAPass(width, height);
    composer.addPass(smaa);
    applyLevel();
    composer.setSize(width, height);
  }

  async function loadDof() {
    if (bokeh) return;
    const { BokehPass } = await import('three/addons/postprocessing/BokehPass.js');
    if (bokeh) return;
    bokeh = new BokehPass(scene, camera, { focus: dof.focus, aperture: 0, maxblur: 0.006 });
    const inner = bokeh.render.bind(bokeh);
    bokeh.render = (...a) => { hideAux(); try { inner(...a); } finally { showAux(); } };
    composer.insertPass(bokeh, composer.passes.indexOf(bloom));
    composer.setSize(width, height);
    applyDof();
  }

  function applyLevel() {
    if (gtao) gtao.enabled = ultra;
    if (smaa) smaa.enabled = ultra;
    vig.enabled = ultra && vig.uniforms.amount.value > 0;
  }
  function applyDof() {
    if (!bokeh) return;
    bokeh.enabled = dof.on && dof.blur > 0;
    bokeh.uniforms.focus.value = dof.focus;
    // Blur per cm of distance from the focus plane; `blur` 0..1 from the photo-mode slider.
    bokeh.uniforms.aperture.value = dof.blur * 0.00022;
    bokeh.uniforms.aspect.value = camera.aspect;
  }

  return {
    composer, bloom,
    render: () => composer.render(),
    /** @returns {Promise<void>} resolves when the passes for `quality` are in place */
    setQuality(quality) {
      ultra = quality === 'ultra';
      applyLevel();
      return ultra ? loadUltra() : Promise.resolve();
    },
    setSize(w, h) {
      width = w;
      height = h;
      composer.setSize(w, h);
      applyDof();
    },
    setPixelRatio: (r) => composer.setPixelRatio(r),
    /** MSAA samples of the scene target (0 for very large stills, which SMAA and the size itself smooth). */
    setSamples(n) {
      for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
        if (rt.samples === n) continue;
        rt.samples = n;
        rt.dispose();
      }
    },
    setVignette(v) {
      vig.uniforms.amount.value = v;
      applyLevel();
    },
    /** Depth of field: { on, focus (cm from the camera along the view), blur 0..1 }. */
    setDof(patch) {
      Object.assign(dof, patch);
      applyDof();
      return dof.on ? loadDof() : Promise.resolve();
    },
    get dof() { return { ...dof }; },
    /** Run `fn` with see-through objects hidden (for other depth passes, e.g. contact shadows). */
    withAuxHidden(fn) { hideAux(); try { fn(); } finally { showAux(); } },
    dispose() {
      gtao?.dispose();
      smaa?.dispose();
      bokeh?.dispose?.();
      composer.dispose();
      target.dispose();
    },
  };
}
