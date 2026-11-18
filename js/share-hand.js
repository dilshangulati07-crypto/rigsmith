// Build-by-hand progress in a share link (the `h` param), relative to the build's own plans:
// which pieces are in (one bit per piece of planAssembly, in install order), which cables are connected (one
// bit per item of planCables), whether the side panel is closed, the cable style, and any
// cable with moved waypoints or other ports.
//
// Code (version 1): `1.<pieces>.<cables>.<flags>[.<extras>]`
//   pieces, cables: bit strings, 5 bits per base-32 character [0-9a-v]
//   flags: closed (0/1) + cable style index, then the custom colour as 6 hex digits
//   extras: base64url JSON [[cableIndex, src|0, dst|0, pts|0], ...]
// Plans are rebuilt from the build, so the code only makes sense with the build code next to it.
import { layoutBuild } from './scene/layout.js?v=733eefba1e';
import { planAssembly, reconcile } from './scene/assembly.js?v=733eefba1e';
import { planCables } from './scene/cable-plan.js?v=733eefba1e';
import { CABLE_STYLES } from './state.js?v=733eefba1e';

const VERSION = '1';
const B32 = '0123456789abcdefghijklmnopqrstuv';

function bitsToStr(bits) {
  let s = '';
  for (let i = 0; i < bits.length; i += 5) {
    let v = 0;
    for (let k = 0; k < 5; k++) v = (v << 1) | (bits[i + k] ? 1 : 0);
    s += B32[v];
  }
  return s.replace(/0+$/, '');
}
function strToBits(s, n) {
  const bits = [];
  for (const ch of s) {
    const v = B32.indexOf(ch);
    if (v < 0) return null;
    for (let k = 4; k >= 0; k--) bits.push((v >> k) & 1);
  }
  while (bits.length < n) bits.push(0);
  return bits.slice(0, n);
}

const b64url = (s) => (typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  return typeof atob === 'function' ? atob(b) : Buffer.from(b, 'base64').toString('binary');
};

/** Both plans for a build (parts per category). */
export function plansFor(build) {
  const aplan = planAssembly(build, layoutBuild(build));
  const cplan = aplan.ready ? planCables(build, aplan) : { ready: false, items: [] };
  return { aplan, cplan };
}

/**
 * Progress ({ installed, cables, closed, cableStyle }) -> code, or '' when nothing is in.
 * @param {object} build parts per category
 * @param {object} progress an AssemblyProgress (or the same fields)
 */
export function encodeHand(build, progress, plans = plansFor(build)) {
  const { aplan, cplan } = plans;
  if (!aplan.ready) return '';
  const pieces = aplan.groups.flatMap((g) => g.pieces);
  const installed = new Set(progress.installed);
  const cables = progress.cables ?? {};
  if (!pieces.some((k) => installed.has(k)) && !Object.keys(cables).length) return '';
  const items = cplan.ready ? cplan.items : [];
  const style = progress.cableStyle ?? { kind: 'black', color: '#ff5a1f' };
  const kind = Math.max(0, CABLE_STYLES.indexOf(style.kind));
  const extras = [];
  items.forEach((it, i) => {
    const c = cables[it.id];
    if (c && (c.pts || c.src || c.dst)) extras.push([i, c.src ?? 0, c.dst ?? 0, c.pts ?? 0]);
  });
  const parts = [
    VERSION,
    bitsToStr(pieces.map((k) => installed.has(k))),
    bitsToStr(items.map((it) => !!cables[it.id])),
    `${progress.closed ? 1 : 0}${kind}${style.kind === 'custom' || style.kind === 'sleeved' ? style.color.slice(1).toLowerCase() : ''}`,
  ];
  if (extras.length) parts.push(b64url(JSON.stringify(extras)));
  return parts.join('.');
}

const isPoint = (p) => Array.isArray(p) && p.length === 3 && p.every((v) => typeof v === 'number' && Number.isFinite(v));

/**
 * Code -> { ok, state: { caseId, installed, cables, closed, style }, error }. Installed pieces
 * are reconciled with the plan (support must be there), so a damaged code can't build a
 * floating CPU.
 */
export function decodeHand(code, build, plans = plansFor(build)) {
  const fail = (error) => ({ ok: false, state: null, error });
  const { aplan, cplan } = plans;
  if (!aplan.ready) return fail('The build-by-hand progress needs a case in the build.');
  const [version, p, c, flags = '00', extra] = String(code ?? '').split('.');
  if (version !== VERSION) return fail('The build-by-hand progress in this link is from a different version and was skipped.');
  const pieces = aplan.groups.flatMap((g) => g.pieces);
  const items = cplan.ready ? cplan.items : [];
  const pb = strToBits(p ?? '', pieces.length);
  const cb = strToBits(c ?? '', items.length);
  if (!pb || !cb || !/^[01][0-3]([0-9a-f]{6})?$/.test(flags)) return fail('The build-by-hand progress in this link is damaged and was skipped.');
  const installed = reconcile(aplan, pieces.filter((_, i) => pb[i]));
  const cables = {};
  items.forEach((it, i) => { if (cb[i]) cables[it.id] = { pts: null, src: null, dst: null }; });
  if (extra) {
    try {
      const list = JSON.parse(unb64url(extra));
      for (const [i, src, dst, pts] of Array.isArray(list) ? list : []) {
        const it = items[i];
        if (!it || !cables[it.id]) continue;
        cables[it.id] = {
          pts: Array.isArray(pts) && pts.length && pts.every(isPoint) ? pts : null,
          src: typeof src === 'string' ? src : null,
          dst: typeof dst === 'string' ? dst : null,
        };
      }
    } catch {
      return fail('The cable routes in this link are damaged and were skipped.');
    }
  }
  const kind = CABLE_STYLES[Number(flags[1])] ?? 'black';
  const style = { kind, color: flags.length > 2 ? `#${flags.slice(2)}` : '#ff5a1f' };
  return { ok: true, state: { caseId: aplan.caseId, installed, cables, closed: flags[0] === '1' && Object.keys(cables).length > 0, style }, error: null };
}
