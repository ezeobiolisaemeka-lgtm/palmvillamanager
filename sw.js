const CACHE_NAME = 'palmvilla-cache-v6';
const APP_BASE_URL = new URL('./', self.registration.scope);
const APP_BASE_PATH = APP_BASE_URL.pathname;
const FILES_TO_CACHE = [
  'index.html',
  'orders.html',
  'login.html',
  'login.js',
  'migration.html',
  'migration.js',
  'debts.html',
  'debts.js',
  'api.js',
  'script.js',
  'style.css',
  'manifest.json',
  'logo-192.svg',
  'logo-512.svg'
].map((file) => new URL(file, APP_BASE_URL).href);

self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(FILES_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key.startsWith('palmvilla-cache-') && key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (evt) => {
  const requestUrl = new URL(evt.request.url);
  if (
    evt.request.method !== 'GET'
    || requestUrl.origin !== self.location.origin
    || !requestUrl.pathname.startsWith(APP_BASE_PATH)
  ) return;
  if (requestUrl.pathname.startsWith(`${APP_BASE_PATH}api/`)) return;
  evt.respondWith(
    (async () => {
      const appCache = await caches.open(CACHE_NAME);
      const cached = await appCache.match(evt.request);

      try {
        const response = await fetch(evt.request);
        if (response.ok && response.type === 'basic') {
          await appCache.put(evt.request, response.clone());
        }
        return response;
      } catch (error) {
        if (cached) return cached;
        if (evt.request.mode === 'navigate') {
          return (await caches.match(new URL('orders.html', APP_BASE_URL).href)) || Response.error();
        }
        return Response.error();
      }
    })()
  );
});
