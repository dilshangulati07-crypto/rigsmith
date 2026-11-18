#!/usr/bin/env node
// Frame rate of the 3D view at Low, High and Ultra with a full high-end build (the
// "4K flagship" preset), plus draw calls and triangles per frame at each level.
// Runs headless Chrome on the real GPU with the frame-rate cap off, so the numbers show
// headroom above 60. They are for THIS machine and window size; on battery or in a real
// tab (capped at the screen's refresh rate) you will see less.
// Usage: node tools/bench-quality.mjs [--preset 4k-flagship] [--size 1280x720]
process.env.RIGSMITH_GPU = '1';
const { page, evaluate, waitFor, viewport, sleep, consoleErrors, BASE, finish, ok, fail } = await import('./browser-harness.mjs');

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const preset = arg('preset', '4k-flagship');
const [W, H] = arg('size', '1280x720').split('x').map(Number);
const R = 'window.rigsmith3d';
const levels = arg('q', 'low,high,ultra').split(',');
const extra = arg('eval', ''); // JS to run before measuring (for experiments)

try {
  await viewport(W + 40, H + 400);
  const rows = [];
  let gpu = '';
  for (const q of levels) {
    await page('Page.navigate', { url: `${BASE}/builder.html?debug3d&quality=${q}&preset=${preset}` });
    await waitFor(`!!${R}`, 'viewer', 60000);
    await evaluate(`${R}.viewer.envReady`);
    // A stage of exactly W x H CSS pixels, at device pixel ratio 1.
    await evaluate(`(() => { document.querySelector('[data-view="3d"]')?.click(); const s = document.querySelector('.viewer__stage'); s.style.cssText = 'position:fixed;left:0;top:0;width:${W}px;height:${H}px;z-index:999'; })()`);
    await evaluate(`${R}.fx.setPower(true, { instant: true })`);
    // Hold the level: the frame-rate monitor may have dropped it while the models loaded.
    await evaluate(`${R}.viewer.setQuality('${q}', { manual: true })`);
    if (q === 'ultra') await waitFor(`${R}.viewer.post.composer.passes.some((p) => p.constructor.name === 'GTAOPass') && ${R}.viewer.scene.children.some((o) => o.isReflector)`, 'Ultra passes', 30000);
    if (extra) await evaluate(extra);
    await sleep(2500);
    gpu ||= await evaluate(`(() => { const gl = ${R}.viewer.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); })()`);
    const fps = await evaluate(`new Promise((done) => { let n = 0; const t0 = performance.now(); const f = () => { n++; const t = performance.now() - t0; if (t >= 5000) done(n / (t / 1000)); else requestAnimationFrame(f); }; requestAnimationFrame(f); })`);
    // Everything one frame draws, including shadow, mirror, depth and transmission passes.
    const info = await evaluate(`(() => { const v = ${R}.viewer; const i = v.renderer.info; i.autoReset = false; i.reset(); v.invalidateShadows(); v.render(); const out = { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures }; i.autoReset = true; return out; })()`);
    const size = await evaluate(`(() => { const c = document.querySelector('.viewer canvas'); return c.width + 'x' + c.height; })()`);
    rows.push({ quality: q, fps: Math.round(fps), ...info, size, actual: await evaluate(`${R}.viewer.quality`) });
  }
  console.log(`\nGPU: ${gpu}`);
  console.log(`Build: ${preset}, canvas ${rows[0].size} px, powered on (fans spinning, LEDs lit)\n`);
  console.log('quality   fps   draw calls   triangles   geometries   textures');
  for (const r of rows) console.log(`${r.quality.padEnd(8)} ${String(r.fps).padStart(4)}   ${String(r.calls).padStart(10)}   ${String(r.triangles).padStart(9)}   ${String(r.geometries).padStart(10)}   ${String(r.textures).padStart(8)}${r.actual !== r.quality ? `   (viewer dropped to ${r.actual})` : ''}`);
  if (/swiftshader|llvmpipe|basic render/i.test(gpu)) console.log('\nNote: this ran on a software renderer, not the GPU. The frame rates say nothing about real hardware.');
  ok(consoleErrors.length === 0, `no console errors${consoleErrors.length ? `:\n    ${consoleErrors.slice(0, 8).join('\n    ')}` : ''}`);
} catch (err) {
  fail(err);
}
await finish();
