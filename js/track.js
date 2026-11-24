// Anonymous counts of what people do here (which parts get picked, presets, Auto-build…),
// sent to /api/track (functions/api/track.js) for the Insights page of the private admin
// dashboard. No cookies and nothing that identifies a person. Browsers that ask not to be
// tracked (Do Not Track or Global Privacy Control) send nothing, and neither does a local copy.
const off =
  navigator.globalPrivacyControl === true ||
  navigator.doNotTrack === '1' ||
  /^(localhost|127\.|\[::1\])/.test(location.hostname) ||
  location.protocol === 'file:';

const once = new Set();

export function track(type, target = '', { oncePerPage = false } = {}) {
  if (off) return;
  const key = `${type}:${target}`;
  if (oncePerPage && once.has(key)) return;
  once.add(key);
  const body = JSON.stringify({ events: [{ type, target: String(target) }] });
  try {
    if (navigator.sendBeacon && navigator.sendBeacon('/api/track', body)) return;
    fetch('/api/track', { method: 'POST', body, keepalive: true }).catch(() => {});
  } catch {
    // Counting must never get in the way of the site.
  }
}
