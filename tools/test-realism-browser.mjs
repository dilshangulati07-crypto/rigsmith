#!/usr/bin/env node
// Browser scenario for Phase R (rendering realism) in headless Chrome:
// - quality levels: Low / High / Ultra cycle, studio HDRI lighting at High and Ultra with the
//   built-in room at Low, detail layers per level, Ultra extras (ambient occlusion, SMAA,
//   contact shadow, floor reflection, transmission glass) on only at Ultra;
// - procedural materials and the motherboard's printed face are in place;
// - photo mode: fills the window, backgrounds, depth of field with click-to-focus, hide
//   controls, 2x export at the right pixel size, Esc restores the normal view;
// - GPU memory stays flat when parts are swapped back and forth (at Ultra);
// - 380 px: the photo bar fits. Any console error fails.
// Usage: node tools/test-realism-browser.mjs [--shots <dir>] [-v]
import { ok, fail, finish, sleep, page, evaluate, waitFor, viewport, shot, consoleErrors, BASE } from './browser-harness.mjs';

const R = 'window.rigsmith3d';
const go = async (url) => {
  await page('Page.navigate', { url: BASE + url });
  await waitFor(`!!${R}`, url, 60000);
  await evaluate(`${R}.viewer.envReady`);
};
const press = (key) => evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', bubbles: true }))`);
const state = () => evaluate(`(() => {
  const r = ${R}; const v = r.viewer; const p = v.post.composer.passes; const s = v.scene;
  const by = (n) => p.find((x) => x.constructor.name === n);
  const glass = []; s.traverse((o) => { if (o.isMesh && o.material?.isMeshPhysicalMaterial && o.material.ior) glass.push(o.material.transmission); });
  return {
    quality: v.quality, label: document.querySelector('[data-v="quality"]').textContent, fps: document.querySelector('[data-ref="fps"]').textContent,
    layers: v.camera.layers.mask, envIntensity: s.environmentIntensity,
    gtao: !!by('GTAOPass')?.enabled, smaa: !!by('SMAAPass')?.enabled, bokeh: !!by('BokehPass')?.enabled,
    shadows: v.renderer.shadowMap.enabled, shadowSize: r.stage.key.shadow.mapSize.x,
    contact: !!s.getObjectByName('contact-shadow')?.visible, reflection: !!s.children.find((o) => o.isReflector)?.visible,
    transmission: Math.max(0, ...glass),
  };
})()`);

