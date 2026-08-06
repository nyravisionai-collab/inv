/**
 * Service worker for the installable app shell + offline fallback.
 *
 * --------------------------------------------------------------------------
 * WHY THIS IS NETWORK-ONLY FOR DEV-SERVER FILES (the important part)
 * --------------------------------------------------------------------------
 * This app is normally served by the Vite *dev* server (see START.sh), which
 * serves source modules from URLs that NEVER change when the code changes —
 * e.g. `/src/App.jsx`, `/@vite/client`, `/node_modules/.vite/deps/react.js`.
 * Unlike a `vite build` (which emits content-hashed files under /assets/),
 * those URLs carry no version, so a cache-first strategy would freeze the app
 * onto a stale MIX of old and new modules after any edit. When an old module
 * and a freshly re-bundled React dependency land in the same page, React's
 * internal hooks dispatcher ends up null and the app dies with:
 *
 *     Cannot read properties of null (reading 'useContext')
 *
 * That is exactly the crash the ErrorBoundary used to catch. The fix is to let
 * every Vite dev-server resource go straight to the network and NEVER read it
 * from, or write it to, this cache. Only genuinely immutable, content-hashed
 * production assets (and the stable icon/manifest set) are cached.
 *
 * API responses are also deliberately NOT cached. In a POS the stock counts
 * and prices must be authoritative — serving a stale cached /api/products
 * could cause a sale at an old price or against stock that no longer exists.
 * Nothing under /api/ or /uploads/ (where all business data lives) is cached.
 *
 * Bump CACHE whenever this file changes: every previously-installed client
 * fully purges its caches on the next `activate` (see below) instead of
 * serving stale shell files forever.
 */
const CACHE = 'inv-mgmt-v5';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-192-maskable.png',
  '/icon-512-maskable.png',
];

/** Vite dev-server resources — versionless URLs, must never be cached. */
function isDevServerAsset(pathname) {
  return (
    pathname.startsWith('/@vite/') ||
    pathname.startsWith('/@react-refresh') ||
    pathname.startsWith('/src/') ||
    pathname.startsWith('/node_modules/')
  );
}

/**
 * Content-hashed bundles emitted by `vite build` under /assets/. Because the
 * URL itself changes whenever the content does, these are immutable and safe
 * to serve cache-first. (Harmless under the dev server, which has no /assets/.)
 */
function isHashedBuildAsset(pathname) {
  return pathname.startsWith('/assets/');
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE_URLS).catch(() => undefined))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  // FULL purge: delete every cache (old versions AND any poisoned dev-server
  // entries from v4 and earlier) so an upgrade cannot leave a stale module
  // mix behind. The cache is rebuilt lazily from safe assets on subsequent
  // requests.
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

/** Clear every cache belonging to this origin. */
async function clearAllCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.map((k) => caches.delete(k)));
}

/** Handle messages sent from the client page. */
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'CLEAR_CACHES') {
    e.waitUntil(
      clearAllCaches().then(() => {
        // Notify all clients that caches were cleared so the page can reload.
        self.clients.matchAll().then((clients) => {
          clients.forEach((client) => client.postMessage({ type: 'CACHES_CLEARED' }));
        });
      })
    );
  }
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never serve API or upload responses from cache — always hit the network.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/') || url.pathname.startsWith('/lite/')) {
    return;
  }

  // Dev-server resources: network-only, never cached. This is what prevents
  // the stale-module-mix crash. (Falling back to a possibly-inconsistent
  // cached set when offline would just re-introduce the crash, so we don't.)
  if (isDevServerAsset(url.pathname)) {
    e.respondWith(fetch(request).catch(() => Response.error()));
    return;
  }

  // Navigation requests: network first so new deploys take effect
  // immediately, falling back to the cached shell so the app still opens
  // when the backend/server is momentarily unreachable.
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then((res) => {
          // Keep the offline shell current without ever caching API data.
          if (res && res.ok && res.type === 'basic') {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(request, clone)).catch(() => undefined);
          }
          return res;
        })
        .catch(() =>
          caches.match(request).then((r) => r || caches.match('/index.html').then((s) => s || Response.error()))
        )
    );
    return;
  }

  // Immutable, content-hashed production bundles: cache-first.
  if (isHashedBuildAsset(url.pathname)) {
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
    return;
  }

  // Stable static files (icons, manifest, etc.): stale-while-revalidate —
  // respond instantly from cache if present, then refresh in the background.
  e.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(request).then((cached) => {
        const network = fetch(request)
          .then((res) => {
            if (res && res.ok && res.type === 'basic') {
              cache.put(request, res.clone()).catch(() => undefined);
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    )
  );
});
