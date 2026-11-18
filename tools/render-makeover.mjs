#!/usr/bin/env node
// Screenshots for design review: landing page, builder and the 3D view at 1280 px and 380 px
// wide, plus a frame-rate sample of the hero at High. Runs on the real GPU unless --soft.
// Usage: node tools/render-makeover.mjs [--out docs/makeover] [--only landing,builder,view,compare] [--soft]
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
if (!process.argv.includes('--soft')) process.env.RIGSMITH_GPU = '1';
const { page, evaluate, waitFor, viewport, sleep, consoleErrors, BASE, finish, ok, fail } = await import('./browser-harness.mjs');

const out = arg('out', 'docs/makeover');
const only = arg('only', 'landing,builder,view,compare,404').split(',');
const WIDTHS = [[1280, 860], [380, 800]];

async function save(name, full = false) {
  await mkdir(out, { recursive: true });
  let clip;
  if (full) {
    const h = await evaluate('Math.min(document.documentElement.scrollHeight, 6000)');
    const w = await evaluate('innerWidth');
    clip = { x: 0, y: 0, width: w, height: h, scale: 1 };
  }
  const { data } = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!full, ...(clip ? { clip } : {}) });
  await writeFile(join(out, `${name}.png`), Buffer.from(data, 'base64'));
  console.log(`  saved ${name}.png`);
}

try {
  for (const [w, h] of WIDTHS) {
    const mobile = w < 600;
    if (only.includes('landing')) {
      await viewport(w, h, mobile);
      await page('Page.navigate', { url: `${BASE}/index.html?quality=high` });
      await waitFor('document.querySelector("#hero-stage")?.dataset.mode === "live" || document.querySelector("#hero-stage")?.dataset.mode === "fallback"', 'hero', 90000);
      await sleep(3500);
      await save(`landing-${w}`);
      await save(`landing-${w}-full`, true);
      if (w > 600) {
        const fps = await evaluate(`new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else r(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); })`);
        const q = await evaluate('document.querySelector("#hero-readout")?.textContent');
        console.log(`  hero fps (headless, real GPU): ${fps.toFixed(1)} — ${q}`);
      }
    }
    if (only.includes('builder') || only.includes('view')) {
      await viewport(w, h, mobile);
      await page('Page.navigate', { url: `${BASE}/builder.html?debug3d&quality=high&preset=high-1440p` });
      await waitFor('document.readyState === "complete"', 'page');
      await sleep(500);
      await evaluate(`document.querySelector('[data-view="3d"]')?.click()`);
      await waitFor('!!window.rigsmith3d', 'viewer', 90000);
      await evaluate('window.rigsmith3d.viewer.envReady');
      await waitFor('!window.rigsmith3d.scene.busy', 'models', 60000);
      await evaluate('window.rigsmith3d.fx.setPower(true, { instant: true })');
      await sleep(2500);
      if (only.includes('builder')) {
        await save(`builder-${w}`);
        await save(`builder-${w}-full`, true);
      }
      if (only.includes('view')) {
        await evaluate(`(() => { const s = document.querySelector('.viewer__stage'); s.scrollIntoView({ block: 'center' }); })()`);
        await sleep(800);
        const r = await evaluate(`(() => { const b = document.querySelector('.viewer__stage').getBoundingClientRect(); return { x: b.left + scrollX, y: b.top + scrollY, width: b.width, height: b.height }; })()`);
        await mkdir(out, { recursive: true });
        const { data } = await page('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 1 } });
        await writeFile(join(out, `view-${w}.png`), Buffer.from(data, 'base64'));
        console.log(`  saved view-${w}.png`);
      }
    }
    if (only.includes('compare')) {
      await viewport(w, h, mobile);
      await page('Page.navigate', { url: `${BASE}/compare.html` });
      await sleep(2500);
      await save(`compare-${w}`);
    }
    if (only.includes('404')) {
      await viewport(w, h, mobile);
      await page('Page.navigate', { url: `${BASE}/404.html` });
      await sleep(800);
      await save(`404-${w}`);
    }
  }
  ok(consoleErrors.length === 0, `no console errors${consoleErrors.length ? `:\n    ${consoleErrors.slice(0, 8).join('\n    ')}` : ''}`);
} catch (err) {
  fail(err);
}
await finish();
