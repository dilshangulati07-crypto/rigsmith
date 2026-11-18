// How a part looks: reads the optional `look` object in the part data (written per product
// line by tools/set-looks.mjs) and applies the viewer's black / white build theme.
// Models take what they need from the result and fall back to their own defaults for null fields.
const THEME_STORE = 'rigsmith.theme.v1';

export const COLOURS = Object.freeze({
  black: 0x1b1d21, white: 0xe3e5e8, silver: 0xa3a9b1, grey: 0x565b63, gunmetal: 0x2c3037,
  red: 0xb3202a, blue: 0x1f4fb8, green: 0x1f6a3a, yellow: 0xe2c02a, orange: 0xe0661f,
  gold: 0xb08a4a, beige: 0xd6c5a4, brown: 0x6a3a2b, walnut: 0x4a2f1d, oak: 0xb89468,
});

export const THEMES = Object.freeze([
  { id: 'auto', label: 'As listed' },
  { id: 'black', label: 'Black' },
  { id: 'white', label: 'White' },
]);

/**
 * @param {object} part
 * @param {'auto'|'black'|'white'} theme a themed colour applies only where the real product is sold in it
 * @returns {{style: string|null, colour: string|null, accent: string|null, finish: string|null,
 *   fans: number|null, zones: string[]|null, themed: boolean, has(zone: string, dflt?: boolean): boolean}}
 */
export function lookOf(part, theme = 'auto') {
  const k = part?.look ?? {};
  const themed = theme !== 'auto' && Array.isArray(k.colourOptions) && k.colourOptions.includes(theme) && k.colour !== theme;
  const zones = Array.isArray(k.rgbZones) ? k.rgbZones : null;
  return {
    style: k.style ?? null,
    colour: themed ? theme : k.colour ?? null,
    accent: k.accent ?? null,
    finish: k.finish ?? null,
    fans: k.fans ?? null,
    zones,
    themed,
    /** Is this zone lit? `dflt` answers when the data does not list the zones. */
    has: (zone, dflt = false) => (zones ? zones.includes(zone) : dflt),
  };
}

export const isPale = (colour) => colour === 'white' || colour === 'silver' || colour === 'beige' || colour === 'oak';

// The showcase look: white wherever the real product is sold in white.
export const DEFAULT_THEME = 'white';

export function loadTheme() {
  try {
    const t = localStorage.getItem(THEME_STORE);
    return THEMES.some((x) => x.id === t) ? t : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}
export function saveTheme(theme) {
  try { localStorage.setItem(THEME_STORE, theme); } catch { /* storage blocked */ }
}
