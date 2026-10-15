/* Elevate Internships service worker.
 *
 * Kept deliberately small. It exists so the site installs as an app and so a
 * dropped connection shows a friendly page instead of the browser's error.
 *
 * - Pages always come from the network, so the app is never stale. Only when
 *   the network fails does it fall back to /offline.html.
 * - Built assets (/assets/*) have content hashes in their names, so a cached
 *   copy is always correct; they are served cache-first.
 * - Icons and images: cached copy first, refreshed in the background.
 * - /api/* and anything cross-origin is never touched: listings, accounts and
 *   the tracker always talk to the server directly.
 * - Notifications: shows the reminders and alerts the server pushes, and opens
 *   the right page when one is clicked.
 *
 * Bump VERSION to drop every old cache on the next visit.
 */
const VERSION = 'v2';
const CACHE = `cl-${VERSION}`;
const OFFLINE_URL = '/offline.html';
const PRECACHE = [OFFLINE_URL, '/favicon.svg', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('cl-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function fromNetworkOrOffline(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(CACHE);
    return (await cache.match(OFFLINE_URL)) || Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(event.request);
  const refresh = fetch(event.request)
    .then((res) => {
      if (res.ok) cache.put(event.request, res.clone());
      return res;
    })
    .catch(() => hit);
  if (hit) {
    event.waitUntil(refresh);
    return hit;
  }
  return refresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fromNetworkOrOffline(request));
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request));
  } else if (/\.(png|svg|ico|webp|jpg|woff2?)$/i.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event));
  }
});

// ---- Notifications ----------------------------------------------------------

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  // Only ever open a page on this site, whatever the message says.
  const url = typeof data.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//') ? data.url : '/';
  event.waitUntil(
    self.registration.showNotification(String(data.title || 'Elevate Internships').slice(0, 120), {
      body: String(data.body || '').slice(0, 300),
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: typeof data.tag === 'string' ? data.tag : undefined,
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      // Reuse an open tab of the site if there is one.
      const open = wins.find((w) => new URL(w.url).origin === self.location.origin);
      // navigate() fails on a tab this worker does not control; open a new one then.
      if (open) {
        return open
          .focus()
          .then(() => open.navigate(target))
          .catch(() => self.clients.openWindow(target));
      }
      return self.clients.openWindow(target);
    }),
  );
});
