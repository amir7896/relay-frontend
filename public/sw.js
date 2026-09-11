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
