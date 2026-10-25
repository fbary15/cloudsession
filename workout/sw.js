// Service worker for the Workout Log. It makes the app installable from the
// browser and keeps it working with no connection.
//
// Everything the app needs is saved in a cache when the worker installs.
// Requests are answered from that cache first, so the app opens instantly and
// offline, and each file is fetched again in the background so the next visit
// has the latest version. When a background fetch brings back a changed file,
// the open pages are told so they can offer a reload.
//
// Workouts themselves live in localStorage, not here, so clearing this cache
// never loses any data.

const CACHE = 'workout-log-v1';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './logic.js',
  './chart.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Ask the server rather than the browser's HTTP cache, so an update gets
    // the files that actually changed.
    await cache.addAll(SHELL.map((path) => new Request(path, { cache: 'no-cache' })));
    // An existing worker means this is an update, so the open pages are stale.
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
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    event.respondWith(respond(event, true));
  } else if (FONT_HOSTS.has(url.hostname)) {
    event.respondWith(respond(event, false));
  }
});

/** Cached copy first, refreshed in the background; network when there is none. */
async function respond(event, ownFile) {
  const { request } = event;
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const refresh = refreshCache(cache, request, cached?.clone(), ownFile);
  if (cached) {
    event.waitUntil(refresh);
    return ownFile && request.mode !== 'navigate' ? uncacheable(cached) : cached;
  }
  return (await refresh) ?? fallback(cache, request);
}

/**
 * A copy of a cached file marked so the browser never reuses it from its own
 * memory. Chromium otherwise keeps a reloaded page's scripts and styles from
 * the previous visit while their headers say they are fresh, skipping this
 * worker, so a reload after an update could still show the old version.
 */
function uncacheable(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** Fetches the latest copy and stores it. Null when the network is down. */
async function refreshCache(cache, request, cached, ownFile) {
  let response;
  try {
    // Our own files are checked against the server (a cheap 304 when nothing
    // changed). Fonts keep their original cross-origin request so the reply
    // stays readable and cacheable.
    response = ownFile ? await fetch(request.url, { cache: 'no-cache' }) : await fetch(request);
  } catch {
    return null;
  }
  if (!response.ok) return response;
  await cache.put(request, response.clone());
  if (ownFile && cached && await differs(cached, response.clone())) await announceUpdate();
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
