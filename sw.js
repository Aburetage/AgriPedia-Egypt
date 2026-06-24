const CACHE_NAME = 'agripedia-v22';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/style.css?v=20',
  './js/app.js?v=20',
  './manifest.json',
  './data/ar/index.json',
  './data/ar/glossary.json',
  './data/ar/search-index.json',
  './data/ar/tuta.json',
  './data/en/index.json',
  './data/en/glossary.json',
  './data/en/search-index.json',
  './data/en/tuta.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  const fetchAndCache = () => fetch(event.request).then((response) => {
    if (response.ok) {
      const responseCopy = response.clone();
      event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseCopy)));
    }
    return response;
  });

  if (event.request.mode === 'navigate') {
    event.respondWith(fetchAndCache().catch(() => caches.match('./index.html')));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const networkResponse = fetchAndCache();
      if (cachedResponse) {
        event.waitUntil(networkResponse.catch(() => undefined));
        return cachedResponse;
      }
      return networkResponse;
    })
  );
});
