#!/usr/bin/env node
// Development server: serves the repo with `Cache-Control: no-store`, so the browser fetches
// every file again on each reload and an edited module is never hidden by the cache.
// (`python -m http.server` sends no cache header, so browsers keep ES modules for a while and
// show old code after an edit.) No npm packages; Node 18+.
// Usage: node tools/serve.mjs [port]   (default 8000) -> http://localhost:8000
// Also used by tools/browser-harness.mjs for the tests (serveDir on a free port).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, dirname, extname, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.hdr': 'application/octet-stream',
};

/**
 * Serve `root` on `port` (0 = any free port) with caching off. Resolves to the server and its
 * base URL.
 */
export async function serveDir(root, port = 0, host = '127.0.0.1') {
  const base = resolve(root);
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[\\/]+/, '');
    let file = join(base, path);
    if (!file.startsWith(base + sep) && file !== base) { res.writeHead(403).end(); return; }
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain', 'cache-control': 'no-store' }).end('Not found');
    }
  });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(port, host, ok); });
  return { server, url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${server.address().port}` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2]) || 8000;
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const { url } = await serveDir(root, port, 'localhost').catch((err) => {
    console.error(err.code === 'EADDRINUSE' ? `Port ${port} is in use: try node tools/serve.mjs ${port + 1}` : err.message);
    process.exit(1);
  });
  console.log(`Rigsmith dev server (no caching) at ${url}\nCtrl+C to stop.`);
}
