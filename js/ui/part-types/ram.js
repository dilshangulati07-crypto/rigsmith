import { unit } from '../dom.js?v=5b4c14becb';

const kit = (p) => `${p.modules ?? p.kit.split('x')[0]} × ${p.moduleGB ?? p.kit.split('x')[1]} GB`;

export default {
  keySpecs: (p) => [
    ['Type', p.type],
    ['Kit', kit(p)],
    ['Speed', `${p.speedMTs} MT/s`],
    ['CL', p.casLatency],
    ['Height', unit(p.heightMM, ' mm')],
  ],
  specs: (p) => [
    ['Type', p.type],
    ['Capacity', `${p.capacityGB} GB`],
    ['Kit', kit(p)],
    ['Speed', `${p.speedMTs} MT/s`],
    ['CAS latency', p.casLatency ? `CL${p.casLatency}` : null],
    ['Module height', unit(p.heightMM, ' mm')],
    ['RGB', p.rgb ? 'Yes' : 'No'],
  ],
  filters: [
    { id: 'type', label: 'Type', kind: 'select', get: (p) => p.type },
    { id: 'capacity', label: 'Capacity', kind: 'select', get: (p) => `${p.capacityGB} GB`, numeric: true },
    { id: 'speed', label: 'Min speed', kind: 'min', get: (p) => p.speedMTs, format: (v) => `${v} MT/s` },
    { id: 'rgb', label: 'RGB', kind: 'select', get: (p) => (p.rgb ? 'RGB' : 'No RGB') },
  ],
  sorts: [
    { id: 'capacity', label: 'Most capacity', compare: (a, b) => b.capacityGB - a.capacityGB },
    { id: 'speed', label: 'Fastest', compare: (a, b) => b.speedMTs - a.speedMTs },
  ],
};
