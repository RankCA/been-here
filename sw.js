// Offline support. Bump VERSION whenever app files change.
const VERSION = 'been-here-v1';
const TILES = 'been-here-tiles';
const MAX_TILES = 4000;
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/lib/leaflet.css',
  'js/lib/leaflet.js',
  'js/data/countries.js',
  'js/data/cities.js',
  'js/util.js',
  'js/geo.js',
  'js/store.js',
  'js/fog.js',
  'js/countries.js',
  'js/cities.js',
  'js/areas.js',
  'js/tracker.js',
  'js/importers.js',
  'js/share.js',
  'js/app.js',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== TILES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

let trimming = false;
async function trimTiles() {
  if (trimming) return;
  trimming = true;
  try {
    const c = await caches.open(TILES);
    const keys = await c.keys();
    for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
  } finally {
    trimming = false;
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Map tiles: use the network, keep a copy for offline use.
  if (url.hostname === 'server.arcgisonline.com') {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(TILES).then((c) => c.put(req, copy)).then(() => { if (Math.random() < 0.05) trimTiles(); });
        }
        return res;
      }).catch(() => caches.open(TILES).then((c) => c.match(req)).then((hit) => hit || Response.error()))
    );
    return;
  }

  // App files: cache first.
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }))
    );
  }
});
