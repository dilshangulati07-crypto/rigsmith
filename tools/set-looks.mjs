#!/usr/bin/env node
// Writes the optional "look" object into data/parts/*.json: how each product looks, by
// product line. The 3D models read it (js/scene/look.js); nothing else does.
//   look = { style, colour, accent, finish, fans, rgbZones, colourOptions } (+ blades on case fans)
// style: the product line's design (each model file lists the styles it knows).
// colour / accent: the catalogue SKU's main and second colour. finish: surface, where it matters.
// fans: fans you can see (only where the look differs from the part's own `fans`).
// rgbZones: where the real product is lit ([] = no lighting). colourOptions: colours the
// product is sold in, used by the viewer's black / white build theme.
// A null field means "not sure": the model then uses a sensible default for the style.
// The first matching rule wins. Usage: node tools/set-looks.mjs [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'parts');
const BW = ['black', 'white'];
const L = (style, colour = null, o = {}) => ({ style, colour, accent: null, finish: null, fans: null, rgbZones: null, colourOptions: null, ...o });

const RULES = {
  gpu: [
    [/rtx-50\d0-founders/, L('fe-50', 'gunmetal', { accent: 'black', finish: 'metal', fans: 2, rgbZones: ['logo'] })],
    [/rtx-4090-founders|rtx-4070-founders/, L('fe-40', 'silver', { accent: 'black', finish: 'metal', fans: 2, rgbZones: ['logo'] })],
    [/rtx-40.*founders/, L('fe-40', 'black', { accent: 'black', finish: 'metal', fans: 2, rgbZones: ['logo'] })],
    [/rog-strix/, L('rog-strix', 'black', { accent: 'gunmetal', finish: 'metal', fans: 3, rgbZones: ['tail', 'logo'] })],
    [/rog-astral/, L('rog-astral', 'black', { accent: 'gunmetal', finish: 'metal', fans: 4, rgbZones: ['tail'] })],
    [/asus-tuf/, L('tuf', 'gunmetal', { accent: 'black', finish: 'metal', fans: 3, rgbZones: ['logo'] })],
    [/asus-prime/, L('asus-prime', 'black', { fans: 3, rgbZones: [], colourOptions: BW })],
    [/asus-dual/, L('asus-dual', 'black', { fans: 2, rgbZones: [], colourOptions: BW })],
    [/ventus-2x-black/, L('msi-ventus', 'black', { accent: 'black', fans: 2, rgbZones: [] })],
    [/ventus-3x/, L('msi-ventus', 'black', { accent: 'silver', fans: 3, rgbZones: [] })],
    [/ventus-2x/, L('msi-ventus', 'black', { accent: 'silver', fans: 2, rgbZones: [] })],
    [/rtx-4060-windforce/, L('gigabyte-windforce', 'black', { accent: 'grey', fans: 2, rgbZones: [] })],
    [/windforce/, L('gigabyte-windforce', 'black', { accent: 'grey', fans: 3, rgbZones: [] })],
    [/zotac.*twin-edge/, L('zotac-twin-edge', 'gunmetal', { fans: 2 })],
    [/^amd-radeon-rx-7900/, L('amd-reference', 'black', { accent: 'red', finish: 'metal', fans: 3 })],
    [/^amd-radeon-rx-7800/, L('amd-reference', 'black', { accent: 'red', finish: 'metal' })],
    [/nitro-plus.*7900/, L('sapphire-nitro', 'silver', { accent: 'black', finish: 'metal', fans: 3, rgbZones: ['bar', 'logo'] })],
    [/nitro-plus/, L('sapphire-nitro', 'gunmetal', { accent: 'black', finish: 'metal', fans: 3, rgbZones: ['bar'] })],
    [/sapphire-pulse.*(9070|7900)/, L('sapphire-pulse', 'black', { accent: 'red', fans: 3, rgbZones: [] })],
    [/sapphire-pulse/, L('sapphire-pulse', 'black', { accent: 'red', fans: 2, rgbZones: [] })],
    [/hellhound/, L('powercolor-hellhound', 'black', { fans: 3, rgbZones: ['fans'] })],
    [/reaper/, L('powercolor-reaper', 'black', { fans: 3, rgbZones: [] })],
    [/xfx-speedster-qick/, L('xfx-qick', 'black', { fans: 3, rgbZones: [] })],
    [/challenger/, L('asrock-challenger', 'black', { accent: 'silver', fans: 2, rgbZones: [] })],
    [/arc-a770-limited/, L('intel-le', 'black', { finish: 'matte', fans: 2, rgbZones: ['fans', 'bar'] })],
    [/arc-.*limited/, L('intel-le', 'black', { finish: 'matte', fans: 2, rgbZones: [] })],
  ],
  ram: [
    [/fury-beast-rgb/, L('fury-beast-rgb', 'black', { rgbZones: ['bar'], colourOptions: BW })],
    [/fury-beast-ddr5/, L('fury-beast', 'black', { rgbZones: [], colourOptions: BW })],
    [/fury-beast/, L('fury-beast', 'black', { rgbZones: [] })],
    [/fury-renegade/, L('fury-renegade', 'black', { accent: 'silver', rgbZones: [] })],
    [/vengeance-lpx/, L('vengeance-lpx', 'black', { rgbZones: [], colourOptions: BW })],
    [/vengeance-rgb-pro/, L('vengeance-rgb-pro', 'black', { rgbZones: ['bar'], colourOptions: BW })],
    [/vengeance-rgb-ddr5/, L('vengeance-rgb', 'black', { rgbZones: ['bar'], colourOptions: BW })],
    [/vengeance-ddr5/, L('vengeance', 'black', { rgbZones: [], colourOptions: BW })],
    [/dominator-platinum/, L('dominator', 'black', { accent: 'silver', finish: 'metal', rgbZones: ['dots'], colourOptions: BW })],
    [/ripjaws-v/, L('ripjaws-v', null, { rgbZones: [] })],
    [/ripjaws-s5/, L('ripjaws-s5', 'black', { rgbZones: [], colourOptions: BW })],
    [/flare-x5/, L('flare-x5', 'black', { rgbZones: [] })],
    [/trident-z5-neo/, L('trident-z5', 'black', { accent: 'silver', finish: 'metal', rgbZones: ['bar'] })],
    [/trident-z5/, L('trident-z5', null, { finish: 'metal', rgbZones: ['bar'], colourOptions: BW })],
    [/trident-z/, L('trident-z', 'black', { accent: 'silver', finish: 'metal', rgbZones: ['bar'] })],
    [/vulcan-z/, L('tforce-vulcan', null, { rgbZones: [] })],
    [/t-force-delta/, L('tforce-delta', 'black', { rgbZones: ['bar'], colourOptions: BW })],
    [/crucial-pro/, L('crucial-pro', 'black', { rgbZones: [] })],
    [/crucial-ddr4/, L('bare', 'green', { rgbZones: [] })],
    [/crucial-ddr5/, L('bare', 'black', { rgbZones: [] })],
  ],
  cooler: [
    [/deepcool-ag/, L('deepcool-ag', 'silver', { accent: 'black', rgbZones: [] })],
    [/deepcool-ak/, L('deepcool-ak', 'silver', { accent: 'black', rgbZones: [], colourOptions: ['silver', 'black', 'white'] })],
    [/peerless-assassin/, L('thermalright', 'silver', { accent: 'grey', rgbZones: [], colourOptions: ['silver', 'black', 'white'] })],
    [/thermalright/, L('thermalright', 'silver', { accent: 'grey', rgbZones: [] })],
    [/arctic-freezer/, L('arctic-freezer', 'silver', { accent: 'black', rgbZones: [], colourOptions: ['silver', 'black'] })],
    [/hyper-212/, L('cm-hyper', 'silver', { accent: 'black', rgbZones: ['fans'] })],
    [/se-224/, L('id-cooling', 'silver', { accent: 'black', rgbZones: [], colourOptions: ['silver', 'black', 'white'] })],
    [/is-55/, L('id-cooling', 'black', { rgbZones: [], colourOptions: BW })],
    [/noctua-nh-l9a/, L('noctua', 'silver', { accent: 'beige', rgbZones: [], colourOptions: ['silver', 'black'] })],
    [/redux/, L('noctua-redux', 'silver', { accent: 'grey', rgbZones: [] })],
    [/noctua/, L('noctua', 'silver', { accent: 'beige', rgbZones: [] })],
    [/pure-rock/, L('bequiet-pure-rock', 'silver', { accent: 'black', rgbZones: [], colourOptions: ['silver', 'black'] })],
    [/dark-rock/, L('bequiet-dark-rock', 'black', { rgbZones: [] })],
    [/h60x/, L('corsair-h', 'black', { rgbZones: ['pump', 'fans'] })],
    [/capellix/, L('corsair-capellix', 'black', { rgbZones: ['pump', 'fans'], colourOptions: BW })],
    [/nautilus/, L('corsair-nautilus', 'black', { rgbZones: [], colourOptions: BW })],
    [/kraken-elite/, L('nzxt-kraken-elite', 'black', { rgbZones: ['screen', 'ring'], colourOptions: BW })],
    [/kraken-120/, L('nzxt-kraken-120', 'black')],
    [/kraken/, L('nzxt-kraken', 'black', { rgbZones: ['screen'], colourOptions: BW })],
    [/masterliquid/, L('cm-masterliquid', 'black', { rgbZones: ['pump', 'fans'] })],
    [/deepcool-le/, L('deepcool-le', 'black', { rgbZones: ['pump', 'fans'] })],
    [/deepcool-lt/, L('deepcool-lt', 'black', { rgbZones: ['pump'], colourOptions: BW })],
    [/liquid-freezer/, L('arctic-liquid-freezer', 'black', { rgbZones: [], colourOptions: BW })],
    [/coreliquid/, L('msi-coreliquid', 'black', { rgbZones: ['pump', 'fans'], colourOptions: BW })],
    [/tuf-gaming-lc/, L('asus-tuf-lc', 'black', { rgbZones: ['pump', 'fans'] })],
    [/galahad/, L('lianli-galahad', 'black', { rgbZones: ['pump', 'fans'], colourOptions: BW })],
    [/ryujin/, L('rog-ryujin', 'black', { rgbZones: ['screen'], colourOptions: BW })],
  ],
  case: [
    [/corsair-\d000d/, L('corsair-airflow', 'black', { accent: 'yellow', colourOptions: BW })],
    [/nzxt-h9/, L('nzxt-h9', 'black', { colourOptions: BW })],
    [/nzxt-h/, L('nzxt-h', 'black', { colourOptions: BW })],
    [/o11-vision/, L('o11-vision', 'black', { colourOptions: BW })],
    [/o11/, L('o11', 'black', { accent: 'silver', finish: 'metal', colourOptions: BW })],
    [/lancool/, L('lancool', 'black', { colourOptions: BW })],
    [/a4-h2o/, L('a4-h2o', 'black', { finish: 'metal', colourOptions: ['black', 'silver'] })],
    [/dan-case-a3/, L('dan-a3', 'black', { colourOptions: BW })],
    [/fractal-design-north/, L('fractal-north', 'black', { accent: 'walnut', colourOptions: BW })],
    [/pop-air/, L('fractal-pop', 'black', { colourOptions: BW })],
    [/meshify/, L('fractal-meshify', 'black', { colourOptions: BW })],
    [/terra/, L('fractal-terra', 'gunmetal', { accent: 'walnut', finish: 'metal', colourOptions: ['gunmetal', 'silver'] })],
    [/ridge/, L('fractal-ridge', 'black', { colourOptions: BW })],
    [/q300l/, L('cm-q300l', 'black')],
    [/nr200p/, L('cm-nr200', 'black', { colourOptions: BW })],
    [/td500/, L('cm-td500', 'black', { colourOptions: BW })],
    [/pure-base-500dx/, L('bequiet-500dx', 'black', { rgbZones: ['front'], colourOptions: BW })],
    [/hyte-y60/, L('hyte-y60', 'black', { colourOptions: BW })],
    [/g360a/, L('phanteks-g360a', 'black', { colourOptions: BW })],
    [/nv7/, L('phanteks-nv', 'black', { colourOptions: BW })],
    [/air-903/, L('montech-air', 'black', { colourOptions: BW })],
    [/sky-two/, L('montech-sky', 'black', { colourOptions: BW })],
    [/deepcool-c[ch]\d/, L('deepcool-ch', 'black', { colourOptions: BW })],
    [/jonsbo-d31/, L('jonsbo-d31', 'black', { colourOptions: BW })],
    [/ap201/, L('asus-ap201', 'black', { colourOptions: BW })],
    [/versa/, L('thermaltake-versa', 'black')],
  ],
  fans: [
    [/nf-a12x25/, L('noctua', 'beige', { accent: 'brown', blades: 9, rgbZones: [] })],
    [/nf-a14/, L('noctua', 'beige', { accent: 'brown', blades: 7, rgbZones: [] })],
    [/redux/, L('noctua-redux', 'grey', { accent: 'grey', blades: 9, rgbZones: [] })],
    [/arctic-p1/, L('arctic-p', 'black', { blades: 5, rgbZones: [] })],
    [/uni-fan-sl/, L('lianli-unifan-sl', 'black', { accent: 'silver', rgbZones: ['sides'], colourOptions: BW })],
    [/uni-fan-tl/, L('lianli-unifan-tl', 'black', { rgbZones: ['infinity', 'sides'], colourOptions: BW })],
    [/icue-link-rx/, L('corsair-rx', 'black', { rgbZones: ['blades'], colourOptions: BW })],
    [/silent-wings/, L('bequiet-silent-wings', 'black', { blades: 7, rgbZones: [] })],
    [/tl-c12c/, L('thermalright-tl', 'black', { rgbZones: ['blades'], colourOptions: BW })],
    [/fc120/, L('deepcool-fc', 'black', { rgbZones: ['blades'], colourOptions: BW })],
    [/sickleflow/, L('cm-sickleflow', 'black', { rgbZones: ['blades'], colourOptions: BW })],
    [/phanteks-d30/, L('phanteks-d30', 'black', { rgbZones: ['ring'], colourOptions: BW })],
  ],
  psu: [
    [/rog-thor/, L('rog-thor', 'black', { accent: 'gunmetal', finish: 'metal', rgbZones: ['logo', 'screen'] })],
    [/rog-loki/, L('rog-loki', 'black', { accent: 'silver', rgbZones: ['fan'], colourOptions: BW })],
    [/corsair-sf/, L('corsair-sf', 'black', { accent: 'yellow' })],
    [/corsair-(rm|hx)/, L('corsair-rm', 'black', { accent: 'yellow' })],
    [/corsair/, L('corsair-cx', 'black', { accent: 'yellow' })],
    [/seasonic-prime/, L('seasonic-prime', 'black', { accent: 'silver' })],
    [/seasonic-focus/, L('seasonic-focus', 'black', { accent: 'silver' })],
    [/seasonic/, L('seasonic-s12', 'grey')],
    [/msi-mag-a750gl/, L('msi-mag', 'black', { colourOptions: BW })],
    [/msi-mpg/, L('msi-mpg', 'black', { accent: 'silver' })],
    [/msi/, L('msi-mag', 'black')],
    [/be-quiet-dark-power/, L('bequiet-dark-power', 'black', { accent: 'silver', finish: 'metal' })],
    [/be-quiet/, L('bequiet-power', 'black', { accent: 'orange' })],
    [/lian-li-sp/, L('lianli-sp', 'black', { colourOptions: BW })],
    [/cooler-master-v850/, L('cm-v-sfx', 'black', { colourOptions: BW })],
    [/cooler-master/, L('cm-mwe', 'black')],
    [/thermaltake-toughpower/, L('thermaltake-toughpower', 'black', { colourOptions: BW })],
    [/thermaltake/, L('thermaltake-smart', 'black')],
    [/fsp/, L('fsp-hydro', 'black')],
    [/deepcool/, L('deepcool-p', 'black')],
  ],
  storage: [
    [/samsung-990-pro/, L('m2-label', 'black', { accent: 'red' })],
    [/samsung-9/, L('m2-label', 'black')],
    [/samsung-870/, L('ssd-25', 'black', { accent: 'grey' })],
    [/wd-black/, L('m2-label', 'black', { accent: 'white' })],
    [/wd-blue-sn/, L('m2-label', 'blue', { accent: 'white' })],
    [/crucial-t7/, L('m2-label', 'black')],
    [/crucial-p3/, L('m2-label', 'black')],
    [/crucial-mx500/, L('ssd-25', 'silver', { accent: 'blue', finish: 'metal' })],
    [/kingston-nv/, L('m2-label', 'white', { accent: 'black' })],
    [/kingston-kc3000/, L('m2-spreader', 'black', { finish: 'metal' })],
    [/kingston-a400/, L('ssd-25', 'grey', { accent: 'black' })],
    [/firecuda/, L('m2-label', 'black', { accent: 'orange' })],
    [/lexar/, L('m2-label', 'black')],
    [/corsair-mp700/, L('m2-label', 'black', { accent: 'yellow' })],
    [/seagate-barracuda/, L('hdd-35', 'silver', { accent: 'green' })],
    [/wd-blue/, L('hdd-35', 'silver', { accent: 'blue' })],
    [/wd-red/, L('hdd-35', 'silver', { accent: 'red' })],
  ],
  motherboard: [
    [/rog-(crosshair|maximus)/, L('rog-hero', 'black', { accent: 'gunmetal', finish: 'mirror', rgbZones: ['io'] })],
    [/rog-strix/, L('rog-strix', 'black', { accent: 'gunmetal', finish: 'mirror', rgbZones: ['io'] })],
    [/tuf-gaming-b550/, L('tuf', 'black', { accent: 'yellow', rgbZones: ['edge'] })],
    [/tuf-gaming/, L('tuf', 'black', { accent: 'grey' })],
    [/asus-prime-h610/, L('budget', 'black', { rgbZones: [] })],
    [/asus-prime/, L('prime', 'black', { accent: 'silver' })],
    [/tomahawk/, L('msi-tomahawk', 'black', { accent: 'gunmetal' })],
    [/msi-mpg.*edge/, L('msi-mpg-edge', 'black', { accent: 'silver' })],
    [/msi-mpg/, L('msi-mpg', 'black', { accent: 'red' })],
    [/msi-(a520m|b450m|pro-a620m)/, L('budget', 'black', { rgbZones: [] })],
    [/msi-(pro|b550m-pro)/, L('msi-pro', 'black', { accent: 'silver', rgbZones: [] })],
    [/aorus/, L('aorus', 'black', { accent: 'gunmetal' })],
    [/gigabyte/, L('budget', 'black', { rgbZones: [] })],
    [/taichi/, L('asrock-taichi', 'black', { accent: 'gold', rgbZones: ['io'] })],
    [/asrock-a520m/, L('budget', 'black', { rgbZones: [] })],
    [/asrock/, L('asrock-pro', 'black', { accent: 'silver' })],
  ],
};

// Dimensions that are not looks but only the models use: radiator core thickness where the
// maker's figure differs from the usual 27 mm.
const RADIATOR_THICKNESS = [[/liquid-freezer-iii/, 38], [/ryujin-iii/, 30]];

const check = process.argv.includes('--check');
let missing = 0;
for (const [cat, rules] of Object.entries(RULES)) {
  const file = join(DIR, `${cat}.json`);
  const json = JSON.parse(readFileSync(file, 'utf8'));
  for (const p of json.parts) {
    const rule = rules.find(([re]) => re.test(p.id));
    if (!rule) { missing++; console.log(`no look rule: ${cat} ${p.id}`); }
    p.look = structuredClone(rule ? rule[1] : L(null));
    if (cat === 'cooler' && p.type === 'aio') {
      const t = RADIATOR_THICKNESS.find(([re]) => re.test(p.id));
      if (t) p.radiatorThicknessMM = t[1];
    }
  }
  if (!check) writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}
console.log(missing ? `${missing} parts have no rule (look left empty).` : `Looks ${check ? 'checked' : 'written'} for ${Object.keys(RULES).length} categories.`);
process.exit(missing ? 1 : 0);
