// Bump to retire the previous cache on the next deploy.
const CACHE = 'homedash-v2';

// Enough to boot the app with no connection at all.
const SHELL = [
  '/',
  '/support.js',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/favicon.svg',
  '/favicon-32.png',
  '/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  // One missing file must not fail the whole install, so they're added
  // individually and failures ignored.
  event.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(SHELL.map(url => c.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function putIfOk(request, response) {
  if (response && response.ok) {
    const copy = response.clone();
    caches.open(CACHE).then(c => c.put(request, copy)).catch(() => {});
  }
  return response;
}

// Serve from cache, refresh in the background. Opening the app is then instant
// and works with no signal; the 60s poll and the visibility refetch pull the
// real numbers in a moment later.
function staleWhileRevalidate(request) {
  return caches.match(request).then(hit => {
    const live = fetch(request).then(r => putIfOk(request, r)).catch(() => null);
    return hit || live.then(r => r || Response.error());
  });
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Writes and the config lookup must always be live.
  if (sameOrigin && url.pathname.startsWith('/api/') && url.pathname !== '/api/tasks') return;

  // Network first, falling back to the last good copy. The fallback is what
  // stops an offline boot dropping through to the app's prototype mode and
  // rendering seeded demo chores instead of the real list.
  //
  // Deliberately NOT stale-while-revalidate: two phones reconcile against this
  // every 60s, and serving the previous response would make a tick appear to
  // undo itself until the poll after next.
  if (sameOrigin && url.pathname === '/api/tasks') {
    event.respondWith(
      fetch(req).then(r => putIfOk(req, r)).catch(() => caches.match(req))
    );
    return;
  }

  // Navigations go to the network first so a deploy is picked up straight away,
  // and fall back to the cached shell when there's nothing to reach.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(r => putIfOk(req, r))
        .catch(() => caches.match(req).then(hit => hit || caches.match('/')))
    );
    return;
  }

  if (sameOrigin || /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req));
  }
});

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
