// Power state, boot sequence, fan speed profiles and per-part lighting.
// Fans: real rpm from the data (rpmMax) times the profile; on screen the rotation is scaled
// down (real speeds alias at 60 fps) and a blur disc fades in with speed.
// LEDs: each part owns its LED material (ledMaterial()); colour and mode per part or for all.
// Settings (profile, lighting) persist in localStorage; the PC always starts powered off.
import * as THREE from 'three';
import { mat } from './materials.js';

export const FAN_PROFILES = Object.freeze([
  { id: 'quiet', label: 'Quiet', k: 0.45 },
  { id: 'balanced', label: 'Balanced', k: 0.7 },
  { id: 'performance', label: 'Performance', k: 1 },
]);
export const RGB_MODES = Object.freeze([
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
const BLOOM = 0.7;
const ACCENT_LED = 6;
const STORE = 'rigsmith.view.v1';
const DEFAULT_RGB = { color: '#d8e4f2', mode: 'static' };

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
    return Math.min(7, Math.max(2.1, 1.7 / Math.max(lum, 0.01)));
  }

  function applyLeds() {
    models.forEach((s, i) => {
      const leds = s.model.userData.leds;
      if (!leds?.length) return;
      const set = rgb.parts[s.part.id] ?? rgb.all;
      let f = 1;
      if (set.mode === 'off') f = 0;
      else if (set.mode === 'rainbow') color.setHSL(((reducedMotion ? 0 : clock * 0.08) + i * 0.13) % 1, 1, 0.5);
      else color.set(set.color);
      if (set.mode === 'breathe' && !reducedMotion) f = 0.15 + 0.85 * (0.5 - 0.5 * Math.cos((clock / 3.5) * Math.PI * 2));
      const intensity = intensityFor(color) * f * ledLevel;
      for (const m of leds) {
        m.emissive.copy(color);
        m.emissiveIntensity = intensity;
      }
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
  }

  return {
    update,
    /** Call after the scene's models change. */
    refresh() {
      models = scene.models;
      applyLeds();
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
