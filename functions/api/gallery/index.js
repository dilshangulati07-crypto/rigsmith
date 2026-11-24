// /api/gallery: the community gallery.
//   GET  ?sort=top|new  builds you've approved in the admin dashboard (newest or most liked)
//   POST { code, name, author, note }  a visitor posts their build; it waits for approval
// Posts live in the rig_gallery table of the D1 database "dilshan-sites".
import { decodeBuild } from '../../../js/share.js';
import { CATEGORIES } from '../../../js/categories.js';
import { json, fail, clean, sameOrigin, BOTS, loadCatalog, fingerprint } from '../../_lib/server.js';

const PER_DAY = 3; // posts from one visitor per 24 hours
const NEEDED = ['cpu', 'motherboard', 'ram', 'storage', 'psu', 'case'];

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ ok: true, posts: [] });
  const sort = new URL(request.url).searchParams.get('sort') === 'new' ? 'new' : 'top';
  const order = sort === 'new' ? 'created_at DESC' : 'featured DESC, likes DESC, created_at DESC';
  const { results } = await env.DB.prepare(
    `SELECT id, created_at, featured, code, name, author, note, likes FROM rig_gallery WHERE status = 'live' ORDER BY ${order} LIMIT 60`,
  ).all();
  return json({ ok: true, sort, posts: results.map((r) => ({ ...r, featured: !!r.featured })) }, 200, {
    'Cache-Control': 'public, max-age=30',
  });
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return fail(403, 'Posts must come from this site.');
  if (!env.DB) return fail(503, 'The gallery is not available on this copy of the site.');
  if (BOTS.test(request.headers.get('User-Agent') || '')) return fail(403, 'Automated posts are not accepted.');

  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, 'Send the post as JSON.');
  }
  if (body.website) return json({ ok: true, status: 'pending' }); // the hidden honeypot field: a bot filled it in

  const name = clean(body.name, 60);
  const author = clean(body.author, 40);
  const note = clean(body.note, 280);
  const code = clean(body.code, 400);
  if (name.length < 3) return fail(400, 'Give your build a name (at least 3 characters).');

  const catalog = await loadCatalog(request, env);
  const decoded = decodeBuild(code, catalog);
  if (!decoded.ok) return fail(400, decoded.error);
  if (decoded.missing.length) return fail(400, 'Some parts in this build are no longer in the catalogue. Pick them again and post it once more.');
  const lacking = CATEGORIES.filter((c) => NEEDED.includes(c.id) && (c.multiple ? !decoded.ids[c.id].length : !decoded.ids[c.id]));
  if (lacking.length) return fail(400, `Finish the build first: it needs ${lacking.map((c) => c.label.toLowerCase()).join(', ')}.`);

  const poster = await fingerprint(request, env, 'post');
  const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM rig_gallery WHERE poster = ? AND created_at > datetime('now', '-1 day')")
    .bind(poster)
    .first();
  if (n >= PER_DAY) return fail(429, `That's ${PER_DAY} posts today. Try again tomorrow.`);

  const parts = CATEGORIES.flatMap((c) => {
    const v = decoded.ids[c.id];
    return (Array.isArray(v) ? v : v ? [v] : []).map((id) => ({ category: c.id, id, name: catalog.get(id).name, price: catalog.get(id).refPriceTHB ?? 0 }));
  });
  const total = parts.reduce((s, p) => s + p.price, 0);
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  await env.DB.prepare(
    `INSERT INTO rig_gallery (id, created_at, status, featured, code, name, author, note, total_thb, parts, likes, poster)
     VALUES (?, datetime('now'), 'pending', 0, ?, ?, ?, ?, ?, ?, 0, ?)`,
  )
    .bind(id, code, name, author, note, total, JSON.stringify(parts.map(({ price, ...p }) => p)), poster)
    .run();
  return json({ ok: true, id, status: 'pending' }, 201);
}
