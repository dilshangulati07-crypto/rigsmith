import { unit } from '../dom.js?v=00a22f4faf';

const WIFI = { none: 'None', wifi5: 'Wi-Fi 5', wifi6: 'Wi-Fi 6', wifi6e: 'Wi-Fi 6E', wifi7: 'Wi-Fi 7' };
const slots = (list) => (list ? list.map((s) => `${s.size} (x${s.lanes} Gen${s.gen}${s.from ? `, ${s.from}` : ''})`).join(', ') : null);

export default {
  keySpecs: (p) => [
    ['Socket', `${p.socket} ${p.chipset}`],
    ['Size', p.formFactor],
    ['Memory', `${p.memoryType} × ${p.memorySlots}`],
    ['M.2', p.m2Slots],
    ['Wi-Fi', WIFI[p.wifi] ?? p.wifi],
  ],
  specs: (p) => [
    ['Socket', p.socket],
    ['Chipset', p.chipset],
    ['Form factor', p.formFactor],
    ['Memory type', p.memoryType],
    ['Memory slots', p.memorySlots],
    ['Max memory', unit(p.maxMemoryGB, ' GB')],
    ['PCIe slots', slots(p.pcieSlots)],
    ['M.2 slots', p.m2Slots],
    ['SATA ports', p.sataPorts],
    ['Wi-Fi', WIFI[p.wifi] ?? p.wifi],
  ],
  filters: [
    { id: 'socket', label: 'Socket', kind: 'select', get: (p) => p.socket },
    { id: 'chipset', label: 'Chipset', kind: 'select', get: (p) => p.chipset },
    { id: 'size', label: 'Form factor', kind: 'select', get: (p) => p.formFactor, order: ['E-ATX', 'ATX', 'mATX', 'ITX'] },
    { id: 'memory', label: 'Memory', kind: 'select', get: (p) => p.memoryType },
    { id: 'wifi', label: 'Wi-Fi', kind: 'select', get: (p) => WIFI[p.wifi] ?? p.wifi },
  ],
  sorts: [
    { id: 'm2', label: 'Most M.2 slots', compare: (a, b) => (b.m2Slots ?? -1) - (a.m2Slots ?? -1) },
  ],
};
