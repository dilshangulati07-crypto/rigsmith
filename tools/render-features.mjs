#!/usr/bin/env node
// Renders the landing page's feature card images (img/feature-*.jpg) from the real 3D view:
//   hand     close-up of the board with the side panel off
//   auto     exploded view of a whole build
//   compare  three preset builds side by side
// Real GPU unless --soft. Usage: node tools/render-features.mjs [--out img]
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
if (!process.argv.includes('--soft')) process.env.RIGSMITH_GPU = '1';
const { page, evaluate, waitFor, viewport, sleep, consoleErrors, BASE, finish, ok, fail } = await import('./browser-harness.mjs');

const out = arg('out', 'img');
const R = 'window.rigsmith3d';
const [W, H] = [800, 600];

async function open(preset, w = W, h = H) {
  await viewport(1400, 1000);
  await page('Page.navigate', { url: `${BASE}/builder.html?debug3d&quality=high&preset=${preset}` });
  await waitFor(`!!${R}`, 'viewer', 90000);
  await evaluate(`${R}.viewer.envReady`);
  await evaluate(`(() => { document.querySelector('[data-view="3d"]')?.click(); const s = document.querySelector('.viewer__stage'); s.style.cssText = 'position:fixed;left:0;top:0;width:${w}px;height:${h}px;z-index:999'; document.querySelectorAll('.viewer__stage > :not(canvas)').forEach((e) => { e.style.visibility = 'hidden'; }); })()`);
  await waitFor(`!${R}.scene.busy`, 'models', 60000);
  await evaluate(`${R}.viewer.setQuality('high', { manual: true })`);
  await evaluate(`${R}.fx.setPower(true, { instant: true })`);
  await evaluate(`${R}.rig.setAutoOrbit?.(false)`);
}

// Camera at `dir` (case frame) from the centre of `target` (a category or 'all'), `k` x its size.
const aim = (target, dir, k) => evaluate(`(() => {
  const r = ${R}; const T = r.THREE; const box = new T.Box3();
  for (const m of r.scene.models) if ('${target}' === 'all' || m.category === '${target}') box.expandByObject(m.model);
  const c = box.getCenter(new T.Vector3()); const size = box.getSize(new T.Vector3()).length();
  r.rig.lock?.(true);
  const cam = r.viewer.camera; cam.position.copy(c).addScaledVector(new T.Vector3(...${JSON.stringify(dir)}).normalize(), size * ${k});
  r.viewer.controls.target.copy(c); r.viewer.controls.update();
  r.viewer.invalidateShadows();
})()`);

async function grab(name, w = W, h = H) {
  await sleep(1800);
  const { data } = await page('Page.captureScreenshot', { format: 'jpeg', quality: 86, clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
  await writeFile(join(out, name), Buffer.from(data, 'base64'));
  console.log(`  saved ${join(out, name)}`);
  return data;
}

try {
  await mkdir(out, { recursive: true });

  await open('4k-flagship');
  await evaluate(`${R}.scene.setSidePanel(false)`);
  await aim('motherboard', [0.55, 0.35, 1], 1.35);
  await grab('feature-hand.jpg');

  await evaluate(`${R}.scene.setSidePanel(false); ${R}.scene.setExplode(1, { animate: false })`);
  await aim('all', [0.7, 0.35, 0.85], 1.25);
  await grab('feature-auto.jpg');

  // Three builds side by side, each a third of the image.
  const thirds = [];
  for (const p of ['mid-1440p', '4k-flagship', 'compact-itx']) {
    await open(p, W / 3, H);
    await aim('case', [0.62, 0.3, 0.72], 2.5);
    thirds.push(await grab(`.compare-${p}.jpg`, W / 3, H));
  }
  await evaluate(`(async () => {
    const imgs = await Promise.all(${JSON.stringify(thirds)}.map((d) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = 'data:image/jpeg;base64,' + d; })));
    const c = document.createElement('canvas'); c.width = ${W}; c.height = ${H};
    const g = c.getContext('2d'); imgs.forEach((im, i) => g.drawImage(im, i * ${W / 3}, 0));
    window.__compare = c.toDataURL('image/jpeg', 0.86).split(',')[1];
  })()`);
  await writeFile(join(out, 'feature-compare.jpg'), Buffer.from(await evaluate('window.__compare'), 'base64'));
  console.log(`  saved ${join(out, 'feature-compare.jpg')}`);
  const { rm } = await import('node:fs/promises');
  for (const p of ['mid-1440p', '4k-flagship', 'compact-itx']) await rm(join(out, `.compare-${p}.jpg`), { force: true });
  ok(consoleErrors.length === 0, `no console errors${consoleErrors.length ? `:\n    ${consoleErrors.slice(0, 8).join('\n    ')}` : ''}`);
} catch (err) {
  fail(err);
}
await finish();
