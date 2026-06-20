// ===== Service worker — cache de l'app pour l'usage hors-ligne =====
const CACHE = 'mon-quotidien-v3';
const ASSETS = [
  '.',
  'index.html',
  'styles.css',
  'renderer.js',
  'config.js',
  'vendor/supabase.js',
  'storage-web.js',
  'auth.js',
  'pwa.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Stratégie "réseau d'abord" : on prend la dernière version en ligne (les mises à
// jour arrivent tout de suite), et on retombe sur le cache si hors-ligne. Les appels
// cloud (Supabase, autres origines / non-GET) passent directement par le réseau.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});
