// Auto-build cinematic, the player. Plays the script from cinematic-plan.js with the same
// pieces "Build by hand" uses: hand-build.js seats each part (flown in from the tray, with
// the settle and the click), its mask and mechanisms show what is in the case, cables.js draws
// each tidy route, build-scene closes the glass panel, effects.js boots the PC, camera-rig.js
// flies the camera. Nothing here places a part or routes a cable.
//
// Time runs on a clock scaled by the speed (0 while paused); the viewer loop scales the camera,
// panel and boot by `timeScale` too. Jumps cancel the running step (a generation counter),
// set the case to the state at that step (stateAt) and play on from there.
// Reduced motion: each step crossfades in (a snapshot of the last frame fading out) instead
// of moving, and the camera cuts.
import * as THREE from 'three';
import { planAssembly } from './assembly.js?v=5b4c14becb';
import { planCinematic, stateAt, startOf, TIMING } from './cinematic-plan.js?v=5b4c14becb';
import { createCables } from './cables.js?v=5b4c14becb';

export const SPEEDS = Object.freeze([1, 2, 4]);
const HERO_RATE = (Math.PI * 2) / 46;   // rad/s of the closing orbit at 1x
const IDLE_ORBIT = 0.7;                // OrbitControls autoRotateSpeed once finished
const smooth = (t) => t * t * (3 - 2 * t);

const sigOf = (build) => JSON.stringify(Object.entries(build ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.map((p) => p.id) : v?.id ?? null]));

/**
 * @param {{viewer, bscene, rig, fx, hb, sound, reducedMotion: boolean, fadeCanvas: HTMLCanvasElement,
 *   cableStyle: () => object, onStep?: (i: number, label: string) => void, onState?: (state: string) => void}} opts
 */
