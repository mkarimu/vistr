// Caches the app shell so the installed app opens instantly. API calls always go to the network.
const CACHE = 'vistr-v20';
const SHELL = ['./', 'index.html', 'styles.css', 'about.html', 'how-to.html', 'privacy.html', 'terms.html', 'contact.html', 'reviews.html', 'pages.css', 'bg.svg', 'config.js', 'engine.js', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.origin !== location.origin) return;
  // Network first, cache as fallback, so updates show up right away.
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone();
    caches.open(CACHE).then(c => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request)));
});
