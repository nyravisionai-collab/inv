/**
 * Service worker for offline app-shell support.
 *
 * API responses are deliberately NOT cached. In a POS the stock counts and
 * prices must be authoritative — serving a stale cached /api/products could
 * cause a sale at an old price or against stock that no longer exists.
 * Only static build assets are cached.
 */
const CACHE = 'inv-mgmt-v2';
const ASSETS = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS).catch(() => undefined))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never serve API or upload responses from cache — always hit the network.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) {
    return;
  }

  // Navigation requests: network first, fall back to the cached shell so the
  // app still opens when the backend is unreachable.
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request).catch(() => caches.match('/index.html').then((r) => r || Response.error()))
    );
    return;
  }

  // Static assets: cache first (they are content-hashed by Vite).
  e.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((res) => {
          if (res && res.ok && res.type === 'basic') {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(request, clone)).catch(() => undefined);
          }
          return res;
        })
        .catch(() => cached || Response.error());
    })
  );
});
