import { unit, num } from '../dom.js?v=733eefba1e';

export default {
  keySpecs: (p) => [
    ['Size', `${p.sizeMM} mm`],
    ['Pack', `${p.packCount} ×`],
    ['Max', p.rpmMax ? `${num(p.rpmMax)} rpm` : null],
    ['Airflow', unit(p.airflowCFM, ' CFM')],
    ['RGB', p.rgb ? 'Yes' : 'No'],
  ],
  specs: (p) => [
    ['Size', `${p.sizeMM} × ${p.thicknessMM} mm`],
    ['Fans in box', p.packCount],
    ['Max speed', p.rpmMax ? `${num(p.rpmMax)} rpm` : null],
    ['Airflow', unit(p.airflowCFM, ' CFM')],
    ['Static pressure', unit(p.staticPressureMMH2O, ' mmH₂O')],
    ['Noise', unit(p.noiseDBA, ' dB(A)')],
    ['RGB', p.rgb ? 'Yes' : 'No'],
  ],
  filters: [
    { id: 'size', label: 'Size', kind: 'select', get: (p) => `${p.sizeMM} mm`, numeric: true },
    { id: 'pack', label: 'Pack', kind: 'select', get: (p) => (p.packCount > 1 ? 'Multi-pack' : 'Single') },
    { id: 'rgb', label: 'RGB', kind: 'select', get: (p) => (p.rgb ? 'RGB' : 'No RGB') },
  ],
  sorts: [
    { id: 'perFan', label: 'Price per fan', compare: (a, b) => a.refPriceTHB / a.packCount - b.refPriceTHB / b.packCount },
    { id: 'airflow', label: 'Most airflow', compare: (a, b) => (b.airflowCFM ?? 0) - (a.airflowCFM ?? 0) },
  ],
};
