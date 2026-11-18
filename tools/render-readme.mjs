#!/usr/bin/env node
// Screenshots for the README (docs/readme/*.jpg): landing, builder, the 3D view, build by hand
// with every cable routed, compare, and the builder on a phone. Real GPU unless --soft.
// Usage: node tools/render-readme.mjs [--out docs/readme]
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
if (!process.argv.includes('--soft')) process.env.RIGSMITH_GPU = '1';
const { page, evaluate, waitFor, viewport, sleep, open, BASE, finish, ok, fail, consoleErrors } = await import('./browser-harness.mjs');

const out = arg('out', 'docs/readme');
const R = 'window.rigsmith3d';

async function save(name, clip) {
  const { data } = await page('Page.captureScreenshot', { format: 'jpeg', quality: 86, ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
  await writeFile(join(out, name), Buffer.from(data, 'base64'));
  console.log(`  saved ${join(out, name)}`);
}
// Camera at `dir` (case frame) from the centre of the whole build, `k` x its size.
const aim = (dir, k) => evaluate(`(() => {
  const r = ${R}; const T = r.THREE; const box = new T.Box3();
  for (const m of r.scene.models) box.expandByObject(m.model);
  const c = box.getCenter(new T.Vector3()); const size = box.getSize(new T.Vector3()).length();
  r.rig.lock?.(true);
  r.viewer.camera.position.copy(c).addScaledVector(new T.Vector3(...${JSON.stringify(dir)}).normalize(), size * ${k});
  r.viewer.controls.target.copy(c); r.viewer.controls.update(); r.viewer.invalidateShadows();
})()`);
const thumbsDone = () => waitFor('[...document.querySelectorAll(".cat__thumb")].every((t) => t.querySelector("img"))', 'part thumbnails', 60000).catch(() => {});

async function builder(query, w, h, mobile = false) {
  await viewport(w, h, mobile);
  await open(`/builder.html?debug3d&quality=high&${query}`);
  await evaluate(`document.querySelector('[data-view="3d"]')?.click()`);
  await evaluate(`${R}.viewer.envReady`);
  await waitFor(`!${R}.scene.busy`, 'models', 60000);
}

try {
  await mkdir(out, { recursive: true });

  // Landing hero.
  await viewport(1280, 800);
  await page('Page.navigate', { url: `${BASE}/index.html?quality=high` });
  await waitFor('document.querySelector("#hero-stage")?.dataset.mode === "live"', 'hero', 90000);
  await sleep(4000);
  await save('landing.jpg');

  // Builder with a preset, powered on.
  await builder('preset=high-1440p', 1280, 860);
  await evaluate(`${R}.fx.setPower(true, { instant: true })`);
  await thumbsDone();
  await sleep(3000);
  await evaluate(`document.querySelector('.toast')?.remove()`);
  await save('builder.jpg');

  // The 3D view on its own: the flagship preset with the glass side on, lit.
  await builder('preset=4k-flagship', 1280, 860);
  await evaluate(`${R}.fx.setPower(true, { instant: true })`);
  await evaluate(`(() => { const s = document.querySelector('.viewer__stage'); s.style.cssText = 'position:fixed;left:0;top:0;width:1200px;height:720px;z-index:999;border-radius:0'; document.querySelectorAll('.viewer__stage > :not(canvas)').forEach((e) => { e.style.visibility = 'hidden'; }); })()`);
  await sleep(3000);
  await aim([0.6, 0.3, 0.74], 1.75);
  await sleep(1500);
  await save('view.jpg', { x: 0, y: 0, width: 1200, height: 720 });

  // Build by hand: every part placed, then Auto-route for the cables.
  await builder('preset=mid-1440p', 1280, 1100);
  await evaluate(`${R}.setMode('hand')`);
  await waitFor('__t.r().hand.active && __t.t().plan?.ready', 'build mode', 60000);
  await waitFor('__t.idle()', 'idle', 60000);
  for (const g of await evaluate('__t.groups()')) {
    for (let i = 0; i < g.n; i++) { await evaluate(`__t.t().place(${JSON.stringify(g.key)})`); await waitFor('__t.idle()', 'place', 30000); }
  }
  await evaluate(`document.querySelector('[data-c="auto"]').click()`);
  await waitFor('__t.c().count3d > 0 && __t.idle()', 'cables', 60000);
  await evaluate(`${R}.scene.setSidePanel(false)`);
  await aim([0.5, 0.3, 1], 1.25);
  await evaluate(`document.querySelector('.viewer').scrollIntoView({ block: 'start' }); window.scrollBy(0, -130); document.querySelector('.toast')?.remove()`);
  await sleep(2500);
  await save('hand-cables.jpg');
  await evaluate('__t.t().reset()');
  await evaluate('localStorage.clear()');

  // Compare.
  await viewport(1280, 860);
  await page('Page.navigate', { url: `${BASE}/compare.html` });
  await waitFor('document.querySelectorAll("img").length > 0 && [...document.images].every((i) => i.complete)', 'compare', 60000);
  await sleep(2000);
  await save('compare.jpg');

  // Phone: the builder at 380 px.
  await builder('preset=high-1440p', 380, 800, true);
  await evaluate(`${R}.fx.setPower(true, { instant: true })`);
  await thumbsDone();
  await sleep(3000);
  await evaluate(`document.querySelector('.toast')?.remove()`);
  await save('mobile.jpg');

  ok(consoleErrors.length === 0, `no console errors${consoleErrors.length ? `:\n    ${consoleErrors.slice(0, 8).join('\n    ')}` : ''}`);
} catch (err) {
  fail(err);
}
await finish();
