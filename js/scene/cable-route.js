// Cable routing and the cable-management score. Pure maths (no three.js) so tools/test-cables.mjs
// can check it in Node; js/scene/cables.js draws exactly the curve sampled here.
//
// A route is a polyline of control points: port, straight lead out of the port, waypoints,
// lead into the other port, port. Auto-routing runs cables behind the motherboard tray
// (the "back channel") and through the case's real openings: the grommets beside the board,
// the CPU power cut-out above it, and the cut-outs in the shroud or tray under it. It picks
// the cheapest route, where cable in view costs three times cable out of sight, cable in
// view that floats in the open or lies across the board face costs twice that again, and
// passing through a part costs a lot. Only the waypoints between the two leads are stored when the
// user moves them, so the ends always follow the ports.
import { WALL, cross } from './layout.js?v=fe48996dc3';
import { boxOf, boxOfLocal, worldExtent } from './layout-math.js?v=fe48996dc3';
import { CABLE_SPECS, endsOf } from './cable-plan.js?v=fe48996dc3';

const VIEW_COST = 3;   // cable in view vs out of sight
const FLOAT_COST = 3;  // extra for cable in view away from the tray and shroud, or over the board
const HUG = 1.6;       // cm from the tray or shroud top that still counts as lying against it
const SOLID_COST = 60; // per sample inside the board, PSU or another solid part
const WARN_COST = 40;  // per sample across a fan, radiator, heatsink or the card's fans
const TRAY_COST = 400; // per pass through steel outside an opening
const STEP = 0.75;     // cm between cost samples

const r2 = (v) => Math.round(v * 100) / 100;
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const dist = (a, b) => len(sub(a, b));
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const inBox = (p, b) => p[0] > b.min[0] && p[0] < b.max[0] && p[1] > b.min[1] && p[1] < b.max[1] && p[2] > b.min[2] && p[2] < b.max[2];
const grow = (b, k) => ({ min: b.min.map((v) => v - k), max: b.max.map((v) => v + k) });

export const leadOf = (item) => CABLE_SPECS[item.cable]?.lead ?? 1.5;

/**
 * Everything routing needs about the case and the parts in it.
 * @param {object} aplan planAssembly() result (layout + piece keys for obstacle owners)
 */
