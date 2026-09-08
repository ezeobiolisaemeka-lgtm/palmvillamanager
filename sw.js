const CACHE_NAME = 'palmvilla-cache-v3';
const FILES_TO_CACHE = [
  './',
  './index.html',
  './orders.html',
  './script.js',
  './style.css',
  './manifest.json',
  './logo-192.svg',
  './logo-512.svg'
];

self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(FILES_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (evt) => {
  if (evt.request.method !== 'GET') return;
  evt.respondWith(
    caches.match(evt.request).then((response) => {
      return response || fetch(evt.request).then((res) => {
        return caches.open(CACHE_NAME).then((cache) => {
          try {
            cache.put(evt.request, res.clone());
          } catch (e) {
            // ignore put errors for opaque responses
          }
          return res;
        });
      }).catch(() => caches.match('./orders.html'));
    })
  );
});
