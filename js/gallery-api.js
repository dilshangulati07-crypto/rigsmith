// The community gallery's API (functions/api/gallery/): list, post and like builds.
const LIKED = 'rigsmith.liked.v1';

async function call(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw new Error('Could not reach the gallery. Check your connection and try again.');
  }
  let body = {};
  try {
    body = await res.json();
  } catch {
    /* not JSON: a static copy of the site without the server part */
  }
  if (!res.ok || body.ok === false) throw new Error(body.message || (res.status === 404 ? 'The gallery is not available on this copy of the site.' : `The gallery answered ${res.status}.`));
  return body;
}

export const listPosts = (sort = 'top') => call(`/api/gallery?sort=${sort === 'new' ? 'new' : 'top'}`).then((b) => b.posts);

export const postBuild = ({ code, name, author, note, website }) =>
  call('/api/gallery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, name, author, note, website }) });

function likedSet() {
  try {
    return new Set(JSON.parse(localStorage.getItem(LIKED) || '[]'));
  } catch {
    return new Set();
  }
}
export const hasLiked = (id) => likedSet().has(id);

export async function likePost(id) {
  const body = await call(`/api/gallery/${encodeURIComponent(id)}/like`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  try {
    const s = likedSet();
    s.add(id);
    localStorage.setItem(LIKED, JSON.stringify([...s].slice(-500)));
  } catch {
    /* private mode: the like still counts, the heart just won't stay filled */
  }
  return body.likes;
}
