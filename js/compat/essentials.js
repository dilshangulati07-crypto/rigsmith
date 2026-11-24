// Completeness rules: missing essential parts and a working display output.
// Missing parts are 'warn' (the build is unfinished, not wrong).
import { CATEGORIES } from '../categories.js?v=4fbe99bdc0';
import { issue } from './util.js?v=4fbe99bdc0';

export const INCOMPLETE_RULES = new Set(['missing-part', 'display-output']);

const isEmpty = (v) => (Array.isArray(v) ? v.length === 0 : !v);

export function missingCategories(build) {
  const missing = CATEGORIES.filter((c) => c.essential && isEmpty(build[c.id])).map((c) => c.id);
  // A cooler is essential unless the CPU comes with one.
  if (!build.cooler && build.cpu?.coolerIncluded !== true) missing.push('cooler');
  return missing;
}

function missing(build) {
  return missingCategories(build).map((id) => {
    const label = CATEGORIES.find((c) => c.id === id).label;
    const fix = id === 'cooler' && build.cpu ? `${build.cpu.name} has no cooler in the box; add one.` : `Add a ${label.toLowerCase()}.`;
    return { ...issue('warn', 'missing-part', [], `No ${label.toLowerCase()} chosen yet.`, fix), category: id };
  });
}

// No GPU + no iGPU = no picture. An error once the rest of the build is chosen,
// a warning while it is still being put together.
function displayOutput(build) {
  const { cpu, gpu } = build;
  if (!cpu || gpu || cpu.igpu) return [];
  const finished = missingCategories(build).length === 0;
  return [issue(finished ? 'error' : 'warn', 'display-output', [cpu],
    `${cpu.name} has no integrated graphics, so this build needs a graphics card for any display output.`,
    'Add a graphics card, or pick a CPU with integrated graphics (no "F" suffix on Intel; most Ryzen 7000/9000 and G-series).')];
}

export const rules = [missing, displayOutput];
