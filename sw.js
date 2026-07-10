/* Service worker: offline shell + a always-try-network copy of the plan.
   Bump CACHE when the shell changes so old caches are dropped on activate. */
const CACHE = 'training-plan-v1';

const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './master_running_sheet.csv',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/icon.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Only same-origin requests reach here (see the fetch handler), so an ok
// response is always safe to store.
const putIfOk = (req, res) => {
  if (res && res.ok) {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(req, copy));
  }
  return res;
};

// respondWith(undefined) is a TypeError, so every path must end in a Response.
const offline = () => new Response('', { status: 504, statusText: 'Offline' });

// Network first, falling back to whatever we last stored. Used for the page
// itself and for the CSV, so a fresh plan always wins when there's signal.
const networkFirst = req =>
  fetch(req).then(res => putIfOk(req, res)).catch(() =>
    caches.match(req)
      .then(hit => hit || caches.match('./index.html'))
      .then(hit => hit || offline()));

// Cache first, then refresh in the background. Used for the static shell.
const staleWhileRevalidate = req =>
  caches.match(req).then(hit => {
    const net = fetch(req).then(res => putIfOk(req, res)).catch(() => null);
    return hit || net.then(res => res || offline());
  });

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate' || url.pathname.endsWith('.csv')) {
    e.respondWith(networkFirst(request));
    return;
  }
  e.respondWith(staleWhileRevalidate(request));
});
