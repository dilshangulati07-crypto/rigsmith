import { unit } from '../dom.js?v=5b4c14becb';
import { gpuClearance } from '../../compat/util.js?v=5b4c14becb';

const TYPE = { 'full-tower': 'Full tower', 'mid-tower': 'Mid tower', matx: 'mATX', itx: 'ITX' };
const rads = (list) => (list ? list.map((r) => `${r.position} ${r.sizesMM ? r.sizesMM.join('/') : `up to ${r.maxMM}`}`).join(', ') : null);
const fans = (m) => (m ? Object.entries(m).map(([pos, s]) => `${pos} ${Object.entries(s).map(([mm, n]) => `${n}×${mm}`).join(' or ')}`).join(', ') : null);
const bays = (b) => (b ? `3.5in ${b['3.5'] ?? '?'} · 2.5in ${b['2.5'] ?? '?'}` : null);
const dims = (d) => (d ? `${d.depth ?? '?'} × ${d.width ?? '?'} × ${d.height ?? '?'} mm` : null);

export default {
  keySpecs: (p) => [
    ['Type', TYPE[p.caseType] ?? p.caseType],
    ['Boards', p.formFactorsSupported ? p.formFactorsSupported.join(' ') : null],
    ['GPU', unit(p.maxGPULengthMM, ' mm')],
    ['Cooler', unit(p.maxCoolerHeightMM, ' mm')],
    ['PSU', p.psuFormFactors ? p.psuFormFactors.join(' ') : null],
  ],
  specs: (p) => [
    ['Type', TYPE[p.caseType] ?? p.caseType],
    ['Boards', p.formFactorsSupported ? p.formFactorsSupported.join(', ') : null],
    ['Max GPU length', p.maxGPULengthMM == null ? null : `${p.maxGPULengthMM} mm${gpuClearance(p).vertical ? ' (vertical mount)' : ''}`],
    ['Max cooler height', unit(p.maxCoolerHeightMM, ' mm')],
    ['Radiators', rads(p.radiatorSupport)],
    ['Fan mounts', fans(p.fanMounts)],
    ['Drive bays', bays(p.drivebays)],
    ['PSU', p.psuFormFactors ? p.psuFormFactors.join(', ') : null],
    ['Side panel', p.sidePanel],
    ['Size (D × W × H)', dims(p.dimensionsMM)],
  ],
  filters: [
    { id: 'type', label: 'Case type', kind: 'select', get: (p) => TYPE[p.caseType] ?? p.caseType, order: Object.values(TYPE) },
    { id: 'board', label: 'Takes board', kind: 'select', get: (p) => p.formFactorsSupported, order: ['E-ATX', 'ATX', 'mATX', 'ITX'] },
    { id: 'gpu', label: 'Min GPU room', kind: 'min', get: (p) => p.maxGPULengthMM, format: (v) => `${v} mm`, steps: [300, 330, 360, 400, 420] },
    { id: 'cooler', label: 'Min cooler room', kind: 'min', get: (p) => p.maxCoolerHeightMM, format: (v) => `${v} mm`, steps: [70, 150, 160, 170, 180] },
    { id: 'panel', label: 'Side panel', kind: 'select', get: (p) => p.sidePanel },
  ],
  sorts: [
    { id: 'gpu', label: 'Most GPU room', compare: (a, b) => (b.maxGPULengthMM ?? 0) - (a.maxGPULengthMM ?? 0) },
  ],
};
