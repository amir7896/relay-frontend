/* Relay service worker — push + lightweight installable shell.
   App JS/CSS must NEVER be cache-first or HMR / deploys look "stuck". */

const CACHE_VERSION = 'relay-shell-v3';
const SHELL_URLS = [
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

function isAppCode(url) {
  const path = url.pathname;
  return (
    path.startsWith('/src/') ||
    path.startsWith('/@') ||
    path.startsWith('/node_modules/') ||
    path.startsWith('/assets/') ||
    path.endsWith('.js') ||
    path.endsWith('.mjs') ||
    path.endsWith('.css') ||
    path.endsWith('.ts') ||
    path.endsWith('.tsx') ||
    path.endsWith('.jsx') ||
    path.endsWith('.map')
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_VERSION)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  // Never intercept API / realtime / uploads / app modules
  if (
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/socket.io') ||
    url.pathname.startsWith('/uploads') ||
    isAppCode(url)
  ) {
    return;
  }

  // Navigations: always network-first (never pin an old index.html)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches
          .match('/index.html')
          .then((cached) => cached || caches.match('/')),
      ),
    );
    return;
  }

  // Icons / manifest only: cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const copy = response.clone();
        void caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        return response;
      });
    }),
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : 'New message' };
  }
  const title = payload.title || 'Relay';
  const conversationId = payload.conversationId || '';
  const isCall = payload.type === 'call';
  const tag = isCall
    ? `relay-call-${payload.callId || conversationId}`
    : conversationId || 'relay-message';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || (isCall ? 'Incoming call' : 'New message'),
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag,
      renotify: isCall,
      requireInteraction: isCall,
      data: {
        conversationId,
        type: payload.type || 'message',
        callId: payload.callId || null,
        media: payload.media || 'audio',
        kind: payload.kind || 'private',
      },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const conversationId = data.conversationId;
  const path = conversationId
    ? `/chat/${encodeURIComponent(conversationId)}${data.type === 'call' ? '?incomingCall=1' : ''}`
    : '/chat';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.postMessage({
            type: 'relay-notification-click',
            conversationId,
            call: data.type === 'call',
            callId: data.callId,
          });
          client.navigate(path);
          return client.focus();
        }
      }
      return self.clients.openWindow(path);
    }),
  );
});
