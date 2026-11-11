// Auto-build cinematic, the script: one step per tray group of the real install order
// (assembly.js), one per cable group with every cable on its tidy route (cable-plan.js and
// cable-route.js, exactly what Auto-route in "Build by hand" connects), then closing the
// glass panel, the boot sequence and a slow orbit. Also what the case holds at any step, so the
// timeline can jump. Pure (no three.js) so tools/test-cinematic.mjs can run it in Node.
import { STAGES } from './assembly.js';
import { planCables, CABLE_GROUPS, powerReady, endsOf } from './cable-plan.js';
import { routeContext, routeOf, checkCable } from './cable-route.js';

// Seconds at 1x. The seat itself (press and settle) is timed in hand-build.js; these are the
// cinematic's own beats, and the estimates the progress bar and timeline use.
export const TIMING = Object.freeze({
  intro: 1.8,      // empty case fades in while the camera eases closer
  camera: 0.9,     // flight to each step
  lead: 0.35,      // first part leaves the tray this long after the camera starts
  fly: 0.55,       // tray to just above the slot
  seat: 0.44,      // press and settle (estimate of hand-build's SEAT_S + SETTLE_S)
  gap: 0.12,       // between pieces of one group
  tail: 0.3,       // after a group
  cableLead: 0.5,
  cableGap: 0.12,
  close: 1.7,
  boot: 3.0,
  hero: 8,
  fade: 0.35,      // reduced motion: crossfade per step
  hold: 0.75,      // reduced motion: hold after each crossfade
  heroHold: 1.6,
});

const CABLE_SHORT = { power: 'PSU cables', drives: 'SATA cables', front: 'Front I/O', fans: 'Fan leads' };
const VERB = { prep: 'Fitting', radiator: 'Mounting', fans: 'Mounting' };

/** Seconds to draw one cable of `length` cm at 1x. */
export const cableSeconds = (length) => Math.min(1.3, Math.max(0.55, 0.35 + length / 90));

function partLabel(group, stage, plan) {
  if (group.stage === 'prep') return `Fitting standoffs and I/O shield — ${group.formFactor} board`;
  const pump = group.stage === 'cooler' && plan.groups.some((g) => g.stage === 'radiator');
  const what = pump ? 'pump block' : stage.need;
  const n = group.pieces.length;
  return `${VERB[group.stage] ?? 'Installing'} ${what} — ${group.part.name}${n > 1 && group.detail ? ` (${group.detail})` : ''}`;
}

/**
 * @param {object} build the whole build
 * @param {object} aplan planAssembly(build)
 * @returns {{ ready, reason, steps, cables: Map, total, totalReduced }}
 *   step: { id, kind: intro | part | cables | close | power | hero, short, label, dur, durReduced,
 *           stage?, group?, pieces?, items? }
 *   cables: id -> { id, item, label, samples, length, dur, A, B }
 */
export function planCinematic(build, aplan) {
  const out = { ready: false, reason: null, steps: [], cables: new Map(), total: 0, totalReduced: 0 };
  if (!aplan.ready) {
    out.reason = 'Choose a case first: Auto-build installs the parts into it.';
    return out;
  }
  if (!aplan.groups.length) {
    out.reason = 'Add parts to the build first: there is nothing to install yet.';
    return out;
  }
  const T = TIMING;
  const steps = out.steps;
  steps.push({ id: 'intro', kind: 'intro', short: 'Case', label: `Empty case — ${build.case.name}`, dur: T.intro });

  for (const g of aplan.groups) {
    const stage = STAGES.find((s) => s.id === g.stage);
    const n = g.pieces.length;
    steps.push({
      id: `part:${g.key}`, kind: 'part', stage: g.stage, group: g.key, pieces: [...g.pieces], short: stage.short,
      label: partLabel(g, stage, aplan), dur: T.lead + n * (T.fly + T.seat + T.gap) + T.tail,
    });
  }

  // Cables: Auto-route's set (every connection that is possible, on default ends and tidy routes).
  const cplan = planCables(build, aplan);
  const items = cplan.ready ? cplan.items.filter((i) => !i.unavailable) : [];
  if (items.length) {
    const ctx = routeContext(aplan);
    for (const it of items) {
      const route = routeOf(it, cplan, ctx, null);
      if (!route) continue;
      const e = endsOf(it, null);
      const A = cplan.ports.get(e.from);
      const B = cplan.ports.get(e.to);
      const check = checkCable(it, route, ctx, A, B);
      out.cables.set(it.id, { id: it.id, item: it, label: `Connecting ${it.name} — ${it.target}`, samples: check.samples, length: check.length, dur: cableSeconds(check.length), A, B });
    }
    for (const cg of CABLE_GROUPS) {
      const ids = items.filter((i) => i.group === cg.id && out.cables.has(i.id)).map((i) => i.id);
      if (!ids.length) continue;
      steps.push({
        id: `cables:${cg.id}`, kind: 'cables', short: CABLE_SHORT[cg.id], label: `Connecting ${cg.label.toLowerCase()} cables`, items: ids,
        dur: T.cableLead + ids.reduce((a, id) => a + out.cables.get(id).dur + T.cableGap, 0),
      });
    }
  }

  steps.push({ id: 'close', kind: 'close', short: 'Close', label: 'Closing the glass side panel', dur: T.close });
  const connected = Object.fromEntries([...out.cables.keys()].map((id) => [id, { pts: null, src: null, dst: null }]));
  if (cplan.ready && powerReady(cplan, connected).ok) {
    steps.push({ id: 'power', kind: 'power', short: 'Boot', label: 'Power on — fans spin up, then the lighting', dur: T.boot });
  }
  steps.push({ id: 'hero', kind: 'hero', short: 'Orbit', label: 'Finished', dur: T.hero });

  for (const s of steps) s.durReduced = T.fade + (s.kind === 'hero' ? T.heroHold : T.hold);
  out.total = steps.reduce((a, s) => a + s.dur, 0);
  out.totalReduced = steps.reduce((a, s) => a + s.durReduced, 0);
  out.ready = true;
  return out;
}

/**
 * What is in the case when step `i` starts (every earlier step done): installed piece keys,
 * connected cable ids, whether the panel is closed and the PC on, and the hand-build stage id
 * (drives the socket lever, M.2 covers and slot covers; null = every part in).
 */
export function stateAt(steps, i) {
  const s = { installed: [], cables: [], closed: false, power: false, stage: null };
  steps.slice(0, Math.max(0, i)).forEach((st) => {
    if (st.kind === 'part') s.installed.push(...st.pieces);
    if (st.kind === 'cables') s.cables.push(...st.items);
    if (st.kind === 'close') s.closed = true;
    if (st.kind === 'power') s.power = true;
  });
  const parts = steps.filter((st) => st.kind === 'part');
  const lastPart = steps.lastIndexOf(parts[parts.length - 1]);
  if (steps[i]?.kind === 'part') s.stage = steps[i].stage;
  else if (i <= lastPart) s.stage = parts[0]?.stage ?? null;
  return s;
}

/** Seconds into the whole sequence at the start of step `i` (reduced: the crossfade version). */
export const startOf = (steps, i, reduced = false) => steps.slice(0, i).reduce((a, s) => a + (reduced ? s.durReduced : s.dur), 0);
