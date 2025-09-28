const CACHE = 'eblusha-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/js/main.js',
  '/css/styles-desktop.css',
  '/css/styles-mobile-p.css',
  '/css/styles-mobile-l.css',
  '/manifest.webmanifest'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
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
  e.respondWith(
    fetch(request).catch(() => caches.match(request).then((r) => r || caches.match('/')))
  );
});


