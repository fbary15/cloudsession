// Service worker for Merre jártam. It makes the app installable and keeps it
// working with no connection: the app, MapLibre and the map data are cached
// when the worker installs. Requests are answered from the cache first and
// refreshed in the background; when a refreshed file has changed, the open
// pages are told so they can offer a reload.
//
// Marked places live in localStorage, not here, so clearing this cache never
// loses any of them. The online place search (Photon) is never cached.

const CACHE = 'travel-map-v2';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './logic.js',
  './aliases.js',
  './sync.js',
  './firebase-config.js',
  './vendor/firebase.js',
  './manifest.webmanifest',
  './vendor/maplibre-gl.js',
  './vendor/maplibre-gl.css',
  './data/countries.json',
  './data/regions.json',
  './data/cities.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Ask the server rather than the browser's HTTP cache, so an update gets
    // the files that actually changed.
    await cache.addAll(SHELL.map((path) => new Request(path, { cache: 'no-cache' })));
    if (self.registration.active) await announceUpdate();
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(respond(event));
});

/** Cached copy first, refreshed in the background; network when there is none. */
async function respond(event) {
  const { request } = event;
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  const refresh = refreshCache(cache, request, cached?.clone());
  if (cached) {
    event.waitUntil(refresh);
    return request.mode !== 'navigate' ? uncacheable(cached) : cached;
  }
  return (await refresh) ?? fallback(cache, request);
}

/**
 * A copy of a cached file marked so the browser never reuses it from its own
 * memory cache, which would otherwise skip this worker after an update.
 */
function uncacheable(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** Fetches the latest copy and stores it. Null when the network is down. */
async function refreshCache(cache, request, cached) {
  let response;
  try {
    response = await fetch(request.url, { cache: 'no-cache' });
  } catch {
    return null;
  }
  if (!response.ok) return response;
  await cache.put(request, response.clone());
  if (cached && await differs(cached, response.clone())) await announceUpdate();
  return response;
}

async function differs(a, b) {
  const [x, y] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
  if (x.byteLength !== y.byteLength) return true;
  const u = new Uint8Array(x);
  const v = new Uint8Array(y);
  for (let i = 0; i < u.length; i += 1) if (u[i] !== v[i]) return true;
  return false;
}

async function announceUpdate() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) client.postMessage({ type: 'updated' });
}

/** Offline with nothing cached: show the app for a page, fail quietly otherwise. */
async function fallback(cache, request) {
  if (request.mode === 'navigate') {
    const shell = await cache.match('./');
    if (shell) return shell;
  }
  return new Response('Offline', { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/plain' } });
}