export function routeContext(aplan) {
  const L = aplan.layout;
  const cl = L.case;
  const trayZ = cl.trayZ;
  const zb = cl.rearSpace >= 1.2 ? r2(trayZ - Math.min(1.0, cl.rearSpace / 2)) : null;
  const s = cl.shroud;
  const zf = trayZ + 0.6;
  const keyOf = (category, index = 0, unit = null) => [...aplan.pieces.values()].find((p) => p.category === category && p.index === index && (unit === null || p.unit === unit))?.key ?? null;

  // Openings: chain of points from the front of the tray to the back channel.
  const passes = [];
  if (zb !== null) {
    cl.grommets.forEach((g, i) => passes.push({ id: `grommet:${i}`, kind: 'grommet', chain: [[g.x, g.y, zf], [g.x, g.y, zb]], open: { axis: 2, x: [g.x - 1.1, g.x + 1.1], y: [g.y - 3.4, g.y + 3.4] } }));
    const above = cl.H - WALL - cl.boardTopY;
    if (above > 1.6 && !cl.ioDown) {
      const c = [cl.boardX0 + 5.5, cl.boardTopY + above / 2];
      passes.push({ id: 'cpu-cutout', kind: 'cutout', chain: [[c[0], c[1], zf], [c[0], c[1], zb]], open: { axis: 2, x: [c[0] - 3.7, c[0] + 3.7], y: [c[1] - 0.8, c[1] + 0.8] } });
    }
  }
  cl.cutouts.forEach((c, i) => {
    if (c.kind === 'shroud') {
      const chain = [[c.x, c.y + 0.9, c.z], [c.x, c.y - 1.4, c.z]];
      if (zb !== null) chain.push([c.x, c.y - 1.4, zb]);
      passes.push({ id: `shroud:${i}`, kind: 'cutout', chain, open: { axis: 1, x: [c.x - c.w / 2 - 0.2, c.x + c.w / 2 + 0.2], z: [c.z - 0.8, c.z + 0.8] } });
    } else if (zb !== null) {
      passes.push({ id: `tray:${i}`, kind: 'cutout', chain: [[c.x, c.y, zf], [c.x, c.y, zb]], open: { axis: 2, x: [c.x - c.w / 2 - 0.2, c.x + c.w / 2 + 0.2], y: [c.y - 0.8, c.y + 0.8] } });
    }
  });

  // Obstacles. Solid: routing avoids them. Warn: a crossing is reported (fans, radiator, heatsink, card's fans).
  const obstacles = [];
  const board = L.board;
  if (board) obstacles.push({ kind: 'solid', label: 'the motherboard', box: { min: [board.x0, board.y0, trayZ + 0.05], max: [board.x1, board.y1, board.z + 0.35] } });
  if (L.psu) obstacles.push({ kind: 'solid', label: 'the power supply', owner: keyOf('psu'), box: boxOf(L.psu.placement.p, L.psu.ext) });
  if (L.gpu) {
    const g = L.gpu;
    const ez = cross(g.placement.ex, g.placement.ey);
    const face = { min: [...g.box.min], max: [...g.box.max] };
    ez.forEach((v, a) => { if (v > 0.5) face.max[a] += 3; if (v < -0.5) face.min[a] -= 3; });
    obstacles.push({ kind: 'gpu', label: "the graphics card's fans", owner: keyOf('gpu'), box: face });
  }
  if (L.cooler?.kind === 'air') {
    const h = L.cooler.height;
    const low = h < 8;
    const w = low ? 5.2 : 6.6;
    obstacles.push({ kind: 'heatsink', label: "the CPU cooler's heatsink", owner: keyOf('cooler'), box: boxOfLocal(L.cooler.placement, [-w, -w, low ? 1.4 : 2.2], [w - (low ? 0 : 1), w, h]) });
  }
  const rad = L.cooler?.radiator;
  if (rad) {
    const b = boxOf(rad.placement.p, rad.ext);
    rad.outward.forEach((v, a) => { if (v > 0.5) b.min[a] -= 3; if (v < -0.5) b.max[a] += 3; });
    obstacles.push({ kind: 'radiator', label: 'the radiator fans', owner: keyOf('cooler', 0, 1), box: b });
  }
  const MOUNT = { front: 'a front fan', top: 'a top fan', rear: 'the rear fan', bottom: 'a bottom fan', side: 'a side fan', shroud: 'a shroud fan' };
  for (const fan of L.fans) {
    obstacles.push({ kind: 'fan', label: MOUNT[fan.mount] ?? 'a case fan', owner: keyOf('fans', fan.partIndex, fan.unit), box: boxOf(fan.placement.p, worldExtent([fan.size - 0.6, fan.size - 0.6, fan.depth + 6], fan.placement.ex, fan.placement.ey)) });
  }

  // Airflow zones stop at the tray: behind it there is only steel.
  for (const o of obstacles) {
    if ((o.kind === 'fan' || o.kind === 'radiator') && (o.box.min[2] + o.box.max[2]) / 2 > trayZ) o.box.min[2] = Math.max(o.box.min[2], trayZ + 0.05);
  }
  const shell = { min: [-cl.D / 2 + WALL + 0.3, WALL + 0.3, -cl.W / 2 + WALL + 0.2], max: [cl.D / 2 - WALL - 0.3, cl.H - WALL - 0.3, cl.W / 2 - 0.7] };
  const trayBottom = s ? s.y1 : WALL;
  const hidden = (p) => p[2] < trayZ - 0.05 || (!!s && p[1] < s.y1 - 0.05 && p[0] > s.x0 && p[0] < s.x1 && p[2] > s.z0 - 0.1);
  const overBoard = board ? (p) => p[0] > board.x0 && p[0] < board.x1 && p[1] > board.y0 && p[1] < board.y1 : () => false;
  const hugs = (p) => (p[2] - trayZ < HUG && !overBoard(p)) || (!!s && Math.abs(p[1] - s.y1) < HUG && p[0] > s.x0 && p[0] < s.x1 && p[2] > s.z0);
  return { trayZ, zb, zf, shroud: s, trayBottom, passes, obstacles, shell, hidden, hugs, ioDown: cl.ioDown };
}

