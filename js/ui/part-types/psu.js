const MODULAR = { full: 'Fully modular', semi: 'Semi-modular', none: 'Non-modular' };
const eff = (e) => e?.replace('80 PLUS ', '');
const plugs = (c) => {
  if (!c) return null;
  const parts = [
    ['24-pin', c.atx24], ['CPU 8-pin', c.eps8], ['PCIe 8-pin', c.pcie8], ['16-pin', c.pcie16], ['SATA', c.sata], ['Molex', c.molex],
  ];
  return parts.map(([k, v]) => `${k} ${v ?? '?'}`).join(' · ');
};

export default {
  keySpecs: (p) => [
    ['Power', `${p.wattage} W`],
    ['Rating', eff(p.efficiency)],
    ['Size', p.formFactor],
    ['Modular', p.modular ? { full: 'Full', semi: 'Semi', none: 'No' }[p.modular] : null],
    ['16-pin', p.connectors?.pcie16],
  ],
  specs: (p) => [
    ['Wattage', `${p.wattage} W`],
    ['Efficiency', p.efficiency],
    ['Form factor', p.formFactor],
    ['Modular', p.modular ? MODULAR[p.modular] : null],
    ['ATX version', p.atxVersion ?? null],
    ['CPU 8-pin (EPS)', p.connectors?.eps8],
    ['PCIe 8-pin', p.connectors?.pcie8],
    ['16-pin (12V-2x6)', p.connectors?.pcie16],
    ['SATA power', p.connectors?.sata],
    ['Molex', p.connectors?.molex],
    ['All plugs', plugs(p.connectors)],
  ],
  filters: [
    { id: 'watts', label: 'Min wattage', kind: 'min', get: (p) => p.wattage, format: (v) => `${v} W` },
    { id: 'size', label: 'Form factor', kind: 'select', get: (p) => p.formFactor },
    { id: 'modular', label: 'Modular', kind: 'select', get: (p) => (p.modular ? MODULAR[p.modular] : null) },
    { id: 'pcie16', label: '16-pin cable', kind: 'select', get: (p) => (p.connectors?.pcie16 == null ? null : p.connectors.pcie16 > 0 ? 'Native 16-pin' : 'No 16-pin') },
  ],
  sorts: [
    { id: 'watts', label: 'Most wattage', compare: (a, b) => b.wattage - a.wattage },
    { id: 'perW', label: 'Price per watt', compare: (a, b) => a.refPriceTHB / a.wattage - b.refPriceTHB / b.wattage },
  ],
};
