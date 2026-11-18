// Power state, boot sequence, fan speed profiles and per-part lighting.
// Fans: real rpm from the data (rpmMax) times the profile; on screen the rotation is scaled
// down (real speeds alias at 60 fps) and a blur disc fades in with speed.
// LEDs: each part owns its LED materials (ledMaterial(), frosted diffuserMaterial(), screens);
// colour and mode per part or for all. Aurora (the default) spreads a soft blue -> purple ->
// pink gradient over the lit parts and lets it drift slowly. The lit pieces also carry a small
// point light each at Ultra, so the glow falls on nearby surfaces; at High it is emissive +
// bloom (each point light cost High ~5 % of the frame on integrated graphics).
// Settings (profile, lighting) persist in localStorage; the PC always starts powered off.
import * as THREE from 'three';
import { mat } from './materials.js?v=fe48996dc3';
import { BLOOM_THRESHOLD } from './post.js?v=fe48996dc3';

export const FAN_PROFILES = Object.freeze([
  { id: 'quiet', label: 'Quiet', k: 0.45 },
  { id: 'balanced', label: 'Balanced', k: 0.7 },
  { id: 'performance', label: 'Performance', k: 1 },
]);
export const RGB_MODES = Object.freeze([
  { id: 'aurora', label: 'Aurora' },
  { id: 'static', label: 'Static' },
  { id: 'breathe', label: 'Breathe' },
  { id: 'rainbow', label: 'Rainbow' },
  { id: 'off', label: 'Off' },
]);

const RPM_DEFAULT = { fans: 1800, cooler: 1800, gpu: 2000, psu: 1300 };
const VISUAL = 0.13;      // on-screen revolutions per real revolution
const MAX_VISUAL_RPS = 4.5;
const SPIN_RATE = 1.4;    // 1/s: fans approach their target speed
const BOOT_SECONDS = 2.4;
const BLOOM = 1.05;
const ACCENT_LED = 9;
const STORE = 'rigsmith.view.v1';
const DEFAULT_RGB = { color: '#7c6bff', mode: 'aurora' };
// Aurora gradient stops (soft blue, purple, pink) and how fast it drifts (cycles per second).
const AURORA = ['#4f86ff', '#8a63ff', '#ff6fc0'].map((c) => new THREE.Color(c));
const AURORA_DRIFT = 0.025;
const MAX_GLOW = { ultra: 8 }; // point lights: each one costs every lit surface a little
const GLOW_CD = 26;        // candela at full brightness; the scene is in cm, so this is a small LED strip
const GLOW_REACH = 26;     // cm
const GLOW_ORDER = ['fans', 'ram', 'cooler', 'gpu', 'motherboard', 'case', 'psu'];
const SCREEN_LEVEL = 1.5;

const smooth = (a, b, t) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/**
 * @param {{viewer: object, scene: object, reducedMotion?: boolean, onStatus?: (s: object) => void}} opts
 *   scene: the build scene (models list); onStatus({power, profile, rpm}) when the HUD should change.
 */
