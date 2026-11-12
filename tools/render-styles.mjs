#!/usr/bin/env node
// Contact sheet of the per-product-line 3D styles (tools/styles.html) saved as a PNG.
// Usage: node tools/render-styles.mjs [--out docs/styles.png] [--q high] [--cats gpu,ram,cooler,case] [--all] [--theme white]
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { page, evaluate, waitFor, viewport, consoleErrors, BASE, finish, ok, fail } from './browser-harness.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const out = arg('out', 'docs/styles.png');
const query = new URLSearchParams({ quality: arg('q', 'high'), cats: arg('cats', 'gpu,ram,cooler,case') });
if (process.argv.includes('--all')) query.set('all', '1');
const theme = arg('theme', null);
if (theme) query.set('theme', theme);

try {
  await viewport(1500, 1000);
  await page('Page.navigate', { url: `${BASE}/tools/styles.html?${query}` });
  await waitFor('window.stylesDone === true', 'style thumbnails', 300000);
  await evaluate('document.fonts.ready.then(() => true)');
  const size = await evaluate('({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })');
  const { data } = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, ...size, scale: 1 } });
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, Buffer.from(data, 'base64'));
  console.log(`${await evaluate('document.getElementById("sub").textContent')}\nSaved ${out} (${size.width}x${size.height})`);
  ok(consoleErrors.length === 0, `no console errors${consoleErrors.length ? `:\n    ${consoleErrors.slice(0, 8).join('\n    ')}` : ''}`);
} catch (err) {
  fail(err);
}
await finish();
