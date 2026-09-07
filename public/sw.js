// Shows a notification for every push, even if the payload is missing or
// malformed — Chrome penalises a push event that displays nothing.
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (e) { data = { body: event.data ? event.data.text() : '' }; }

  event.waitUntil(self.registration.showNotification(data.title || 'Home Dashboard', {
    body: data.body || 'A job is due.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'task-' + (data.taskId || Date.now()),
    renotify: true,
    requireInteraction: false,
    data: { taskId: data.taskId }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow('/');
  }));
});

// Take over immediately on update rather than waiting for every tab to close,
// so a redeploy can't leave a stale worker holding the subscription.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
