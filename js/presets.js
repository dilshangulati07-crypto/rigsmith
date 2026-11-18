// Preset builds from data/presets.json. Each preset lists part ids; presetBuild() resolves
// them against the catalogue. tools/test-presets.mjs checks every preset has zero errors.
import { buildFromIds } from './share.js?v=733eefba1e';

export async function loadPresets({ url = 'data/presets.json', fetchFn = globalThis.fetch } = {}) {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Could not load presets (${res.status})`);
  return (await res.json()).presets;
}

/** Parts per category for a preset (ids not in the catalogue are dropped). */
export const presetBuild = (preset, catalog) => buildFromIds(preset.parts, catalog);

export const findPreset = (presets, id) => presets.find((p) => p.id === id) ?? null;
