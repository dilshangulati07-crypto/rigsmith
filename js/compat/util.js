// Shared helpers for compatibility rules.
// Issue shape: { level: 'error'|'warn'|'info', rule, parts: [ids], message, fix }

export const known = (v) => v !== null && v !== undefined;

export function issue(level, rule, parts, message, fix = null) {
  return { level, rule, parts: parts.filter(Boolean).map((p) => p.id), message, fix };
}

// A null spec is UNKNOWN: never pass, never fail. Say so and let the build continue.
// `consequence` is an optional extra sentence, e.g. what the estimate leaves out.
export function unknown(rule, part, what, others = [], consequence = '') {
  return issue('info', rule, [part, ...others],
    `Can't confirm ${what} for ${part.name}: the spec isn't in our data yet.${consequence ? ` ${consequence}` : ''}`,
    "Check the maker's spec page before buying.");
}

// Null fields that mean "none" rather than "unknown" (mirrors tools/validate-data.mjs).
const NULL_MEANS_NONE = {
  cpu: (p, f) => f === 'igpuName',
  cooler: (p, f) => f === 'tdpRating' || (f === 'heightMM' && p.type === 'aio') || (f === 'radiatorSizeMM' && p.type === 'air'),
};

export function unknownFields(p) {
  return Object.entries(p).flatMap(([k, v]) => {
    if (v === null) return NULL_MEANS_NONE[p.category]?.(p, k) ? [] : [k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.entries(v).filter(([, x]) => x === null).map(([s]) => `${k}.${s}`);
    }
    return [];
  });
}

// Every chosen part, arrays flattened, in category order.
export function allParts(build) {
  return Object.values(build).flatMap((v) => (Array.isArray(v) ? v : v ? [v] : []));
}

// One PCIe slot is 20.32 mm. A null slotWidth is derived from thicknessMM when the maker
// prints that instead, rounded to the nearest quarter slot.
export function gpuSlotWidth(gpu) {
  if (known(gpu.slotWidth)) return gpu.slotWidth;
  if (known(gpu.thicknessMM)) return Math.round((gpu.thicknessMM / 20.32) * 4) / 4;
  return null;
}

// A case whose GPU limit is longer than its depth mounts the card vertically along its
// height (e.g. Corsair 2000D), so the limit is checked against the longest side.
export function gpuClearance(pcCase) {
  const d = pcCase.dimensionsMM;
  const limit = pcCase.maxGPULengthMM;
  if (!known(limit)) return { limit: null, vertical: false };
  if (!d || !known(d.depth)) return { limit, vertical: false };
  const vertical = limit > d.depth;
  const longest = Math.max(d.depth, d.height ?? 0);
  return { limit: vertical ? Math.min(limit, longest) : limit, vertical };
}

export const ramModules = (kits) => kits.reduce((n, k) => n + (k.modules ?? (Number(k.kit?.split('x')[0]) || 0)), 0);
export const ramCapacity = (kits) => kits.reduce((n, k) => n + k.capacityGB, 0);
export const fanCount = (packs) => packs.reduce((n, f) => n + (f.packCount ?? 1), 0);
export const list = (items) => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
