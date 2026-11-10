// Compatibility engine. Pure functions over a build object
// ({ cpu, motherboard, ram[], gpu, storage[], psu, case, cooler, fans[] }).
//
// checkBuild(build)            -> issues, sorted error > warn > info
// isPartCompatible(part, build) -> { ok, reason, fix, issues } for greying out catalogue choices
// getVerification(build)       -> how many chosen parts have fully verified specs
// summarize(issues)            -> counts per level
//
// A null spec is unknown, never a pass or a fail: rules return an 'info' issue
// ("Can't confirm X for this part") and the build is still allowed.
// Rules live in js/compat/*.js; each exports `rules`, an array of (build) => issues[].
import { emptyBuild } from './state.js';
import { getCategory } from './categories.js';
import { allParts, unknownFields } from './compat/util.js';
import { rules as platform } from './compat/platform.js';
import { rules as cooling } from './compat/cooling.js';
import { rules as fit } from './compat/fit.js';
import { rules as power } from './compat/power.js';
import { rules as storage } from './compat/storage.js';
import { rules as essentials, INCOMPLETE_RULES, missingCategories } from './compat/essentials.js';

export { estimateDraw, PSU_HEADROOM } from './compat/power.js';
export { missingCategories };

const RULES = [...essentials, ...platform, ...cooling, ...fit, ...power, ...storage];
const ORDER = { error: 0, warn: 1, info: 2 };

// Accept partial objects (e.g. { cpu, motherboard }) as well as full builds.
function normalize(build = {}) {
  const b = emptyBuild();
  for (const k of Object.keys(b)) {
    const v = build[k];
    if (v !== undefined && v !== null) b[k] = Array.isArray(b[k]) ? [...(Array.isArray(v) ? v : [v])] : v;
  }
  return b;
}

export function checkBuild(build) {
  const b = normalize(build);
  return RULES.flatMap((rule) => rule(b))
    .sort((x, y) => ORDER[x.level] - ORDER[y.level]);
}

export function summarize(issues) {
  const n = { error: 0, warn: 0, info: 0 };
  for (const i of issues) n[i.level]++;
  return { ...n, ok: n.error === 0 };
}

// Would choosing `part` break the build? Only issues that involve the part count, and
// "still incomplete" issues are ignored so an F-series CPU isn't greyed out just
// because no graphics card has been picked yet.
// mode: 'replace' (default for single slots and RAM) or 'add' (storage, fans).
export function isPartCompatible(part, build, { mode } = {}) {
  const cat = getCategory(part.category);
  const next = normalize(build);
  if (cat.multiple) {
    const m = mode ?? cat.pickMode ?? 'replace';
    next[cat.id] = m === 'add' ? [...next[cat.id], part] : [part];
  } else {
    next[cat.id] = part;
  }
  const issues = checkBuild(next).filter((i) => i.parts.includes(part.id) && !INCOMPLETE_RULES.has(i.rule));
  const firstError = issues.find((i) => i.level === 'error');
  return { ok: !firstError, reason: firstError?.message ?? null, fix: firstError?.fix ?? null, issues };
}

// Counts each distinct chosen part once.
export function getVerification(build) {
  const parts = [...new Map(allParts(normalize(build)).map((p) => [p.id, p])).values()];
  const unverified = parts.filter((p) => p.specsVerified !== true).map((p) => ({
    id: p.id, name: p.name, category: p.category, unknownFields: unknownFields(p),
  }));
  return {
    total: parts.length,
    verified: parts.length - unverified.length,
    unverified,
    allVerified: unverified.length === 0,
  };
}
