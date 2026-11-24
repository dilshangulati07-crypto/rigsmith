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
    { id: 'gallery', label: 'Gallery', href: 'gallery.html' },
  ],

  scene: {
    // Light-grey photo studio behind the 3D view (the 'studio' backdrop in js/scene/stage.js).
    background: 0xd5d7db,
    maxPixelRatio: 2,
    // Tone-mapping exposure: lifts black parts to a dark grey with visible detail.
    exposure: 0.74,
    // Below this average frame rate the viewer drops to low quality.
    lowFpsThreshold: 35,
    // Preset build (data/presets.json) shown powered on in the landing-page hero.
    heroPreset: '4k-flagship',
    // Build colour theme for the showcase (js/scene/look.js): white where the product is sold in white.
    heroTheme: 'white',
  },
});
