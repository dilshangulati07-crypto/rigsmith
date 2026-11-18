#!/usr/bin/env node
// Close-up renders of single parts from a preset build (everything else hidden), for checking
// model detail. Real GPU unless --soft.
// Usage: node tools/render-parts.mjs [--preset 4k-flagship] [--parts gpu,ram,cooler,motherboard,fans,case]
//        [--out shots/parts] [--theme white] [--q high]
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
if (!process.argv.includes('--soft')) process.env.RIGSMITH_GPU = '1';
const { page, evaluate, waitFor, viewport, sleep, consoleErrors, BASE, finish, ok, fail } = await import('./browser-harness.mjs');

const preset = arg('preset', '4k-flagship');
const parts = arg('parts', 'gpu,ram,cooler,motherboard,fans,case').split(',');
const out = arg('out', 'shots/parts');
const theme = arg('theme', 'white');
const q = arg('q', 'high');
const R = 'window.rigsmith3d';
const [W, H] = [900, 640];

try {
  await viewport(1300, 1000);
  await page('Page.navigate', { url: `${BASE}/builder.html?debug3d&quality=${q}&preset=${preset}` });
  await waitFor(`!!${R}`, 'viewer', 90000);
  await evaluate(`${R}.viewer.envReady`);
  await evaluate(`(() => { document.querySelector('[data-view="3d"]')?.click(); const s = document.querySelector('.viewer__stage'); s.style.cssText = 'position:fixed;left:0;top:0;width:${W}px;height:${H}px;z-index:999'; })()`);
  await evaluate(`${R}.scene.setTheme?.('${theme}')`);
  await sleep(300);
  await waitFor(`!${R}.scene.busy`, 'models', 60000);
  await evaluate(`${R}.viewer.setQuality('${q}', { manual: true })`);
  await evaluate(`${R}.fx.setPower(true, { instant: true })`);
  await evaluate(`${R}.rig.setAutoOrbit?.(false)`);
  await mkdir(out, { recursive: true });
  for (const cat of parts) {
    const found = await evaluate(`(() => {
      const r = ${R}; const THREE = r.THREE;
      let target = null;
      for (const m of r.scene.models) { const show = m.category === '${cat}'; m.model.visible = show; if (show) target ??= m.model; }
      if (!target) return false;
      const box = new THREE.Box3().setFromObject(target);
      const c = box.getCenter(new THREE.Vector3()); const size = box.getSize(new THREE.Vector3()).length();
      const dir = new THREE.Vector3(0.75, 0.45, 0.9).normalize();
      const cam = r.viewer.camera; cam.position.copy(c).addScaledVector(dir, size * 1.35);
      r.viewer.controls.target.copy(c); r.viewer.controls.update(); cam.lookAt(c);
      r.viewer.invalidateShadows();
      return true;
    })()`);
    if (!found) { console.log(`  no ${cat} in ${preset}`); continue; }
    await sleep(1500);
    const { data } = await page('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
    await writeFile(join(out, `${cat}.png`), Buffer.from(data, 'base64'));
    console.log(`  saved ${cat}.png`);
  }
  ok(consoleErrors.length === 0, `no console errors${consoleErrors.length ? `:\n    ${consoleErrors.slice(0, 8).join('\n    ')}` : ''}`);
} catch (err) {
  fail(err);
}
await finish();