// ---------------------------------------------------------------- curve
// Rounded corners: each inner corner becomes two points either side of it.
function fillet(pts, r = 1.4) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]; const b = pts[i]; const c = pts[i + 1];
    const da = dist(a, b); const dc = dist(b, c);
    if (da < 1e-3 || dc < 1e-3) continue;
    const k = Math.min(r, da / 2.2, dc / 2.2);
    out.push(lerp(b, a, k / da), lerp(b, c, k / dc));
  }
  out.push(pts[pts.length - 1]);
  // Drop near-duplicates (they break the spline's knot spacing).
  return out.filter((p, i) => i === 0 || dist(p, out[i - 1]) > 0.02);
}

// Centripetal Catmull-Rom (no overshoot or cusps), sampled about every `step` cm.
function catmull(pts, step) {
  if (pts.length < 2) return pts.map((p) => [...p]);
  const P = [add(pts[0], sub(pts[0], pts[1])), ...pts, add(pts[pts.length - 1], sub(pts[pts.length - 1], pts[pts.length - 2]))];
  const out = [[...pts[0]]];
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    const t0 = 0;
    const t1 = t0 + Math.max(1e-4, Math.sqrt(dist(p0, p1)));
    const t2 = t1 + Math.max(1e-4, Math.sqrt(dist(p1, p2)));
    const t3 = t2 + Math.max(1e-4, Math.sqrt(dist(p2, p3)));
    const n = Math.max(1, Math.ceil(dist(p1, p2) / step));
    for (let k = 1; k <= n; k++) {
      const t = t1 + ((t2 - t1) * k) / n;
      const A1 = lerp(p0, p1, (t - t0) / (t1 - t0));
      const A2 = lerp(p1, p2, (t - t1) / (t2 - t1));
      const A3 = lerp(p2, p3, (t - t2) / (t3 - t2));
      const B1 = lerp(A1, A2, (t - t0) / (t2 - t0));
      const B2 = lerp(A2, A3, (t - t1) / (t3 - t1));
      out.push(lerp(B1, B2, (t - t1) / (t2 - t1)));
    }
  }
  return out;
}

/** Dense points along a route's smooth curve (what is drawn and scored). */
export const sampleRoute = (pts, step = 0.5) => catmull(fillet(pts), step);

// ---------------------------------------------------------------- checks
/**
 * What a sampled path does: length, length out of sight, parts it crosses, passes through steel.
 * `skip` = cm at each end not checked for crossings (the plug and its straight lead).
 */
function inspect(samples, ctx, { owners = [], skip = 0, ends = [] } = {}) {
  // A zone the port itself sits in can't be avoided, so it isn't held against the cable.
  const exempt = ctx.obstacles.filter((o) => o.kind !== 'solid' && ends.some((p) => inBox(p, o.box)));
  let total = 0;
  let hiddenLen = 0;
  let floatLen = 0;
  const hits = new Map(); // obstacle -> samples inside
  let steel = 0;
  const arc = [0];
  for (let i = 1; i < samples.length; i++) arc.push(arc[i - 1] + dist(samples[i - 1], samples[i]));
  total = arc[arc.length - 1];
  const s = ctx.shroud;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]; const b = samples[i];
    const seg = arc[i] - arc[i - 1];
    const mid = lerp(a, b, 0.5);
    if (ctx.hidden(mid)) hiddenLen += seg;
    else if (!ctx.hugs(mid)) floatLen += seg;
    if (arc[i] > skip && arc[i] < total - skip) {
      for (const o of ctx.obstacles) {
        if (o.kind !== 'solid' && ((o.owner && owners.includes(o.owner) && o.kind !== 'gpu') || exempt.includes(o))) continue;
        if (inBox(b, o.box)) hits.set(o, (hits.get(o) ?? 0) + 1);
      }
    }
    // Through the tray plane (above the tray's bottom edge) only at an opening.
    const da = a[2] - ctx.trayZ; const db = b[2] - ctx.trayZ;
    if (da * db < 0) {
      const c = lerp(a, b, da / (da - db));
      if (c[1] > ctx.trayBottom + 0.1 && !ctx.passes.some((p) => p.open.axis === 2 && c[0] > p.open.x[0] && c[0] < p.open.x[1] && c[1] > p.open.y[0] && c[1] < p.open.y[1])) steel++;
    }
    // Through the shroud top only at a cut-out.
    if (s) {
      const ya = a[1] - s.y1; const yb = b[1] - s.y1;
      if (ya * yb < 0) {
        const c = lerp(a, b, ya / (ya - yb));
        if (c[0] > s.x0 && c[0] < s.x1 && c[2] > s.z0 + 0.1 && c[2] < s.z1 && !ctx.passes.some((p) => p.open.axis === 1 && c[0] > p.open.x[0] && c[0] < p.open.x[1] && c[2] > p.open.z[0] && c[2] < p.open.z[1])) steel++;
      }
    }
  }
  return { total, hiddenLen, floatLen, hits, steel };
}

