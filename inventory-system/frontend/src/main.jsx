import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

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