export function createEffects({ viewer, scene, reducedMotion = false, onStatus }) {
  const saved = load();
  let profile = FAN_PROFILES.some((p) => p.id === saved.profile) ? saved.profile : 'balanced';
  const rgb = { all: { ...DEFAULT_RGB, ...(saved.rgb?.all ?? {}) }, parts: { ...(saved.rgb?.parts ?? {}) } };

  let power = 'off';   // 'off' | 'booting' | 'on'
  let bootT = 0;
  let level = 0;       // fan speed as a fraction of rpmMax
  let ledLevel = 0;
  let accent = 0;
  let clock = 0;
  let models = [];
  const color = new THREE.Color();
  const glows = [];        // { light, piece, at, model }
  const glowOf = new Map(); // model -> { color, k } as last applied
  let glowQuality = null;
  const tmp = new THREE.Vector3();
  const box = new THREE.Box3();

  // Ultra: one point light at the middle of the lit meshes of each lit piece (fans first).
  // The lights live in the scene, not in the models, so cloned or disposed models never carry them.
  function rebuildGlow() {
    for (const g of glows) { g.light.removeFromParent(); g.light.dispose(); }
    glows.length = 0;
    glowQuality = viewer.quality;
    const max = MAX_GLOW[viewer.quality] ?? 0;
    for (const cat of GLOW_ORDER) {
      for (const s of models) {
        if (s.category !== cat || !s.model.userData.leds?.length) continue;
        for (const piece of s.model.userData.units ?? [s.model]) {
          if (glows.length >= max) return;
          piece.updateWorldMatrix(true, true);
          box.makeEmpty();
          piece.traverse((o) => { if (o.isMesh && o.material?.userData?.led && !o.material.userData.screen) box.expandByObject(o); });
          if (box.isEmpty()) continue;
          const light = new THREE.PointLight(0xffffff, 0, GLOW_REACH, 2);
          light.name = 'led-glow';
          viewer.scene.add(light);
          glows.push({ light, piece, at: piece.worldToLocal(box.getCenter(new THREE.Vector3())), model: s.model });
        }
      }
    }
  }
  function updateGlow() {
    if (glowQuality !== viewer.quality) rebuildGlow();
    for (const g of glows) {
      const state = glowOf.get(g.model);
      let shown = !!state && state.k > 0.001;
      for (let o = g.piece; o && shown; o = o.parent) if (!o.visible) shown = false;
      g.light.intensity = shown ? GLOW_CD * state.k : 0;
      if (!shown) continue;
      g.light.color.copy(state.color);
      g.light.position.copy(g.piece.localToWorld(tmp.copy(g.at)));
    }
  }

  function save() {
    try { localStorage.setItem(STORE, JSON.stringify({ profile, rgb })); } catch { /* storage blocked */ }
  }
  const k = () => FAN_PROFILES.find((p) => p.id === profile).k;
  const rpmOf = (s) => s.part.rpmMax ?? s.part.fanRpmMax ?? RPM_DEFAULT[s.category] ?? 1800;
  function status() {
    const fans = models.find((s) => s.category === 'fans') ?? models.find((s) => s.model.userData.rotors?.length);
    onStatus?.({ power, profile, rpm: fans && power !== 'off' ? Math.round(rpmOf(fans) * k() / 10) * 10 : 0 });
  }

  /** `instant`: straight to running, no boot sequence (jumping in the Auto-build timeline). */
  function setPower(on, { instant = false } = {}) {
    if (!on && power === 'off') return;
    if (on && (power === 'on' || (power === 'booting' && !instant))) return;
    const quick = instant || reducedMotion;
    power = on ? (quick ? 'on' : 'booting') : 'off';
    bootT = on && quick ? BOOT_SECONDS : 0;
    status();
  }

  // Brightness that clears the bloom threshold for any hue (dark colours need more).
  function intensityFor(c) {
    const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    return Math.min(9, Math.max(BLOOM_THRESHOLD * 1.5, (BLOOM_THRESHOLD * 1.2) / Math.max(lum, 0.01)));
  }

  // A point on the aurora gradient (t wraps: blue, purple, pink, purple, blue...).
  function aurora(t, out) {
    const x = ((t % 1) + 1) % 1 * 2;
    const p = x > 1 ? 2 - x : x; // 0..1..0
    const seg = p * (AURORA.length - 1);
    const i = Math.min(AURORA.length - 2, Math.floor(seg));
    return out.copy(AURORA[i]).lerp(AURORA[i + 1], seg - i);
  }

  function applyLeds() {
    const lit = models.filter((s) => s.model.userData.leds?.length).length || 1;
    let litIndex = 0;
    models.forEach((s, i) => {
      const leds = s.model.userData.leds;
      if (!leds?.length) return;
      const set = rgb.parts[s.part.id] ?? rgb.all;
      let f = 1;
      if (set.mode === 'off') f = 0;
      else if (set.mode === 'rainbow') color.setHSL(((reducedMotion ? 0 : clock * 0.08) + i * 0.13) % 1, 1, 0.5);
      else if (set.mode === 'aurora') aurora((reducedMotion ? 0 : clock * AURORA_DRIFT) + (litIndex / lit) * 0.5, color);
      else color.set(set.color);
      if (set.mode === 'breathe' && !reducedMotion) f = 0.15 + 0.85 * (0.5 - 0.5 * Math.cos((clock / 3.5) * Math.PI * 2));
      const intensity = intensityFor(color) * f * ledLevel;
      for (const m of leds) {
        // Screens keep their own picture: the lighting controls only switch them on and off.
        if (m.userData.screen) { m.emissiveIntensity = f > 0 ? SCREEN_LEVEL * ledLevel : 0; continue; }
        m.emissive.copy(color);
        m.emissiveIntensity = intensity * (m.userData.gain ?? 1);
      }
      litIndex++;
      const state = glowOf.get(s.model) ?? { color: new THREE.Color(), k: 0 };
      state.color.copy(color);
      state.k = f * ledLevel;
      glowOf.set(s.model, state);
    });
  }

  function update(dt) {
    clock += dt;
    if (power === 'booting') {
      bootT += dt;
      if (bootT >= BOOT_SECONDS) { power = 'on'; status(); }
    }
    const on = power !== 'off';
    // Boot: power LED first, then the fans spin up, then the LEDs fade in with a short pulse.
    if (on) {
      accent = smooth(0, 0.2, bootT);
      ledLevel = power === 'on' ? 1 : smooth(0.5, 1.2, bootT) + 0.3 * Math.sin(Math.PI * smooth(0.9, 1.7, bootT));
    } else {
      accent = Math.max(0, accent - dt * 4);
      ledLevel = Math.max(0, ledLevel - dt * 3);
    }
    const goal = on && bootT > 0.15 ? k() : 0;
    level = reducedMotion ? goal : level + (goal - level) * Math.min(1, dt * SPIN_RATE);
    if (Math.abs(level - goal) < 0.001) level = goal;

    mat('ledAccent').emissiveIntensity = ACCENT_LED * accent;
    viewer.bloom.strength = BLOOM * Math.min(1, Math.max(ledLevel, accent));
    viewer.bloom.enabled = viewer.bloom.strength > 0.001;
    mat('fanBlur').opacity = 0.5 * Math.min(1, level);

    if (!reducedMotion && level > 0) {
      for (const s of models) {
        const rotors = s.model.userData.rotors;
        if (!rotors?.length) continue;
        const rps = Math.min(MAX_VISUAL_RPS, (rpmOf(s) * level / 60) * VISUAL);
        const step = rps * Math.PI * 2 * dt;
        for (const r of rotors) r.rotation.z += step;
      }
    }
    applyLeds();
    updateGlow();
  }

  return {
    update,
    /** Call after the scene's models change. */
    refresh() {
      models = scene.models;
      glowOf.clear();
      applyLeds();
      rebuildGlow();
      status();
    },
    setPower,
    togglePower: () => setPower(power === 'off'),
    get power() { return power; },
    setProfile(id) {
      if (!FAN_PROFILES.some((p) => p.id === id)) return;
      profile = id;
      save();
      status();
    },
    get profile() { return profile; },
    /** Parts that have LEDs: [{ id, label, category }]. */
    lightTargets: () => {
      const seen = new Set();
      return models.filter((s) => s.model.userData.leds?.length && !seen.has(s.part.id) && seen.add(s.part.id))
        .map((s) => ({ id: s.part.id, label: s.part.name, category: s.category }));
    },
    /** Lighting for 'all' or a part id. */
    getRgb: (target) => ({ ...(target === 'all' ? rgb.all : rgb.parts[target] ?? rgb.all) }),
    /** Change lighting; 'all' also clears per-part settings. Turns the PC on so the change is visible. */
    setRgb(target, patch) {
      if (target === 'all') {
        Object.assign(rgb.all, patch);
        rgb.parts = {};
      } else {
        rgb.parts[target] = { ...(rgb.parts[target] ?? rgb.all), ...patch };
      }
      save();
      if (patch.mode !== 'off') setPower(true);
      applyLeds();
    },
  };
}
