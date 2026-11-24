// Helpers shared by the Pages Functions in functions/api/ (this folder has no routes).
import { createCatalog } from '../../js/catalog.js';
import { CATEGORY_IDS } from '../../js/categories.js';

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });

export const fail = (status, message) => json({ ok: false, message }, status);

// "2026-11-24" in Bangkok time (UTC+7)
export const bangkokDay = (date = new Date()) => new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 10);

// Requests from other sites are refused (browsers always send Origin on a POST).
export function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  return !origin || origin === new URL(request.url).origin;
}

export const BOTS = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|curl|wget|python/i;

// Plain one-line text: no control characters, trimmed, at most `max` characters.
export const clean = (v, max) =>
  String(v ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

// The parts catalogue, read from this deployment's own data/parts/*.json.
export async function loadCatalog(request, env) {
  const parts = {};
  await Promise.all(
    CATEGORY_IDS.map(async (cat) => {
      const url = new URL(`/data/parts/${cat}.json`, request.url);
      const res = env.ASSETS ? await env.ASSETS.fetch(url) : await fetch(url);
      if (!res.ok) throw new Error(`Could not read ${cat}.json (${res.status})`);
      parts[cat] = (await res.json()).parts;
    }),
  );
  return createCatalog(parts);
}

// A one-way fingerprint of the visitor's network address, used only to stop one person
// posting many builds or liking the same build twice. The salt is random, kept in the
// database and never leaves it, so the fingerprint can't be turned back into the address.
export async function fingerprint(request, env, purpose) {
  await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('rigsmith_salt', ?)")
    .bind(crypto.randomUUID() + crypto.randomUUID())
    .run();
  const { value: salt } = await env.DB.prepare("SELECT value FROM settings WHERE key = 'rigsmith_salt'").first();
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${purpose}|${ip}|${salt}`));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