function polyCost(pts, ctx, opts) {
  const r = inspect(catmullFree(pts), ctx, opts);
  let c = r.hiddenLen + (r.total - r.hiddenLen) * VIEW_COST + r.floatLen * FLOAT_COST + r.steel * TRAY_COST;
  for (const [o, n] of r.hits) c += n * (o.kind === 'solid' ? SOLID_COST : WARN_COST);
  return c;
}
// Straight-segment samples (cheap) for route search.
function catmullFree(pts) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const n = Math.max(1, Math.ceil(dist(pts[i - 1], pts[i]) / STEP));
    for (let k = 1; k <= n; k++) out.push(lerp(pts[i - 1], pts[i], k / n));
  }
  return out;
}

// ---------------------------------------------------------------- auto-route
const portsOf = (item, cplan, state) => {
  const e = endsOf(item, state);
  return { A: cplan.ports.get(e.from), B: cplan.ports.get(e.to) };
};

/**
 * Fixed ends of a route: [port, lead point] at each end. The straight lead out of a port
 * is shortened where a wall is close (an SFX unit facing the front panel).
 */
export function routeEnds(item, cplan, state, ctx = null) {
  const { A, B } = portsOf(item, cplan, state);
  if (!A || !B) return null;
  const lead = leadOf(item);
  const out = (P) => {
    let k = lead;
    if (ctx) {
      P.dir.forEach((d, a) => {
        if (d > 1e-3) k = Math.min(k, (ctx.shell.max[a] - P.p[a]) / d);
        if (d < -1e-3) k = Math.min(k, (ctx.shell.min[a] - P.p[a]) / d);
      });
    }
    return add(P.p, P.dir, Math.max(0.4, k)).map(r2);
  };
  return { a0: A.p, a1: out(A), b1: out(B), b0: B.p, A, B };
}

// Manhattan variants of a leg through the front chamber; the cheapest wins.
function frontLeg(u, v, ctx, opts, cache) {
  const key = `${u}|${v}`;
  if (cache.has(key)) return cache.get(key);
  const variants = [
    [u, v],
    [u, [u[0], u[1], v[2]], v],
    [u, [v[0], v[1], u[2]], v],
    [u, [v[0], u[1], u[2]], [v[0], v[1], u[2]], v],
    [u, [u[0], v[1], u[2]], [v[0], v[1], u[2]], v],
    [u, [u[0], u[1], v[2]], [v[0], u[1], v[2]], v],
    [u, [u[0], u[1], v[2]], [u[0], v[1], v[2]], v],
  ];
  let best = null;
  for (const pts of variants) {
    const cost = polyCost(pts, ctx, opts);
    if (!best || cost < best.cost) best = { pts, cost };
  }
  cache.set(key, best);
  return best;
}

