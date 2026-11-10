import { unit } from '../dom.js';

export default {
  keySpecs: (p) => [
    ['Type', p.type === 'aio' ? 'AIO liquid' : 'Air'],
    p.type === 'aio' ? ['Radiator', unit(p.radiatorSizeMM, ' mm')] : ['Height', unit(p.heightMM, ' mm')],
    ['Rated', p.tdpRating ? `${p.tdpRating} W` : 'Not published'],
    ['Fans', `${p.fans ?? '?'} × ${p.fanSizeMM ?? '?'} mm`],
  ],
  specs: (p) => [
    ['Type', p.type === 'aio' ? 'AIO liquid cooler' : 'Air cooler'],
    ['Sockets', p.socketsSupported.join(', ')],
    ...(p.type === 'aio' ? [['Radiator', unit(p.radiatorSizeMM, ' mm')]] : [['Height', unit(p.heightMM, ' mm')]]),
    ['TDP rating', p.tdpRating ? `${p.tdpRating} W` : 'Not published by maker'],
    ['Fans', `${p.fans ?? '?'} × ${p.fanSizeMM ?? '?'} mm`],
    ['RGB', p.rgb ? 'Yes' : 'No'],
  ],
  filters: [
    { id: 'type', label: 'Type', kind: 'select', get: (p) => (p.type === 'aio' ? 'AIO liquid' : 'Air') },
    { id: 'socket', label: 'Socket', kind: 'select', get: (p) => p.socketsSupported },
    { id: 'radiator', label: 'Radiator', kind: 'select', get: (p) => (p.radiatorSizeMM ? `${p.radiatorSizeMM} mm` : null), numeric: true },
    { id: 'height', label: 'Max height', kind: 'max', get: (p) => p.heightMM, format: (v) => `${v} mm`, steps: [60, 80, 150, 155, 160, 170] },
  ],
  sorts: [
    { id: 'rating', label: 'Highest TDP rating', compare: (a, b) => (b.tdpRating ?? 0) - (a.tdpRating ?? 0) },
    { id: 'height', label: 'Lowest height', compare: (a, b) => (a.heightMM ?? 999) - (b.heightMM ?? 999) },
  ],
};
