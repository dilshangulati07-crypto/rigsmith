#!/usr/bin/env node
// Renders the images the site needs for first paint and for sharing, from the real 3D hero
// (the white RGB showcase build, CONFIG.scene.heroPreset):
//   img/hero-poster.webp   still of the hero, shown on the landing page until the live 3D starts
//   img/og-image.jpg       1200 x 630 Open Graph / Twitter card (layout: tools/share-card.html)
//   img/apple-touch-icon.png  180 x 180 home-screen icon
//   img/feature-*.webp     WebP copies of the feature renders (img/feature-*.jpg stay as fallback)
// Real GPU unless --soft. Usage: node tools/render-share.mjs
import { writeFile, readdir } from 'node:fs/promises';

if (!process.argv.includes('--soft')) process.env.RIGSMITH_GPU = '1';
const { page, evaluate, waitFor, sleep, reducedMotion, BASE, finish, ok, fail } = await import('./browser-harness.mjs');

const metrics = (width, height, deviceScaleFactor = 1) =>
  page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile: false });
async function capture(file, format, quality, clip) {
  const { data } = await page('Page.captureScreenshot', { format, ...(quality ? { quality } : {}), clip: { x: 0, y: 0, scale: 1, ...clip } });
  await writeFile(file, Buffer.from(data, 'base64'));
  console.log(`  saved ${file} (${Math.round(Buffer.from(data, 'base64').length / 1024)} KiB)`);
}

try {
  // ---------------------------------------------------------------- hero poster
  // Reduced motion: the hero draws its still frame, which is also the first frame of the
  // animated one (the camera sway starts at zero), so the poster hands over without a jump.
  const [PW, PH] = [1000, 800];
  await reducedMotion(true);
  await metrics(1400, 1000);
  await page('Page.navigate', { url: `${BASE}/index.html?quality=high` });
  await waitFor('document.querySelector("#hero-stage")?.dataset.mode === "live"', 'hero', 120000);
  await evaluate(`(() => {
    const st = document.createElement('style');
    st.textContent = '.hero__stage{position:fixed!important;left:0;top:0;width:${PW}px!important;height:${PH}px!important;max-height:none!important;aspect-ratio:auto!important;border-radius:0!important;box-shadow:none!important;z-index:9999;background:none!important}'
      + '.hero__stage::after,.hero__stage>:not(canvas){display:none!important}.topbar,.bottom-nav{display:none!important}';
    document.head.append(st);
    dispatchEvent(new Event('resize'));
  })()`);
  await sleep(2500);
  await capture('img/hero-poster.webp', 'webp', 82, { width: PW, height: PH });
  await reducedMotion(false);

  // ---------------------------------------------------------------- share card
  await metrics(1200, 630);
  await page('Page.navigate', { url: `${BASE}/tools/share-card.html` });
  await waitFor('document.readyState === "complete" && document.fonts.status === "loaded"', 'share card');
  await sleep(600);
  await capture('img/og-image.jpg', 'jpeg', 88, { width: 1200, height: 630 });

  // ---------------------------------------------------------------- touch icon (full bleed: iOS rounds it)
  await metrics(180, 180);
  await evaluate(`document.body.outerHTML = '<body style="margin:0;width:180px;height:180px;display:grid;place-items:center;background:linear-gradient(135deg,#4F86FF,#8A63FF 60%,#FF6FC0)"><div style="width:76px;height:76px;box-sizing:border-box;border:15px solid #fff;border-radius:19px"></div></body>'`);
  await sleep(200);
  await capture('img/apple-touch-icon.png', 'png', 0, { width: 180, height: 180 });

  // ---------------------------------------------------------------- WebP copies of the feature renders
  for (const f of (await readdir('img')).filter((n) => /^feature-.*\.jpg$/.test(n))) {
    const b64 = await evaluate(`(async () => {
      const img = new Image(); img.src = '${BASE}/img/${f}'; await img.decode();
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      const blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.8));
      const bytes = new Uint8Array(await blob.arrayBuffer()); let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    })()`);
    const out = `img/${f.replace(/\.jpg$/, '.webp')}`;
    await writeFile(out, Buffer.from(b64, 'base64'));
    console.log(`  saved ${out} (${Math.round(Buffer.from(b64, 'base64').length / 1024)} KiB)`);
  }
  ok(true, 'rendered');
} catch (err) {
  fail(err);
}
await finish();
