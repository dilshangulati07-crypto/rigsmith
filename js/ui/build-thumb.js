// 3D thumbnails of whole builds: rendered once per build code, then cached (in memory and in
// sessionStorage, so landing -> builder -> compare in one tab never renders a build twice).
// three.js and the renderer load only when a thumbnail isn't cached yet.
//
// Markup: <div class="thumb" data-thumb-code="<build code>"></div>, then fillThumb(el, build, alt).
const KEY = 'rigsmith.thumbs.v3'; // v3: toned-down studio grey
const BUDGET = 3_000_000; // characters of data URLs kept in sessionStorage
const memory = new Map();
let store = null;
let thumbs = null; // Promise of createBuildThumbs()
let queue = Promise.resolve();

// Same probe as renderer.js, without loading three.js. `?webgl=0` forces "no 3D" for testing.
let webgl2 = null;
function isWebGL2Available() {
  if (webgl2 === null) {
    try {
      webgl2 = new URLSearchParams(location.search).get('webgl') !== '0' && !!(window.WebGL2RenderingContext && document.createElement('canvas').getContext('webgl2'));
    } catch {
      webgl2 = false;
    }
  }
  return webgl2;
}

function session() {
  try { return globalThis.sessionStorage ?? null; } catch { return null; }
}
function readStore() {
  if (store) return store;
  try { store = JSON.parse(session()?.getItem(KEY) ?? '{}') ?? {}; } catch { store = {}; }
  return store;
}
function writeStore(code, url) {
  const s = readStore();
  s[code] = { url, t: Date.now() };
  // Oldest out until it fits the budget.
  const entries = Object.entries(s).sort((a, b) => b[1].t - a[1].t);
  let size = 0;
  for (const [k, v] of entries) {
    size += v.url.length;
    if (size > BUDGET) delete s[k];
  }
  try { session()?.setItem(KEY, JSON.stringify(s)); } catch { /* full or blocked: memory cache still works */ }
}

export const cachedThumb = (code) => memory.get(code) ?? readStore()[code]?.url ?? null;

/** Data URL of a render of `build` (code = its share code), or null when 3D isn't available. */
export function thumbFor(build, code) {
  const hit = cachedThumb(code);
  if (hit) return Promise.resolve(hit);
  if (!code || !isWebGL2Available()) return Promise.resolve(null);
  const job = queue.then(async () => {
    const again = cachedThumb(code);
    if (again) return again;
    thumbs ??= import('../scene/build-thumbs.js?v=00a22f4faf').then((m) => m.createBuildThumbs());
    const url = await (await thumbs).render(build);
    memory.set(code, url);
    writeStore(code, url);
    // Let the page breathe between renders.
    await new Promise((r) => setTimeout(r, 0));
    return url;
  });
  queue = job.catch(() => null);
  return job;
}

/**
 * Fill a .thumb element with the render of `build`. `alt` describes the build in words.
 * Safe to call again with a new build: a late result for an old code is ignored.
 */
export async function fillThumb(el, build, code, alt) {
  el.dataset.thumbCode = code;
  const empty = !code || code === '1';
  if (empty) {
    el.dataset.state = 'empty';
    el.innerHTML = '<p class="thumb__msg mono">No parts yet</p>';
    return;
  }
  const hit = cachedThumb(code);
  if (!hit) {
    el.dataset.state = 'loading';
    el.innerHTML = '<p class="thumb__msg mono">Rendering 3D</p>';
  }
  let url = hit;
  try {
    url ??= await thumbFor(build, code);
  } catch (err) {
    console.warn('Rigsmith: thumbnail render failed.', err);
    url = null;
  }
  if (el.dataset.thumbCode !== code) return;
  if (!url) {
    el.dataset.state = 'none';
    el.innerHTML = '<p class="thumb__msg mono">3D preview not available on this device</p>';
    return;
  }
  const img = new Image();
  img.decoding = 'async';
  img.alt = alt;
  img.src = url;
  el.replaceChildren(img);
  el.dataset.state = 'ready';
}

/** A sentence for the alt text: case and the parts you'd see through the glass. */
export function thumbAlt(build, name) {
  const bits = [build.case?.name && `a ${build.case.name}`, build.gpu?.name, build.cooler?.name].filter(Boolean);
  return `3D render of ${name}${bits.length ? `: ${bits.join(', ')}` : ''}.`;
}
