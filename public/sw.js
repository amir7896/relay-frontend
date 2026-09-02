self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : 'New message' };
  }
  const title = payload.title || 'Relay';
  const conversationId = payload.conversationId || '';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || 'New message',
      tag: conversationId || 'relay-message',
      data: { conversationId },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const conversationId = event.notification.data?.conversationId;
  const path = conversationId ? `/chat/${encodeURIComponent(conversationId)}` : '/chat';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const client = clients[0];
      if (client) {
        client.navigate(path);
        return client.focus();
      }
      return self.clients.openWindow(path);
    }),
  );
});
