// Reference price history from data/price-history.json (written by the admin dashboard when
// parts are published). Only parts whose price has changed are listed; others get [].
let history = null;

export function loadPriceHistory() {
  history ??= fetch('data/price-history.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : { parts: {} }))
    .then((j) => j.parts || {})
    .catch(() => ({}));
  return history;
}

/** [[day, price], ...] oldest first, or [] when the price has never changed. */
export async function priceHistory(id) {
  return (await loadPriceHistory())[id] ?? [];
}
