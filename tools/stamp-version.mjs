#!/usr/bin/env node
// Cache-busting: puts the same `?v=<hash>` on every CSS link, every script tag and every
// relative JS import, so browsers load the latest files after a deploy instead of a cached
// mix of old and new. The hash is a short hash of the CSS and JS contents (stamps stripped),
// so it only changes when the code changes. Every import of a module gets the same URL, which
// matters: an ES module imported under two URLs would run twice.
// The pinned three.js files in vendor/ are left alone (they never change for a given version).
// Run before every commit that changes CSS or JS:  node tools/stamp-version.mjs [--check]
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHECK = process.argv.includes('--check');

async function walk(dir, ext) {
  const out = [];
  for (const e of await readdir(join(ROOT, dir), { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p, ext));
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}

const STAMP = /\?v=[0-9a-z]+/g;
// HTML: href="css/x.css" / src="js/x.js" (also with a leading slash, as on 404.html).
const HTML_REF = /((?:href|src)=")(\/?(?:css|js)\/[^"?]+\.(?:css|js))(?:\?v=[0-9a-z]+)?(")/g;
// JS: from './x.js', import './x.js', import('./x.js'): relative specifiers only.
const JS_REF = /((?:\bfrom|\bimport)\s*\(?\s*)(['"])(\.{1,2}\/[^'"?]+\.js)(?:\?v=[0-9a-z]+)?\2/g;

const html = (await readdir(ROOT)).filter((f) => f.endsWith('.html'));
const js = await walk('js', '.js');
const css = await walk('css', '.css');

const hash = createHash('sha256');
for (const f of [...css, ...js].sort()) hash.update(f).update((await readFile(join(ROOT, f), 'utf8')).replace(STAMP, ''));
const v = hash.digest('hex').slice(0, 10);

let stale = 0;
for (const f of [...html, ...js]) {
  const path = join(ROOT, f);
  const src = await readFile(path, 'utf8');
  const next = f.endsWith('.html')
    ? src.replace(HTML_REF, (_, a, url, b) => `${a}${url}?v=${v}${b}`)
    : src.replace(JS_REF, (_, a, q, url) => `${a}${q}${url}?v=${v}${q}`);
  if (next === src) continue;
  stale++;
  if (CHECK) console.log(`  stale: ${relative(ROOT, path)}`);
  else await writeFile(path, next);
}
if (CHECK) {
  console.log(stale ? `FAILED: ${stale} files need "node tools/stamp-version.mjs" (v=${v})` : `OK: every CSS/JS reference is stamped v=${v}`);
  process.exit(stale ? 1 : 0);
}
console.log(`stamped v=${v} (${stale} files updated)`);
