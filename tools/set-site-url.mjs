#!/usr/bin/env node
// Sets the live site address everywhere it appears: canonical links and Open Graph / Twitter
// tags in the HTML pages, robots.txt, sitemap.xml and the README's live demo link.
// Usage: node tools/set-site-url.mjs https://your-site.netlify.app
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const next = (process.argv[2] ?? '').replace(/\/+$/, '');
if (!/^https:\/\/[a-z0-9.-]+$/i.test(next)) {
  console.log('Usage: node tools/set-site-url.mjs https://your-site.netlify.app');
  process.exit(1);
}

// The current address is the one in sitemap.xml.
const current = (await readFile(join(ROOT, 'sitemap.xml'), 'utf8')).match(/<loc>(https:\/\/[^/<]+)/)[1];
const files = [...(await readdir(ROOT)).filter((f) => f.endsWith('.html')), 'robots.txt', 'sitemap.xml', 'README.md'];
let changed = 0;
for (const f of files) {
  const s = await readFile(join(ROOT, f), 'utf8');
  let t = s.split(current).join(next);
  if (f === 'README.md') t = t.replace(' (placeholder until the first Netlify deploy)', '');
  if (t !== s) { await writeFile(join(ROOT, f), t); changed++; console.log(`  ${f}`); }
}
console.log(`${current} -> ${next} in ${changed} files.`);
