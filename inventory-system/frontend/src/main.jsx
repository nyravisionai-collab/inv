import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

/**
 * Clear all service worker caches, then reload the page. Exposed on window so
 * the ErrorBoundary fallback can invoke it when the user clicks "Reload App".
 *
 * Historically this was the only recovery from the
 * "Cannot read properties of null (reading 'useContext')" crash: the old
 * service worker cached Vite DEV-SERVER modules (`/src/*.jsx`,
 * `/node_modules/.vite/deps/*`, ...) cache-first, and because those URLs carry
 * no content hash it served a stale mix of modules after any code change,
 * leaving React's hooks dispatcher null. sw.js now keeps those resources
 * network-only, so the crash can no longer occur — this function remains as a
 * manual "nuke and reload" escape hatch.
 */
window.__clearCachesAndReload = async function () {
  // Tell the active service worker to delete all caches.
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHES' });
  } else {
    // No active SW – delete caches directly.
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch { /* ignore */ }
  }
  // Also unregister any service worker so the next load starts fresh.
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.unregister();
  } catch { /* ignore */ }
  // Finally hard-reload without cache.
  window.location.reload();
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Register the service worker for the installable app shell. It never
// caches /api or /uploads responses (see public/sw.js) — only the static
// shell — so there is nothing here that can leak business data offline.
//
// Note: browsers only expose navigator.serviceWorker in a "secure context"
// (https://, or http://localhost). Opening the app at a plain LAN IP over
// HTTP will not register a service worker and will not offer an install
// prompt — that is a browser security requirement, not a bug in this code.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // When a new service worker takes control (new app version deployed),
      // reload once so the user is never stuck on stale JS/CSS shell files.
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded) return;
        reloaded = true;
        window.location.reload();
      });
      reg.update().catch(() => {});
    }).catch(() => {});
  });
}
