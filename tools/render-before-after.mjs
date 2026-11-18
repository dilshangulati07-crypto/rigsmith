#!/usr/bin/env node
// Visual proof: the same preset build rendered by an older commit (default: Phase 6) and by
// the working tree, side by side, into one PNG. Row 1 uses the exact same camera for both
// (the old commit's default 3/4 view); row 2 shows each version's own default view.
// The old commit is checked out into a temporary git worktree and served on its own port.
// Runs on the real GPU (what you see in Chrome) unless --soft is given.
// Usage: node tools/render-before-after.mjs [--ref 94d9c3a] [--preset mid-1440p] [--q high]
//        [--out docs/before-after.png] [--size 900x600] [--soft]
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
if (!process.argv.includes('--soft')) process.env.RIGSMITH_GPU = '1';
const { page, evaluate, waitFor, viewport, sleep, consoleErrors, BASE, serveDir, finish, ok, fail } = await import('./browser-harness.mjs');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ref = arg('ref', '94d9c3a');
const preset = arg('preset', 'mid-1440p');
const q = arg('q', 'high');
const out = arg('out', 'docs/before-after.png');
const [W, H] = arg('size', '900x600').split('x').map(Number);
const R = 'window.rigsmith3d';
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();

const refName = git('log', '-1', '--format=%h %s', ref);
const headName = `${git('log', '-1', '--format=%h', 'HEAD')}${git('status', '--porcelain') ? ' + uncommitted changes' : ''}`;
const wt = await mkdtemp(join(tmpdir(), 'rigsmith-before-'));

async function open(base) {
  await viewport(1320, 1120);
  await page('Page.navigate', { url: `${base}/builder.html?debug3d&quality=${q}&preset=${preset}` });
  await waitFor(`!!${R}`, 'viewer', 90000);
  await evaluate(`${R}.viewer.envReady ?? true`);
  await evaluate(`(() => { document.querySelector('[data-view="3d"]')?.click(); const s = document.querySelector('.viewer__stage'); s.style.cssText = 'position:fixed;left:0;top:0;width:${W}px;height:${H}px;z-index:999'; })()`);
  await waitFor(`!${R}.scene.busy`, 'models', 60000);
  await evaluate(`${R}.viewer.setQuality('${q}', { manual: true })`);
  await evaluate(`${R}.fx.setPower(true, { instant: true })`);
  await evaluate(`${R}.rig.setAutoOrbit?.(false)`);
}

async function grab() {
  await evaluate(`${R}.viewer.invalidateShadows()`);
  await sleep(q === 'ultra' ? 3000 : 1500);
  const { data } = await page('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
  return `data:image/png;base64,${data}`;
}

const getCam = `(() => { const v = ${R}.viewer; return { p: v.camera.position.toArray(), t: v.controls.target.toArray() }; })()`;
const setCam = (c) => `(() => { const v = ${R}.viewer; v.camera.position.fromArray(${JSON.stringify(c.p)}); v.controls.target.fromArray(${JSON.stringify(c.t)}); v.controls.update(); })()`;

try {
  git('worktree', 'add', '--detach', '--force', wt, ref);
  const OLD = await serveDir(wt);

  // Old commit: its default 3/4 view is the shared camera.
  await open(OLD);
  await evaluate(`${R}.rig.goTo('angle', { animate: false })`);
  const cam = await evaluate(getCam);
  const oldShot = await grab();
  const oldFps = await evaluate(`Math.round(${R}.viewer.fps)`);

  // Working tree: same camera, then its own default view.
  await open(BASE);
  await evaluate(`${R}.rig.goTo('angle', { animate: false })`);
  const newOwn = await grab();
  const newFps = await evaluate(`Math.round(${R}.viewer.fps)`);
  await evaluate(setCam(cam));
  const newSame = await grab();

  const cell = (src, cap) => `<figure><img src="${src}" width="${W}" height="${H}"><figcaption>${cap}</figcaption></figure>`;
  const doc = `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; padding: 24px; background: #0B0D10; color: #E7EAEE; font: 14px/1.4 'IBM Plex Sans', system-ui, sans-serif; width: ${W * 2 + 24}px; }
    h1 { font: 600 20px 'Barlow Condensed', sans-serif; letter-spacing: .06em; text-transform: uppercase; margin: 0 0 4px; }
    p { margin: 0 0 18px; color: #8A93A0; font-family: 'IBM Plex Mono', monospace; font-size: 12px; }
    h2 { font: 600 14px 'Barlow Condensed', sans-serif; letter-spacing: .08em; text-transform: uppercase; color: #8A93A0; margin: 18px 0 8px; }
    .row { display: grid; grid-template-columns: ${W}px ${W}px; gap: 24px; }
    figure { margin: 0; } img { display: block; border: 1px solid #262B33; border-radius: 6px; }
    figcaption { margin-top: 6px; font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: #E7EAEE; }
  </style>
  <h1>Before / after · ${preset} · ${q}</h1>
  <p>Builder 3D view, ${W}x${H} CSS px, powered on, rendered on the real GPU in headless Chrome. Left: ${refName}. Right: ${headName}.</p>
  <h2>Same camera (the old default 3/4 view)</h2>
  <div class="row">${cell(oldShot, `BEFORE · ${ref} · ${oldFps} fps`)}${cell(newSame, `AFTER · ${headName} · same camera`)}</div>
  <h2>Each version's default view</h2>
  <div class="row">${cell(oldShot, `BEFORE · default view`)}${cell(newOwn, `AFTER · default view · ${newFps} fps`)}</div>`;

  await viewport(W * 2 + 72, 400);
  await page('Page.navigate', { url: 'about:blank' });
  await evaluate(`document.open(); document.write(${JSON.stringify(doc)}); document.close();`);
  await evaluate(`Promise.all([...document.images].map((i) => i.decode()))`);
  const size = await evaluate('({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })');
  const { data } = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, ...size, scale: 1 } });
  await mkdir(dirname(join(ROOT, out)), { recursive: true });
  await writeFile(join(ROOT, out), Buffer.from(data, 'base64'));
  console.log(`Saved ${out} (${size.width}x${size.height}). Before: ${refName}. After: ${headName}.`);
  ok(consoleErrors.length === 0, `no console errors${consoleErrors.length ? `:\n    ${consoleErrors.slice(0, 8).join('\n    ')}` : ''}`);
} catch (err) {
  fail(err);
} finally {
  try { git('worktree', 'remove', '--force', wt); } catch { /* already gone */ }
  await rm(wt, { recursive: true, force: true }).catch(() => {});
}
await finish();
