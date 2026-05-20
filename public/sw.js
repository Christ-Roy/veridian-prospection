// Service Worker — Veridian Prospection PWA
// Strategie : stale-while-revalidate pour assets statiques,
// network-only pour les appels API (donnees toujours fraiches).
//
// 2026-05-20 — bump v2 : invalide le cache de l'ancien bundle JS qui
// servait un STATUS_OPTIONS incomplet (sans 'site_demo', 'a_rappeler',
// etc.). Les commerciaux voyaient "A contacter" sur des leads en pleine
// négo. Cf todo/2026-05-19-audit-bugs-prospect-status-cross-membre.md.

const CACHE_NAME = 'veridian-prospection-v2';

const PRECACHE_URLS = ['/'];

// ─── Install : pre-cache + activation immediate ───────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// ─── Activate : nettoyage anciens caches + claim clients ──────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

// ─── Fetch : stale-while-revalidate pour assets, network-only pour API ─
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API, POST, cross-origin → jamais caches
  if (
    url.pathname.startsWith('/api/') ||
    request.method !== 'GET' ||
    url.origin !== self.location.origin
  ) {
    return;
  }

  // Assets statiques : stale-while-revalidate
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.woff')
  ) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(request).then((cached) => {
          const fetched = fetch(request).then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          });
          return cached || fetched;
        })
      )
    );
  }
});

// ─── Push notifications ───────────────────────────────────────────────
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  const title = data.title || 'Veridian Prospection';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    data: { url: data.url || '/' },
    tag: data.tag || 'prospection-notification',
    vibrate: [200, 100, 200],
    requireInteraction: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// ─── Click notification → ouvre la page ───────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(url) && 'focus' in client) return client.focus();
      }
      return clients.openWindow(url);
    })
  );
});
