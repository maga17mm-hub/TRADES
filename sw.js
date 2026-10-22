const CACHE_NAME = 'tradelog-v41';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/style.css',
  './css/style.css?v=41',
  './css/books.css',
  './css/books.css?v=41',
  './js/db.js',
  './js/db.js?v=41',
  './js/auth.js',
  './js/backend.js',
  './js/backend.js?v=41',
  './js/auth.js?v=41',
  './js/app.js',
  './js/app.js?v=41',
  './js/trade-parser.js',
  './js/trade-parser.js?v=41',
  './js/ai.js',
  './js/voice-recorder.js',
  './js/voice-recorder.js?v=41',
  './js/piper-engine.js?v=41',
  './js/piper-worker.js?v=41',
  './js/ai.js?v=41',
  './js/notes.js',
  './js/notes.js?v=41',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon.svg',
  './icons/favicon.png'
];

self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'CLEAR_CACHE') {
    caches.keys().then((keys) => {
      return Promise.all(keys.map(k => caches.delete(k)));
    }).then(() => {
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage({ cleared: true });
      }
    });
  }
});

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Force fetching fresh assets from server bypassing HTTP disk cache
      await Promise.all(
        ASSETS_TO_CACHE.map(async (url) => {
          try {
            const req = new Request(url, { cache: 'reload' });
            const res = await fetch(req);
            if (res && res.status === 200) {
              await cache.put(url, res);
            }
          } catch (err) {
            console.warn('Precache failed for asset:', url, err);
          }
        })
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || /\/api\//.test(url.pathname)) return;
  // Large voice files have their own verified IndexedDB cache in the voice worker.
  if (/\/js\/vendor\/piper\/.*(?:\.gz|\.part\d+)$/.test(url.pathname)) return;
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  // Handle HTML navigation (entering or reloading the app)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' })
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put('./index.html', copy.clone());
              cache.put('./', copy);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match('./index.html', { ignoreSearch: true });
        })
    );
    return;
  }

  // Handle assets (CSS, JS, images): Network-First with cache fallback
  event.respondWith(
    fetch(event.request, { cache: 'no-cache' })
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request, { ignoreSearch: true })
          .then((cachedResponse) => {
            if (cachedResponse) return cachedResponse;
            if (event.request.destination === 'document') {
              return caches.match('./index.html', { ignoreSearch: true });
            }
          });
      })
  );
});