export function createCinematic({ viewer, bscene, rig, fx, hb, sound, reducedMotion, fadeCanvas, cableStyle, onStep, onState }) {
  const cables3d = createCables({ viewer, root: bscene.root });
  const fadeCtx = fadeCanvas.getContext('2d');
  let plan = null;
  let cin = null;
  let sig = '';
  let active = false;
  let state = 'idle';     // idle | playing | paused | done
  let speed = 1;
  let gen = 0;            // bumped by every jump: a running step whose gen is stale stops
  let clock = 0;          // scaled seconds
  let waiters = [];       // { at } or { test }, resolved from update()
  let index = -1;         // current step
  let stepAt = 0;         // clock when the current step started
  let label = '';
  let installed = new Set();
  const fade = { alpha: 0, pending: null };

  // ---- scaled-time helpers
  const wait = (s) => new Promise((resolve) => waiters.push({ at: clock + s, resolve }));
  const until = (test) => new Promise((resolve) => waiters.push({ test, resolve }));
  function tween(s, fn) {
    const t0 = clock;
    return until(() => {
      const t = s > 0 ? Math.min(1, (clock - t0) / s) : 1;
      fn(t);
      return t >= 1;
    });
  }

  function setState(s) {
    if (state === s) return;
    state = s;
    rig.lock(s === 'playing');
    viewer.controls.autoRotate = s === 'done' && !reducedMotion;
    viewer.controls.autoRotateSpeed = IDLE_ORBIT;
    onState?.(s);
  }
  function setLabel(text) {
    label = text;
    onStep?.(index, label);
  }
  const setExposure = (v) => { viewer.renderer.toneMappingExposure = v * (viewer.exposure ?? 1); };

  // ---- the case at a step
  function apply(i) {
    const s = stateAt(cin.steps, i);
    installed = new Set(s.installed);
    hb.setState(plan, installed, s.stage);
    for (const id of cin.cables.keys()) cables3d.reveal(id, s.cables.includes(id) ? 1 : 0);
    bscene.setSidePanel(s.closed, { animate: false });
    fx.setPower(s.power, { instant: true });
    setExposure(1);
    viewer.invalidateShadows();
  }
  function frame(step, opts) {
    if (step.kind === 'part') hb.focusStage(step.stage, opts);
    else if (step.kind === 'cables') focusCables(step, opts);
    else if (step.kind === 'intro') focusCase(1.15, opts);
    else rig.goTo('angle', opts);
  }
  function focusCase(k, opts) {
    const c = bscene.modelOf('case');
    if (!c) return;
    const s = new THREE.Box3().setFromObject(c).getBoundingSphere(new THREE.Sphere());
    rig.focus(s.center, s.radius * k, [0.62, 0.32, 0.72], opts);
  }
  function focusCables(step, opts) {
    const b = new THREE.Box3();
    for (const id of step.items) {
      const c = cin.cables.get(id);
      for (const p of [c.A.p, c.B.p]) b.expandByPoint(bscene.root.localToWorld(new THREE.Vector3(...p)));
    }
    const s = b.getBoundingSphere(new THREE.Sphere());
    rig.focus(s.center, Math.max(16, s.radius * 1.3), [0.32, 0.24, 1], opts);
  }

  // ---- steps, animated
  async function runStep(step, g) {
    const T = TIMING;
    const live = () => g === gen;
    switch (step.kind) {
      case 'intro': {
        setExposure(0);
        focusCase(1.6, { animate: false });
        focusCase(1.15, { dur: T.intro });
        await tween(T.intro, (t) => setExposure(smooth(t)));
        break;
      }
      case 'part': {
        hb.setState(plan, installed, step.stage);
        hb.focusStage(step.stage, { dur: T.camera });
        await wait(T.lead);
        for (const key of step.pieces) {
          if (!live()) return;
          const seated = await hb.seat(key, {
            from: 'tray',
            flyS: T.fly,
            onSeated: (k) => { installed.add(k); hb.setState(plan, installed, step.stage); },
          });
          if (!seated || !live()) return;
          await wait(T.gap);
        }
        await wait(T.tail);
        break;
      }
      case 'cables': {
        focusCables(step, { dur: T.camera });
        await wait(T.cableLead);
        for (const id of step.items) {
          if (!live()) return;
          const c = cin.cables.get(id);
          setLabel(c.label);
          await tween(c.dur, (t) => cables3d.reveal(id, smooth(t)));
          if (!live()) return;
          sound.play('click');
          viewer.invalidateShadows();
          await wait(T.cableGap);
        }
        break;
      }
      case 'close': {
        rig.goTo('angle', { dur: 1.1 });
        await wait(0.55);
        bscene.setSidePanel(true, { animate: true });
        await wait(T.close - 0.55);
        break;
      }
      case 'power': {
        fx.setPower(true);
        await until(() => fx.power === 'on');
        await wait(0.6);
        break;
      }
      case 'hero': {
        let last = 0;
        await tween(T.hero, (t) => {
          const a = smooth(t) * T.hero * HERO_RATE;
          rig.orbit(a - last);
          last = a;
        });
        break;
      }
      default:
    }
  }

  // Reduced motion: the state after the step fades in over a snapshot of the frame before.
  async function runReduced(k, step) {
    await crossfade(() => {
      apply(k + 1);
      frame(step, { animate: false });
    }, { blank: k === 0 });
    await wait(step.kind === 'hero' ? TIMING.heroHold : TIMING.hold);
  }
  function crossfade(fn, { blank = false } = {}) {
    return new Promise((resolve) => { fade.pending = { fn, blank, resolve }; });
  }

  async function runFrom(i) {
    const g = gen;
    for (let k = i; k < cin.steps.length; k++) {
      if (g !== gen) return;
      index = k;
      stepAt = clock;
      setLabel(cin.steps[k].label);
      if (reducedMotion) await runReduced(k, cin.steps[k]);
      else await runStep(cin.steps[k], g);
    }
    if (g === gen) finish();
  }

  function finish() {
    index = cin.steps.length;
    setLabel('Finished');
    setState('done');
  }

  // ---- control
  function cancel() {
    gen++;
    waiters = [];
    hb.abort();
    fade.pending = null;
    fade.done = null;
    fade.alpha = 0;
    fadeCanvas.style.opacity = '0';
  }

  /** Jump to step `i` (the case as it is when that step starts) and play on from there. */
  function seek(i, { play = state !== 'paused' } = {}) {
    if (!cin?.ready) return;
    cancel();
    const k = Math.max(0, Math.min(cin.steps.length - 1, i));
    apply(k);
    setState(play ? 'playing' : 'paused');
    runFrom(k);
  }

  function skip() {
    if (!cin?.ready) return;
    cancel();
    apply(cin.steps.length);
    rig.goTo('angle', { animate: !reducedMotion });
    finish();
  }

  /** (Re)plan from the build in the scene. Returns { ok, reason }. */
  function load() {
    plan = planAssembly(bscene.build, bscene.layout);
    cin = planCinematic(bscene.build, plan);
    sig = sigOf(bscene.build);
    cables3d.setStyle(cableStyle());
    cables3d.sync([...cin.cables.values()].map((c) => ({ id: c.id, cable: c.item.cable, samples: c.samples, A: c.A, B: c.B })));
    for (const id of cin.cables.keys()) cables3d.reveal(id, 0);
    return { ok: cin.ready, reason: cin.reason };
  }

  return {
    /** Start from the top. Returns { ok, reason }. */
    enter() {
      active = true;
      hb.enter({ animate: false });
      const r = load();
      if (!r.ok) return r;
      seek(0, { play: true });
      return r;
    },
    exit() {
      if (!active) return;
      active = false;
      cancel();
      setState('idle');
      rig.lock(false);
      viewer.controls.autoRotate = false;
      cables3d.clear();
      hb.leave();
      setExposure(1);
      index = -1;
    },
    /** The build in the scene changed: start again if its parts did. */
    onLayout() {
      if (!active || sigOf(bscene.build) === sig) return false;
      const r = load();
      if (r.ok) seek(0, { play: true });
      return r;
    },
    play() {
      if (state === 'done') { seek(0, { play: true }); return; }
      setState('playing');
    },
    pause() { if (state === 'playing') setState('paused'); },
    toggle() { if (state === 'playing') this.pause(); else this.play(); },
    replay: () => seek(0, { play: true }),
    seek,
    skip,
    setSpeed(k) { if (SPEEDS.includes(k)) speed = k; },
    get speed() { return speed; },
    get state() { return state; },
    get active() { return active; },
    get steps() { return cin?.steps ?? []; },
    get index() { return index; },
    get label() { return label; },
    /** Seconds of the whole sequence at 1x (or the crossfade version). */
    get total() { return cin ? (reducedMotion ? cin.totalReduced : cin.total) : 0; },
    /** 0..1 through the whole sequence (estimate from the step timings). */
    get progress() {
      if (!cin?.ready || index < 0) return 0;
      if (index >= cin.steps.length) return 1;
      const step = cin.steps[index];
      const d = reducedMotion ? step.durReduced : step.dur;
      return Math.min(1, (startOf(cin.steps, index, reducedMotion) + Math.min(d, clock - stepAt)) / this.total);
    },
    /** 0..1 through the current step. */
    get stepProgress() {
      if (!cin?.ready || index < 0 || index >= cin.steps.length) return index >= 0 ? 1 : 0;
      const step = cin.steps[index];
      return Math.min(1, (clock - stepAt) / (reducedMotion ? step.durReduced : step.dur));
    },
    /** Viewer loop: multiply camera, panel and boot time by this. */
    get timeScale() { return !active || state === 'done' || state === 'idle' ? 1 : state === 'playing' ? speed : 0; },
    /** Cables drawn at least in part (for tests). */
    get cablesShown() { return cables3d.group.children.filter((m) => m.userData.cableId && m.visible).length; },
    get cableCount() { return cin?.cables.size ?? 0; },
    /** The crossfade layer, for the video: { canvas, alpha }. */
    get fade() { return { canvas: fadeCanvas, alpha: fade.alpha }; },
    /** What the finished build is, for "Open in Build by hand". */
    finalState() {
      const s = stateAt(cin.steps, cin.steps.length);
      return { installed: s.installed, cables: Object.fromEntries(s.cables.map((id) => [id, { pts: null, src: null, dst: null }])), closed: true };
    },
    update(dt) {
      if (!active) return;
      const k = this.timeScale;
      clock += dt * k;
      hb.update(dt * k);
      if (waiters.length) {
        const due = waiters.filter((w) => (w.at !== undefined ? clock >= w.at - 1e-9 : w.test()));
        if (due.length) {
          waiters = waiters.filter((w) => !due.includes(w));
          due.forEach((w) => w.resolve());
        }
      }
      if (fade.alpha > 0) {
        fade.alpha = Math.max(0, fade.alpha - (dt * k) / TIMING.fade);
        fadeCanvas.style.opacity = String(fade.alpha);
        if (fade.alpha === 0 && fade.done) { const r = fade.done; fade.done = null; r(); }
      }
    },
    /** Right after each frame is drawn: take the crossfade snapshot, then show the next state. */
    afterRender() {
      const p = fade.pending;
      if (!p || state !== 'playing') return;
      fade.pending = null;
      const src = viewer.renderer.domElement;
      if (fadeCanvas.width !== src.width || fadeCanvas.height !== src.height) {
        fadeCanvas.width = src.width;
        fadeCanvas.height = src.height;
      }
      if (p.blank) {
        fadeCtx.fillStyle = getComputedStyle(fadeCanvas).getPropertyValue('--bg').trim() || '#0b0d10';
        fadeCtx.fillRect(0, 0, fadeCanvas.width, fadeCanvas.height);
      } else fadeCtx.drawImage(src, 0, 0);
      fade.alpha = 1;
      fadeCanvas.style.opacity = '1';
      fade.done = p.resolve;
      p.fn();
    },
    dispose() {
      this.exit();
      cables3d.dispose();
    },
  };
}
