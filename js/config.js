// Single place for app-wide settings. Rename the app here.
export const CONFIG = Object.freeze({
  appName: 'Rigsmith',
  version: '0.1.0',
  author: 'Dilshan',
  threeRevision: '170',
  currency: 'THB',
  priceNote: 'Reference price, not live',

  // Pages shown in the top bar. `soon: true` renders a disabled entry.
  nav: [
    { id: 'builder', label: 'Builder', href: 'builder.html' },
    { id: 'compare', label: 'Compare', href: 'compare.html' },
    { id: 'gallery', label: 'Gallery', href: null, soon: true },
  ],

  scene: {
    background: 0x0b0d10,
    maxPixelRatio: 2,
    // Below this average frame rate the viewer drops to low quality.
    lowFpsThreshold: 35,
  },
});
