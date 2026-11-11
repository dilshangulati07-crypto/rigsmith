#!/usr/bin/env node
// Screenshots of the 3D viewer for visual review: a preset build at each quality level and a
// few camera angles. Headless Chrome via tools/browser-harness.mjs.
// Usage: node tools/render-shots.mjs --shots <dir> [--preset 4k-flagship] [--q low,high,ultra] [--cams angle,front]
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { page, evaluate, waitFor, viewport, sleep, consoleErrors, BASE, finish, ok, fail } from './browser-harness.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const preset = arg('preset', '4k-flagship');
const tag = arg('tag', '');
const levels = arg('q', 'low,high,ultra').split(',');
const cams = arg('cams', 'angle').split(',');
const power = arg('power', '1') === '1';
const dir = arg('shots', 'shots');
const extra = arg('eval', '');

// Only the 3D stage, not the page around it.
async function shot(name) {
  await mkdir(dir, { recursive: true });
  const r = await evaluate(`(() => { const b = document.querySelector('.viewer__stage').getBoundingClientRect(); return { x: b.left + scrollX, y: b.top + scrollY, width: b.width, height: b.height }; })()`);
  const { data } = await page('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 1 } });
  await writeFile(join(dir, `${name}.png`), Buffer.from(data, 'base64'));
}

try {
  await viewport(1500, 1100);
  for (const q of levels) {
    await page('Page.navigate', { url: `${BASE}/builder.html?debug3d&quality=${q}&preset=${preset}` });
    await waitFor('!!window.rigsmith3d', 'viewer', 60000);
    await evaluate(`document.querySelector('.viewer').scrollIntoView({ block: 'start' })`);
    await evaluate('window.rigsmith3d.viewer.envReady');
    await evaluate(`document.querySelector('[data-view="3d"]')?.click()`);
    await sleep(300);
    if (power) await evaluate('window.rigsmith3d.fx.setPower(true, { instant: true })');
    if (extra) await evaluate(extra);
    for (const cam of cams) {
      await evaluate(`window.rigsmith3d.rig.goTo('${cam}', { animate: false })`);
      await sleep(q === 'ultra' ? 2500 : 1200);
      await shot(`${preset}-${q}-${cam}${tag}`);
    }
  }
  ok(consoleErrors.length === 0, `no console errors${consoleErrors.length ? `:\n    ${consoleErrors.slice(0, 8).join('\n    ')}` : ''}`);
} catch (err) {
  fail(err);
}
await finish();
