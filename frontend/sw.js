/**
 * Service worker — Phase 39 (26-Aug-2026), extended for the mobile-app
 * phase (28-Aug-2026)
 * ===========================================
 * Two jobs now, kept deliberately separate below:
 *
 * 1. Web Push (Phase 39, unchanged) — receive a `push` event dispatched
 *    by backend/notifications/webpush.js, show a native OS notification,
 *    and focus/open the app's tab on click. Runs even with no tab open.
 *
 * 2. App-shell caching (new, mobile-app phase) — the minimum needed for
 *    Android/Chrome to consider this app installable, and so an install
 *    launches instantly / has something to show if the network hiccups
 *    for a moment. This is deliberately narrow, not a general offline
 *    mode: it ONLY ever caches this app's own static shell files (HTML/
 *    CSS/JS/manifest/icons), matched by an explicit allowlist below —
 *    every other request (Supabase reads/writes, the Google Fonts CSS,
 *    the Supabase JS CDN script, anything cross-origin) is passed
 *    straight to the network, untouched, every single time. That is not
 *    an oversight — it is the direct consequence of this project's core
 *    rule (project brief section 2): a rate is only ever allowed to be
 *    labeled LIVE if it was actually just retrieved, never served from a
 *    cache. Caching a Supabase response here would risk exactly the
 *    "stale data shown as live" failure the whole app exists to avoid,
 *    so those requests are excluded by construction, not by an
 *    if-it-fails check.
 *
 * Must be served from the SITE ROOT (frontend/sw.js, alongside index.html)
 * for its default registration scope to cover the whole site — a service
 * worker's scope can never be broader than the directory it's served
 * from. Registered by frontend/installPrompt.js as early as the page
 * loads (previously only push.js registered it, lazily, on Push opt-in —
 * installability wants it registered sooner than that).
 */

// Bug fix (28-Aug-2026): the last two frontend commits (Build Your
// Alert shortcut + its colour/scroll follow-up) changed styles.css,
// index.html and auth.js but never bumped this constant, so every
// already-installed user kept being served the OLD cached styles.css
// forever (cache-first, and this file itself was byte-identical, so
// the browser never even detected an update to install fresh). Result,
// confirmed live on Android: the new markup rendered with zero of its
// CSS, as an unstyled stacked link. Bumping the version string here IS
// the fix -- it changes this file's bytes, which is what makes a
// browser notice a new service worker, run install() again (re-fetching
// every CKM_SHELL_FILES entry fresh), and activate() clears the old
// cache. REMINDER: bump this on every future commit that touches any
// file in CKM_SHELL_FILES below, or this exact bug recurs silently.
// Bumped again (28-Aug-2026): desktop-only collapsed form-panel
// feature touched styles.css and auth.js -- see their own comments.
// Bumped again (28-Aug-2026): save/update now re-collapses the form
// panel and scrolls to the account card -- touched auth.js/styles.css.
// Bumped again (28-Aug-2026): Merchantrade Asia JPY/USD enablement
// touched app.js's DISPLAY_NAME_MATCHED_CURRENCIES.
// Bumped again (28-Aug-2026): version 2.0.0 marker -- touched
// index.html's phase chip (v1.0 -> v2.0).
// Bumped again (29-Aug-2026, Phase 48): new shared
// frontend/currencySupport.js file added to the shell -- touched
// index.html (new <script> tag) and app.js (now reads from it).
// Bumped again (29-Aug-2026, Phase 49): two more new shared files added
// to the shell -- frontend/sourceNames.js and frontend/timeFormat.js --
// touched index.html (two new <script> tags) and app.js (reads from
// both instead of its own local copies).
// Bumped again (02-Sep-2026, Phase 53): version 3.0.0 marker -- touched
// index.html's phase chip (v2.0 -> v3.0) and app.js's official-default
// branch values / loadAlertIntoForm() fallback (see that file's own
// Phase 53 comments).
// Bumped again (02-Sep-2026, Phase 54): each branch-aware money
// changer's branch dropdown now renders directly under that money
// changer's own checkbox row instead of in one shared block further
// down the form -- touched index.html (per-source branchField-<id>
// containers replacing the old single #branchFieldsContainer),
// app.js's renderBranchFields(), and styles.css's new .branch-field
// rules.
const CKM_SHELL_CACHE = 'ckm-shell-v14';

// Exactly the app's own static shell — every entry is same-origin and
// something this app ships itself. Deliberately NOT included: any
// Supabase URL, the Google Fonts stylesheet/font files, or the Supabase
// JS CDN script — those must always go to the network (see header above).
const CKM_SHELL_FILES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'currencySupport.js',
  'sourceNames.js',
  'timeFormat.js',
  'auth.js',
  'rateHistory.js',
  'push.js',
  'installPrompt.js',
  'supabaseConfig.js',
  'pushConfig.js',
  'manifest.json',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CKM_SHELL_CACHE)
      .then((cache) => cache.addAll(CKM_SHELL_FILES))
      .catch(() => {
        // Best-effort pre-warm only — a failure here (e.g. offline on
        // first install) must not block the service worker from
        // installing at all, since Push still needs to work regardless.
      })
  );
  // Activate this version immediately rather than waiting for every open
  // tab to close first.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((names) =>
        Promise.all(names.filter((n) => n !== CKM_SHELL_CACHE).map((n) => caches.delete(n)))
      ),
    ])
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only ever handle same-origin GET requests for the app's own shell
  // files. Everything else — cross-origin (Supabase, fonts, CDN scripts)
  // or a non-GET request — is left completely alone: no respondWith()
  // call at all, so the browser's normal network handling applies as if
  // this service worker did not exist.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const path = url.pathname.replace(/^.*\/(frontend\/)?/, ''); // tolerate being served from a subpath
  const isShellFile =
    req.mode === 'navigate' ||
    CKM_SHELL_FILES.some((f) => path === f || path.endsWith('/' + f) || (f === './' && path === ''));
  if (!isShellFile) return;

  if (req.mode === 'navigate') {
    // Network-first for the page itself, so a user who opens the
    // installed app while online always gets the current deployed
    // version rather than a cached one going stale over time. Only
    // falls back to the cached shell if the network genuinely fails
    // (offline, or the request errors) — e.g. opening the app with no
    // signal at all still shows something instead of a browser error page.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CKM_SHELL_CACHE).then((cache) => cache.put('index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('index.html'))
    );
    return;
  }

  // Cache-first for static assets (CSS/JS/icons/manifest) — these are
  // versioned by redeploy (a new CKM_SHELL_CACHE name would be needed to
  // force-bust them), fine for this project's update cadence, and this
  // keeps repeat loads fast/offline-resilient without ever touching data.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CKM_SHELL_CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      });
    })
  );
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
