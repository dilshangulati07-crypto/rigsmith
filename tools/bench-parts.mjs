#!/usr/bin/env node
// What each part type costs: frame rate of a preset build with one category hidden at a time
// (real GPU, frame-rate cap off). A category whose removal gains a lot is the one to slim down.
// Usage: node tools/bench-parts.mjs [--preset 4k-flagship] [--q high]
process.env.RIGSMITH_GPU = '1';
const { page, evaluate, waitFor, viewport, sleep, BASE, finish, fail } = await import('./browser-harness.mjs');

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const preset = arg('preset', '4k-flagship');
const q = arg('q', 'high');
const R = 'window.rigsmith3d';
const FPS = `new Promise((done) => { let n = 0; const t0 = performance.now(); const f = () => { n++; const t = performance.now() - t0; if (t >= 3000) done(n / (t / 1000)); else requestAnimationFrame(f); }; requestAnimationFrame(f); })`;

try {
  await viewport(1320, 1120);
  await page('Page.navigate', { url: `${BASE}/builder.html?debug3d&quality=${q}&preset=${preset}` });
  await waitFor(`!!${R}`, 'viewer', 60000);
  await evaluate(`${R}.viewer.envReady`);
  await evaluate(`(() => { document.querySelector('[data-view="3d"]')?.click(); const s = document.querySelector('.viewer__stage'); s.style.cssText = 'position:fixed;left:0;top:0;width:1280px;height:720px;z-index:999'; })()`);
  await evaluate(`${R}.fx.setPower(true, { instant: true })`);
  await sleep(2500);
  const cats = await evaluate(`[...new Set(${R}.scene.models.map((m) => m.category))]`);
  const base = await evaluate(FPS);
  console.log(`\n${preset} at ${q}: ${base.toFixed(1)} fps with everything shown\n`);
  for (const c of cats) {
    await evaluate(`${R}.scene.models.filter((m) => m.category === '${c}').forEach((m) => { m.model.visible = false; }); ${R}.viewer.invalidateShadows()`);
    const fps = await evaluate(FPS);
    await evaluate(`${R}.scene.models.filter((m) => m.category === '${c}').forEach((m) => { m.model.visible = true; })`);
    console.log(`without ${c.padEnd(12)} ${fps.toFixed(1).padStart(6)} fps  (${fps >= base ? '+' : ''}${(fps - base).toFixed(1)})`);
  }
  console.log(`\nagain, everything shown: ${(await evaluate(FPS)).toFixed(1)} fps`);
} catch (err) {
  fail(err);
}
await finish();
