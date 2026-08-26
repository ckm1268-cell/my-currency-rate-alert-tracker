/**
 * Service worker — Phase 39 (26-Aug-2026)
 * ===========================================
 * The one piece of this project that runs even when no tab has the site
 * open — that's the whole point of Web Push. Its only job is: receive a
 * `push` event from the browser (dispatched when
 * backend/notifications/webpush.js's sendWebPush() succeeds), show a
 * native OS notification from it, and focus/open the app's tab if the
 * user clicks that notification. It deliberately does nothing else — no
 * caching, no offline support, no other PWA behavior — this project's
 * project brief does not ask for a full offline-capable app, and adding
 * that here would be scope creep unrelated to making Push functional.
 *
 * Must be served from the SITE ROOT (frontend/sw.js, alongside index.html)
 * for its default registration scope to cover the whole site — a service
 * worker's scope can never be broader than the directory it's served
 * from. Registered by frontend/push.js via
 * `navigator.serviceWorker.register('sw.js')`.
 */

self.addEventListener('install', () => {
  // Activate this version immediately rather than waiting for every open
  // tab to close first — there's no cached content here to conflict with
  // an in-flight page, so there's no reason to delay.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  // backend/notifications/webpush.js sends a JSON payload:
  // { title, body, url }. Guard against a payload that isn't valid JSON
  // (or is entirely absent, which the Push API permits) — a malformed
  // push must still surface SOMETHING rather than throw and silently
  // drop the notification the user is waiting for.
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    data = { title: 'Currency Rate Alert', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'Currency Rate Alert';
  const options = {
    body: data.body || '',
    icon: data.icon || undefined,
    badge: data.badge || undefined,
    tag: 'ckm-rate-alert', // a second push before the first is dismissed replaces it rather than stacking duplicates
    data: { url: data.url || './' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        // Prefer focusing an already-open tab over opening a new one —
        // matches how a normal OS notification click behaves for most apps.
        if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
