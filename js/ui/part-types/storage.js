import { capacity, num } from '../dom.js?v=00a22f4faf';

const TYPE = { nvme: 'NVMe SSD', sata: 'SATA SSD', hdd: 'Hard drive' };

export default {
  keySpecs: (p) => [
    ['Type', TYPE[p.type] ?? p.type],
    ['Capacity', capacity(p.capacityGB)],
    ['Interface', p.pcieGen ? `PCIe ${p.pcieGen}.0` : p.formFactor],
    ['Read', p.readMBs ? `${num(p.readMBs)} MB/s` : null],
  ],
  specs: (p) => [
    ['Type', TYPE[p.type] ?? p.type],
    ['Capacity', capacity(p.capacityGB)],
    ['Form factor', p.formFactor],
    ['Interface', p.interface],
    ['Sequential read', p.readMBs ? `${num(p.readMBs)} MB/s` : null],
    ['Sequential write', p.writeMBs ? `${num(p.writeMBs)} MB/s` : null],
    ...(p.rpm ? [['Spindle speed', `${num(p.rpm)} rpm`]] : []),
  ],
  filters: [
    { id: 'type', label: 'Type', kind: 'select', get: (p) => TYPE[p.type] ?? p.type },
    { id: 'capacity', label: 'Min capacity', kind: 'min', get: (p) => p.capacityGB, format: capacity, steps: [500, 1000, 2000, 4000] },
    { id: 'gen', label: 'PCIe gen', kind: 'select', get: (p) => (p.pcieGen ? `Gen ${p.pcieGen}` : null) },
  ],
  sorts: [
    { id: 'capacity', label: 'Most capacity', compare: (a, b) => b.capacityGB - a.capacityGB },
    { id: 'read', label: 'Fastest read', compare: (a, b) => (b.readMBs ?? 0) - (a.readMBs ?? 0) },
    { id: 'perTB', label: 'Price per TB', compare: (a, b) => a.refPriceTHB / a.capacityGB - b.refPriceTHB / b.capacityGB },
  ],
};
