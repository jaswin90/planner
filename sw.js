// Offline support: caches only this site's own files (the app shell).
// Never caches Google API traffic or any user data.
const VERSION = 'planner-v1';
const SHELL = [
  './', 'index.html', 'css/app.css', 'icon.svg', 'manifest.webmanifest',
  'js/app.js', 'js/config.js', 'js/crypto.js', 'js/editor.js', 'js/google.js', 'js/idb.js',
  'js/model.js', 'js/notes.js', 'js/planner.js', 'js/prefs.js', 'js/sanitize.js', 'js/settings.js',
  'js/ui.js', 'js/vault.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first (so updates arrive immediately), cache as offline fallback.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});
