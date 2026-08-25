// This file lives at the project ROOT on purpose, even though everything
// else got organized into folders. A service worker's default scope is
// "everything at or below the folder it's served from" — if this were
// moved into /js/, it could only ever control /js/, not the whole app.
// Root is the right place for it.

const CACHE_NAME = 'kitchen-chemistry-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './css/styles.css',
  './data/techniques.json',
  './data/recipes.json',
  './js/storage.js',
  './js/app.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