// Behind the tray: straight to the channel, then one corner (across then up, or up then across).
function backLeg(u, v, ctx, opts) {
  const z = ctx.zb;
  const u2 = z === null ? u : [u[0], u[1], z];
  const v2 = z === null ? v : [v[0], v[1], z];
  const corners = Math.abs(u2[0] - v2[0]) > 0.5 && Math.abs(u2[1] - v2[1]) > 0.5
    ? [[[v2[0], u2[1], u2[2]]], [[u2[0], v2[1], u2[2]]]]
    : [[]];
  let best = null;
  for (const c of corners) {
    const pts = [u];
    if (dist(u, u2) > 0.05) pts.push(u2);
    pts.push(...c);
    if (dist(v, v2) > 0.05) pts.push(v2);
    pts.push(v);
    const cost = polyCost(pts, ctx, opts);
    if (!best || cost < best.cost) best = { pts, cost };
  }
  return best;
}

const join = (...legs) => {
  const out = [];
  for (const pts of legs) for (const p of pts) if (!out.length || dist(out[out.length - 1], p) > 0.01) out.push(p);
  return out;
};

/**
 * Tidy route for one connection: { pts } (the full control polyline) or null.
 * @param {object} state the cable's stored state ({ src, dst } overrides)
 */
export function autoRoute(item, cplan, ctx, state = null) {
  const e = routeEnds(item, cplan, state, ctx);
  if (!e) return null;
  const { a0, a1, b1, b0, A, B } = e;
  const opts = { owners: [A.owner, B.owner].filter(Boolean), skip: 0, ends: [a1, b1] };
  const cache = new Map();
  const backA = ctx.hidden(a1);
  const backB = ctx.hidden(b1);
  const options = [];
  const chainIn = (p) => p.chain;
  const chainOut = (p) => [...p.chain].reverse();
  const legCost = (pts) => polyCost(pts, ctx, opts);

  if (backA && backB) options.push(backLeg(a1, b1, ctx, opts));
  if (!backA && !backB) options.push(frontLeg(a1, b1, ctx, opts, cache));
  for (const P of ctx.passes) {
    const inP = chainIn(P);
    if (backA && !backB) {
      const back = backLeg(a1, inP[inP.length - 1], ctx, opts);
      const f = frontLeg(inP[0], b1, ctx, opts, cache);
      options.push({ pts: join(back.pts, chainOut(P), f.pts), cost: back.cost + f.cost + legCost(inP) });
    }
    if (!backA && backB) {
      const f = frontLeg(a1, inP[0], ctx, opts, cache);
      const back = backLeg(inP[inP.length - 1], b1, ctx, opts);
      options.push({ pts: join(f.pts, inP, back.pts), cost: f.cost + legCost(inP) + back.cost });
    }
    if (!backA && !backB) {
      const f1 = frontLeg(a1, inP[0], ctx, opts, cache);
      for (const Q of ctx.passes) {
        if (Q === P) continue;
        const outQ = chainOut(Q);
        const back = backLeg(inP[inP.length - 1], outQ[0], ctx, opts);
        const f2 = frontLeg(outQ[outQ.length - 1], b1, ctx, opts, cache);
        options.push({ pts: join(f1.pts, inP, back.pts, outQ, f2.pts), cost: f1.cost + legCost(inP) + back.cost + legCost(outQ) + f2.cost });
      }
    }
  }
  if (!options.length) options.push(frontLeg(a1, b1, ctx, opts, cache));
  const best = options.reduce((x, y) => (y.cost < x.cost ? y : x));
  return { pts: join([a0], best.pts, [b0]).map((p) => p.map(r2)) };
}

/** Full control polyline of a connected cable: its stored waypoints, or the auto-route. */
export function routeOf(item, cplan, ctx, state) {
  const e = routeEnds(item, cplan, state, ctx);
  if (!e) return null;
  if (Array.isArray(state?.pts) && state.pts.length) return { pts: [e.a0, e.a1, ...state.pts, e.b1, e.b0], custom: true };
  const r = autoRoute(item, cplan, ctx, state);
  return r && { ...r, custom: false };
}

/** Waypoints the user can move: the control points between the two leads. */
export const waypointsOf = (route) => route.pts.slice(2, -2);

// ---------------------------------------------------------------- score
const WARN_KINDS = new Set(['gpu', 'heatsink', 'fan', 'radiator']);

