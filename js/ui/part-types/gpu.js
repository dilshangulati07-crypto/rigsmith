import { unit } from '../dom.js';
import { gpuSlotWidth } from '../../compat/util.js';
import { GPU_INDEX } from '../../perf.js';

const power = (p) => (Array.isArray(p.powerConnectors) ? (p.powerConnectors.length ? p.powerConnectors.join(' + ') : 'Slot only') : null);
const slotText = (p) => {
  const w = gpuSlotWidth(p);
  if (w === null) return null;
  return p.slotWidth === null ? `${w} (from ${p.thicknessMM} mm)` : `${w}`;
};

export default {
  keySpecs: (p) => [
    ['VRAM', `${p.vramGB} GB`],
    ['Length', unit(p.lengthMM, ' mm')],
    ['Slots', gpuSlotWidth(p)],
    ['Power', unit(p.tdp, ' W')],
    ['Plugs', power(p)],
  ],
  specs: (p) => [
    ['Chip', `${p.chipMaker ?? ''} ${p.chip ?? ''}`.trim() || null],
    ['VRAM', `${p.vramGB} GB`],
    ['Length', unit(p.lengthMM, ' mm')],
    ['Slot width', slotText(p)],
    ['Thickness', unit(p.thicknessMM, ' mm')],
    ['Board power', unit(p.tdp, ' W')],
    ['Recommended PSU', unit(p.recommendedPSU, ' W')],
    ['Power connectors', power(p)],
    ['Fans', p.fans],
    ['Launch year', p.launchYear],
  ],
  filters: [
    { id: 'maker', label: 'Chip maker', kind: 'select', get: (p) => p.chipMaker },
    { id: 'vram', label: 'Min VRAM', kind: 'min', get: (p) => p.vramGB, format: (v) => `${v} GB` },
    { id: 'length', label: 'Max length', kind: 'max', get: (p) => p.lengthMM, format: (v) => `${v} mm`, steps: [200, 250, 280, 300, 320, 340, 360] },
    { id: 'plug', label: 'Power plug', kind: 'select', get: (p) => (Array.isArray(p.powerConnectors) ? (p.powerConnectors.includes('16-pin') ? '16-pin' : p.powerConnectors.length ? '8-pin / 6-pin' : 'Slot only') : null) },
  ],
  sorts: [
    { id: 'perf', label: 'Performance estimate', compare: (a, b) => (GPU_INDEX[b.chip] ?? 0) - (GPU_INDEX[a.chip] ?? 0) },
    { id: 'vram', label: 'Most VRAM', compare: (a, b) => b.vramGB - a.vramGB },
    { id: 'length', label: 'Shortest', compare: (a, b) => (a.lengthMM ?? 999) - (b.lengthMM ?? 999) },
  ],
};
