// Minimal service worker: caches the app shell so it opens instantly from the
// home screen. Never caches /api — your journal data always comes fresh from the server.
const CACHE = 'heartwood-shell-v3';
const MAX_ASSETS = 80; // old builds' files pile up otherwise; keep the newest

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['/', '/manifest.webmanifest'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  // Navigations: network first, fall back to cached shell when offline.
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put('/', copy));
      return res;
    }).catch(() => caches.match('/')));
    return;
  }
  // Static assets: cache first (filenames are content-hashed).
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
    if (res.ok && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/'))) {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy).then(() => trim(c)));
    }
    return res;
  })));
});

// Cache keys come back oldest first; drop the oldest assets past the limit.
async function trim(cache) {
  const assets = (await cache.keys()).filter(r => new URL(r.url).pathname.startsWith('/assets/'));
  await Promise.all(assets.slice(0, Math.max(0, assets.length - MAX_ASSETS)).map(r => cache.delete(r)));
}

// ---------- notifications from your server ----------
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Heartwood', {
    body: d.body || '',
    tag: d.tag || undefined,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    // Buttons on the notification where the phone shows them (Android, desktop). iPhone opens the default.
    actions: (d.actions || []).slice(0, 2).map(a => ({ action: a.action, title: a.title })),
    data: { url: d.url || '/', actions: Object.fromEntries((d.actions || []).map(a => [a.action, a.url])) }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = (e.action && e.notification.data?.actions?.[e.action]) || e.notification.data?.url || '/';
  const url = new URL(target, self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.startsWith(self.location.origin));
    if (open) return open.navigate(url).then(c => (c || open).focus());
    return self.clients.openWindow(url);
  }));
});
