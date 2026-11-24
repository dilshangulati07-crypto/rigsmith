// POST /api/gallery/<id>/like: one like per visitor per build (see fingerprint() in _lib).
import { json, fail, sameOrigin, BOTS, fingerprint } from '../../../_lib/server.js';

export async function onRequestPost({ request, env, params }) {
  if (!sameOrigin(request)) return fail(403, 'Likes must come from this site.');
  if (!env.DB) return fail(503, 'The gallery is not available on this copy of the site.');
  if (BOTS.test(request.headers.get('User-Agent') || '')) return fail(403, 'Automated likes are not counted.');
  const id = String(params.id || '');
  const post = await env.DB.prepare("SELECT likes FROM rig_gallery WHERE id = ? AND status = 'live'").bind(id).first();
  if (!post) return fail(404, 'That build is not in the gallery.');

  const voter = await fingerprint(request, env, `like:${id}`);
  const added = await env.DB.prepare("INSERT OR IGNORE INTO rig_gallery_likes (gallery_id, voter, created_at) VALUES (?, ?, datetime('now'))")
    .bind(id, voter)
    .run();
  if (added.meta.changes) {
    await env.DB.prepare('UPDATE rig_gallery SET likes = (SELECT COUNT(*) FROM rig_gallery_likes WHERE gallery_id = ?) WHERE id = ?').bind(id, id).run();
  }
  const { likes } = await env.DB.prepare('SELECT likes FROM rig_gallery WHERE id = ?').bind(id).first();
  return json({ ok: true, likes, liked: true, already: !added.meta.changes });
}
