// Review page for the per-product-line models: one thumbnail per style, rendered with the
// real model factory and the viewer's lighting. Open tools/styles.html through a local server,
// or run tools/render-styles.mjs to save the contact sheet as docs/styles.png.
// Query: ?quality=low|high|ultra  ?cats=gpu,ram,cooler,case  ?all=1 (every part)  ?theme=white
import * as THREE from 'three';
import { createViewer } from '../js/scene/renderer.js';
import { createThumbnailer } from '../js/scene/thumbnails.js';
import { createModel } from '../js/scene/parts.js';
import { caseLayout } from '../js/scene/layout.js';
import { disposeTree } from '../js/scene/resources.js';

const q = new URLSearchParams(location.search);
const cats = (q.get('cats') ?? 'gpu,ram,cooler,case').split(',');
const all = q.has('all');
const theme = q.get('theme') ?? 'auto';
const TITLES = { gpu: 'Graphics cards', ram: 'Memory', cooler: 'CPU coolers', case: 'Cases', fans: 'Fans', psu: 'Power supplies', storage: 'Storage', motherboard: 'Motherboards' };
// Camera direction per category, and a turn that stands parts up the way they sit in a case.
const DIR = { gpu: [0.45, 0.55, 1], ram: [0.7, 0.45, 1], cooler: [0.9, 0.5, 1], case: [1, 0.32, 0.62], fans: [0.4, 0.3, 1], psu: [0.6, 0.5, 1], storage: [0.2, 0.4, 1], motherboard: [0.2, 0.15, 1] };

const viewer = createViewer(document.getElementById('c'));
await viewer.envReady;
const thumbs = createThumbnailer(viewer, { width: 480, height: 360 });
const out = document.getElementById('out');

// Lay the separately placed pieces of a model out side by side, and switch its lighting on.
function stage(model, category) {
  const holder = new THREE.Group();
  holder.add(model);
  const units = model.userData.units;
  if (category === 'cooler') {
    model.rotation.x = -Math.PI / 2; // the socket's "out of the board" axis points up
    if (units?.[1]) { units[1].rotation.x = -Math.PI / 2; units[1].position.set(-16, 0, 7); units[0].position.set(6, 0, 0); }
  } else if (category === 'ram') units?.forEach((u, i) => { u.position.z = -i * 1.6; });
  else if (category === 'fans') units?.forEach((u, i) => { u.position.x = i * (u.userData.size ?? 13); });
  for (const m of model.userData.leds ?? []) {
    if (!m.userData.screen) m.emissive.set(0x6fd0ff);
    m.emissiveIntensity = m.userData.screen ? 1.6 : 1.3 * (m.userData.gain ?? 1);
  }
  return holder;
}

async function shoot(part, t = theme) {
  const model = await createModel(part, { caseLayout: part.category === 'case' ? caseLayout(part) : undefined, anisotropy: 4, theme: t });
  const holder = stage(model, part.category);
  const url = thumbs.shoot(holder, DIR[part.category]);
  disposeTree(holder);
  return url;
}

function card(grid, part, url, note = '') {
  const f = document.createElement('figure');
  const img = new Image();
  img.src = url;
  img.alt = part.name;
  const cap = document.createElement('figcaption');
  const a = document.createElement('div');
  a.className = 'style';
  a.textContent = `${part.look?.style ?? 'default'}${part.look?.colour ? ` · ${part.look.colour}` : ''}${note}`;
  const b = document.createElement('div');
  b.className = 'name';
  b.textContent = part.name;
  cap.append(a, b);
  f.append(img, cap);
  grid.append(f);
}
function section(title) {
  const h = document.createElement('h2');
  h.textContent = title;
  const grid = document.createElement('div');
  grid.className = 'grid';
  out.append(h, grid);
  return grid;
}

let count = 0;
const white = [];
for (const cat of cats) {
  const { parts } = await (await fetch(`data/parts/${cat}.json`)).json();
  const seen = new Set();
  const grid = section(TITLES[cat] ?? cat);
  for (const part of parts) {
    const key = all ? part.id : `${part.look?.style}|${part.look?.colour}|${part.type ?? ''}|${part.look?.fans ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    card(grid, part, await shoot(part));
    count++;
    if (part.look?.colourOptions?.includes('white') && part.look.colour !== 'white' && white.filter((p) => p.category === cat).length < 3) white.push(part);
  }
}
if (theme === 'auto' && white.length && !all) {
  const grid = section('White build theme (parts sold in white)');
  for (const part of white) { card(grid, part, await shoot(part, 'white'), ' -> white'); count++; }
}
document.getElementById('sub').textContent = `${count} thumbnails at ${viewer.quality} quality${all ? ', every part' : ', one per style'}. Lighting zones are shown switched on.`;
window.stylesDone = true;