try {
  await viewport(1280, 900);
  await page('Page.navigate', { url: `${BASE}/index.html` });
  await evaluate('localStorage.clear(); sessionStorage.clear()');

  // ---------------------------------------------------------------- quality levels
  console.log('Quality levels');
  await go('/builder.html?debug3d&quality=low&preset=4k-flagship');
  let s = await state();
  ok(s.quality === 'low' && s.label === 'Quality: Low' && !s.shadows && s.envIntensity === 0.75 && (s.layers & 0b1100) === 0, 'Low: no shadows, built-in room lighting, no detail layers');
  ok(!s.gtao && !s.smaa && !s.contact && !s.reflection && s.transmission === 0, 'Low: none of the Ultra extras');
  await shot('realism-low');

  await evaluate(`document.querySelector('[data-v="quality"]').click()`);
  await evaluate(`${R}.viewer.envReady`);
  s = await state();
  ok(s.quality === 'high' && s.label === 'Quality: High' && s.shadows && s.envIntensity === 1 && (s.layers & 0b1100) === 0b0100, 'High: shadows, studio HDRI lighting, first detail layer');
  ok(!s.gtao && !s.smaa && !s.contact && s.reflection && s.transmission === 0 && s.shadowSize === 2048, `High: cheap floor reflection, none of the other Ultra extras (shadow ${s.shadowSize})`);
  await sleep(600);
  await shot('realism-high');

  await evaluate(`document.querySelector('[data-v="quality"]').click()`);
  await evaluate(`${R}.viewer.envReady`);
  await waitFor(`${R}.viewer.post.composer.passes.some((p) => p.constructor.name === 'GTAOPass') && ${R}.viewer.scene.children.some((o) => o.isReflector)`, 'Ultra passes', 30000);
  s = await state();
  ok(s.quality === 'ultra' && s.label === 'Quality: Ultra' && (s.layers & 0b1100) === 0b1100, 'Ultra: both detail layers');
  ok(s.gtao && s.smaa && s.contact && s.reflection && s.transmission === 1 && s.shadowSize === 4096, 'Ultra: ambient occlusion, SMAA, contact shadow, floor reflection, real glass, 4096 shadow map');
  ok(await waitFor(`/Ultra/.test(document.querySelector('[data-ref="fps"]').textContent)`, 'readout', 30000).catch(() => false), 'the readout names the level');
  await shot('realism-ultra');

  // What the detail layers hold, and the printed board.
  const detail = await evaluate(`(() => { let hi = 0, ul = 0, face = null; ${R}.scene.root.traverse((o) => { if (o.isMesh && o.layers.mask === 4) hi++; if (o.isMesh && o.layers.mask === 8) ul++; if (o.name === 'pcb-face') face = o; });
    const img = face?.material.map.image; return { hi, ul, face: img ? img.width + 'x' + img.height : null, bump: face?.material.bumpMap === face?.material.map }; })()`);
  ok(detail.hi > 20 && detail.ul > 3, `fine geometry sits on the detail layers (${detail.hi} High+, ${detail.ul} Ultra-only meshes)`);
  ok(/^\d{3,4}x\d{3,4}$/.test(detail.face ?? '') && detail.bump, `the motherboard has a printed face with silkscreen (${detail.face} px), also used as its bump map`);

  // ---------------------------------------------------------------- memory across swaps
  console.log('Memory across part swaps (Ultra)');
  const mem = () => evaluate(`(() => { const i = ${R}.viewer.renderer.info; return { g: i.memory.geometries, t: i.memory.textures }; })()`);
  const swap = async (id) => {
    await evaluate(`(() => { const a = ${R}.app; a.store.set('gpu', a.catalog.get('${id}')); })()`);
    await waitFor(`!${R}.scene.busy && ${R}.scene.build?.gpu?.id === '${id}'`, `swap to ${id}`, 20000);
    await sleep(250);
  };
  const ids = await evaluate(`${R}.app.catalog.list('gpu').slice(0, 2).map((p) => p.id)`);
  await swap(ids[0]); await swap(ids[1]);
  const m0 = await mem();
  for (let i = 0; i < 4; i++) { await swap(ids[0]); await swap(ids[1]); }
  const m1 = await mem();
  // Not more (a leak); fewer is fine: the parts-list thumbnail renders free their targets late.
  ok(m1.g <= m0.g && m1.t <= m0.t, `geometries and textures do not grow over 8 more swaps (${m0.g}/${m0.t} -> ${m1.g}/${m1.t})`);

  // ---------------------------------------------------------------- photo mode
  console.log('Photo mode');
  await evaluate(`document.querySelector('.viewer').scrollIntoView()`);
  await press('f');
  await sleep(300);
  const full = await evaluate(`(() => { const b = document.querySelector('.viewer__stage').getBoundingClientRect(); return b.left === 0 && b.top === 0 && Math.round(b.width) === innerWidth && Math.round(b.height) === innerHeight; })()`);
  ok(full && await evaluate(`${R}.photo.active && getComputedStyle(document.querySelector('.viewer__hud')).display === 'none' && !document.querySelector('.photo').hidden`), 'F opens photo mode: the 3D stage fills the window, the HUD is hidden, the photo bar shows');
  ok(await evaluate(`document.elementFromPoint(40, 40) === document.querySelector('.viewer canvas')`), 'nothing of the page is on top of the picture');
  // Backgrounds.
  const bg = () => evaluate(`'#' + ${R}.viewer.scene.background.getHexString()`);
  const dark = await bg();
  await evaluate(`(() => { const s = document.querySelector('[data-p="backdrop"]'); s.value = 'light'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const light = await bg();
  await sleep(700);
  await shot('realism-photo-light');
  await evaluate(`(() => { const s = document.querySelector('[data-p="backdrop"]'); s.value = 'desk'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  ok(dark !== light && await evaluate(`${R}.stage.backdrop === 'desk' && !!${R}.stage.floor.material.map`), `backgrounds: studio, studio white (${light}), desk with a wood top`);
  // Depth of field and click-to-focus.
  ok(await evaluate(`document.querySelector('[data-p="blur"]').disabled`), 'the blur slider waits for depth of field');
  await evaluate(`document.querySelector('[data-p="dof"]').click()`);
  await waitFor(`${R}.viewer.post.composer.passes.some((p) => p.constructor.name === 'BokehPass' && p.enabled)`, 'depth of field pass', 20000);
  const f0 = await evaluate(`${R}.viewer.post.dof.focus`);
  const c = await evaluate(`(() => { const b = document.querySelector('.viewer canvas').getBoundingClientRect(); return { x: b.left + b.width * 0.5, y: b.top + b.height * 0.45 }; })()`);
  for (const type of ['mousePressed', 'mouseReleased']) await page('Input.dispatchMouseEvent', { type, x: c.x, y: c.y, button: 'left', clickCount: 1 });
  await sleep(200);
  const f1 = await evaluate(`${R}.viewer.post.dof.focus`);
  ok(f0 > 20 && f1 > 20 && f1 !== f0 && /Focus set \d+ cm/.test(await evaluate(`document.querySelector('[data-p="note"]').textContent`)), `a click on the PC sets the focus distance (${Math.round(f0)} -> ${Math.round(f1)} cm), and no part dialog opens`);
  ok(!(await evaluate(`!!document.querySelector('dialog[open]')`)), 'the click did not open part details');
  await sleep(900);
  await shot('realism-photo-desk-dof');
  // Export 2x: catch the download link the page clicks and read the PNG's size from its header.
  await evaluate(`window.__png = null; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__png = fetch(this.href).then((r) => r.arrayBuffer()).then((b) => { const d = new DataView(b); return { name: this.download, w: d.getUint32(16), h: d.getUint32(20), sig: d.getUint32(0).toString(16), bytes: b.byteLength }; }); }`);
  await evaluate(`document.querySelector('[data-p="export"][data-scale="2"]').click()`);
  await waitFor('!!window.__png', '2x export', 60000);
  const png = await evaluate('window.__png');
  ok(png.sig === '89504e47' && png.w === 2560 && png.h === 1800 && png.name.includes('2560x1800') && png.bytes > 50000, `2x export saves a PNG at twice the window: ${png.w} x ${png.h} px (${png.name})`);
  ok(await evaluate(`${R}.viewer.renderer.getPixelRatio()`) === 1 && /Saved 2560 × 1800/.test(await evaluate(`document.querySelector('[data-p="note"]').textContent`)), 'the view goes back to its normal resolution and says what was saved');
  // Hide controls, then leave.
  await press('h');
  ok(await evaluate(`getComputedStyle(document.querySelector('.photo__bar')).display === 'none'`), 'H hides the controls');
  await press('Escape');
  ok(await evaluate(`getComputedStyle(document.querySelector('.photo__bar')).display !== 'none' && ${R}.photo.active`), 'Esc brings the controls back first');
  await press('Escape');
  s = await state();
  ok(await evaluate(`!${R}.photo.active && ${R}.stage.backdrop === 'studio' && !document.documentElement.classList.contains('is-photo')`) && !s.bokeh && (await bg()) === dark, 'Esc again leaves photo mode: default studio, no depth of field, page back');
  ok(await evaluate(`document.querySelector('.viewer__stage').getBoundingClientRect().height < innerHeight`), 'the stage is back in the page');

  // ---------------------------------------------------------------- 380 px
  console.log('380 px wide');
  await viewport(380, 820, true);
  await sleep(300);
  await evaluate(`document.querySelector('[data-tab="3d"]').click()`);
  await sleep(300);
  await evaluate(`document.querySelector('[data-v="photo"]').click()`);
  await sleep(300);
  ok(await evaluate(`[...document.querySelectorAll('.photo__bar > *')].every((e) => e.getBoundingClientRect().right <= innerWidth + 1) && document.documentElement.scrollWidth <= innerWidth`), 'the photo bar wraps inside 380 px');
  await shot('realism-photo-380');

  ok(consoleErrors.length === 0, `no console errors${consoleErrors.length ? `:\n    ${consoleErrors.slice(0, 8).join('\n    ')}` : ''}`);
} catch (err) {
  fail(err);
}
await finish();