/** Check one routed cable: { length, hidden, float, warnings: [{kind, label}], steel, solid }. */
export function checkCable(item, route, ctx, A, B) {
  const samples = sampleRoute(route.pts);
  const r = inspect(samples, ctx, { owners: [A?.owner, B?.owner].filter(Boolean), skip: leadOf(item) + 0.6, ends: [route.pts[1], route.pts[route.pts.length - 2]] });
  const warnings = [];
  let solid = 0;
  for (const [o, n] of r.hits) {
    if (n < 2) continue;
    if (WARN_KINDS.has(o.kind)) warnings.push({ kind: o.kind, label: o.label });
    else solid++;
  }
  return { samples, length: r.total, hidden: r.hiddenLen, float: r.floatLen, warnings, steel: r.steel, solid };
}

/**
 * Cable-management score (0-100) with its reasons, for the connected cables.
 * @param {Array<{item, route, check, auto}>} cables  auto = checkCable() of the auto-route
 */
export function scoreCables(cables) {
  if (!cables.length) return { score: 0, parts: [], reasons: [], warnings: [] };
  const sum = (f) => cables.reduce((a, c) => a + f(c), 0);
  const total = sum((c) => c.check.length);
  const hidden = sum((c) => c.check.hidden);
  const autoTotal = sum((c) => c.auto.length);
  const autoHidden = sum((c) => c.auto.hidden);
  const frac = total ? hidden / total : 0;
  const best = autoTotal ? autoHidden / autoTotal : 0;
  const reasons = [];
  const pct = (v) => `${Math.round(v * 100)}%`;

  // Hidden length, against what a tidy route manages in this case.
  const hidPts = 40 * Math.min(1, best > 0.02 ? frac / best : 1);
  reasons.push({ id: 'hidden', points: hidPts, max: 40, level: hidPts >= 36 ? 'ok' : hidPts >= 26 ? 'warn' : 'error',
    text: `${pct(frac)} of the cable length is out of sight behind the tray or under the shroud${best > 0.02 && frac < best - 0.02 ? ` (a tidy route here hides ${pct(best)})` : ''}.` });

  // Crossings over the card's fans and the CPU heatsink.
  const warnings = cables.flatMap((c) => c.check.warnings.map((w) => ({ ...w, id: c.item.id, name: c.item.name })));
  const crossings = warnings.filter((w) => w.kind === 'gpu' || w.kind === 'heatsink');
  const crossPts = Math.max(0, 25 - 8 * crossings.length);
  reasons.push({ id: 'crossings', points: crossPts, max: 25, level: crossings.length ? 'warn' : 'ok',
    text: crossings.length ? `${crossings.length} cable${crossings.length > 1 ? 's cross' : ' crosses'} the graphics card's fans or the CPU heatsink.` : 'No cable crosses the graphics card or the CPU heatsink.' });

  // Fans and radiators: a cable in the airflow.
  const air = warnings.filter((w) => w.kind === 'fan' || w.kind === 'radiator');
  const airPts = Math.max(0, 20 - 7 * air.length);
  reasons.push({ id: 'airflow', points: airPts, max: 20, level: air.length ? 'warn' : 'ok',
    text: air.length ? `${air.length} cable${air.length > 1 ? 's sit' : ' sits'} in front of a fan or radiator and blocks airflow.` : 'No cable sits in front of a fan or radiator.' });

  // Grommets: every pass through the tray or shroud uses an opening.
  const steel = cables.filter((c) => c.check.steel > 0);
  const tidyPts = 15 * (1 - steel.length / cables.length);
  reasons.push({ id: 'grommets', points: tidyPts, max: 15, level: steel.length ? 'error' : 'ok',
    text: steel.length ? `${steel.length} cable${steel.length > 1 ? 's pass' : ' passes'} through the tray outside a grommet or cut-out.` : 'Every cable passes through a grommet or cut-out.' });

  const score = Math.round(hidPts + crossPts + airPts + tidyPts);
  return { score, reasons, warnings, hiddenFrac: frac, bestHiddenFrac: best };
}

/** Clamp a waypoint inside the case. */
export function clampToCase(p, ctx) {
  return p.map((v, a) => r2(Math.min(ctx.shell.max[a], Math.max(ctx.shell.min[a], v))));
}

/** Distance from a point to an obstacle box, for tests. */
export const boxContains = (b, p, k = 0) => inBox(p, grow(b, k));
