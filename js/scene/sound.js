// Small synthesised sounds for the hands-on build (Web Audio, no files): a latch click when a
// part seats, and a soft low tick when one goes back to the tray. Muting persists.
// The AudioContext starts on the first sound, which always follows a user gesture.
const STORE = 'rigsmith.sound.v1';

function loadMuted() {
  try { return JSON.parse(localStorage.getItem(STORE) ?? 'null')?.muted === true; } catch { return false; }
}

export function createSound() {
  let muted = loadMuted();
  let ctx = null;
  let noise = null;

  function context() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch { return null; }
    // 80 ms of white noise, reused for every click.
    noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.08), ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function burst(c, t, { freq, q, gain, decay }) {
    const src = c.createBufferSource();
    src.buffer = noise;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(bp).connect(g).connect(c.destination);
    src.start(t);
    src.stop(t + decay + 0.02);
  }

  function tone(c, t, { freq, to, gain, decay, type = 'sine' }) {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + decay);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + decay + 0.02);
  }

  function play(kind) {
    if (muted) return;
    const c = context();
    if (!c) return;
    if (c.state === 'suspended') c.resume().catch(() => {});
    const t = c.currentTime + 0.005;
    if (kind === 'click') {
      // Plastic latch: a bright transient, a second smaller one, and a low body thump.
      burst(c, t, { freq: 3200, q: 1.4, gain: 0.5, decay: 0.03 });
      burst(c, t + 0.028, { freq: 2400, q: 2, gain: 0.22, decay: 0.025 });
      tone(c, t, { freq: 170, to: 90, gain: 0.25, decay: 0.07 });
    } else if (kind === 'return') {
      tone(c, t, { freq: 420, to: 300, gain: 0.08, decay: 0.09, type: 'triangle' });
    }
  }

  return {
    play,
    get muted() { return muted; },
    setMuted(v) {
      muted = !!v;
      try { localStorage.setItem(STORE, JSON.stringify({ muted })); } catch { /* storage blocked */ }
    },
    dispose() {
      ctx?.close().catch(() => {});
      ctx = null;
      noise = null;
    },
  };
}
