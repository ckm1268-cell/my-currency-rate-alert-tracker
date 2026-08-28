/**
 * PWA install prompt — mobile-app phase (28-Aug-2026)
 * ========================================================
 * Self-contained, no dependency on app.js/window.CKM (unlike push.js) —
 * this only ever touches its own two UI elements (#installAppBtn,
 * #iosInstallBanner) and browser-native install APIs, so it can load in
 * any order relative to the other scripts.
 *
 * Two different platforms, two different mechanisms, because there is no
 * single cross-platform "show install prompt" API:
 *
 * 1. Android / Chrome / Edge / most non-Safari browsers fire a real
 *    `beforeinstallprompt` event we can capture and replay later from a
 *    button click (`prompt()` must be called from a user gesture, so we
 *    stash the event and wait for the click rather than calling it
 *    immediately).
 * 2. iOS Safari never fires `beforeinstallprompt` — Apple has no
 *    programmatic install API at all. The only way to install there is
 *    the user manually doing Share → Add to Home Screen, so for iOS this
 *    script's only job is to show a plain-language instruction banner
 *    instead of a button that would otherwise silently do nothing.
 *
 * Neither path does anything if the app is already running installed
 * (standalone display mode) — no point telling an already-installed user
 * to install.
 */

(function () {
  'use strict';

  function isStandalone() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true // legacy iOS Safari flag
    );
  }

  function isIos() {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent) && !window.MSStream;
  }

  // Register the service worker as early as possible (idempotent — if
  // push.js also calls navigator.serviceWorker.register('sw.js') later,
  // the browser reuses the same registration for the same URL+scope,
  // it does not double-register). Installability on Android/Chrome
  // wants an active service worker sooner rather than later; previously
  // this only happened lazily the first time a user opted into Push.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      // Bug fix (28-Aug-2026): browsers throttle their OWN automatic
      // update checks to roughly once per 24h per registration, so a
      // genuinely new deploy (a new CKM_SHELL_CACHE version in sw.js)
      // can silently sit undetected on an already-installed device for
      // up to a day, still serving old cached CSS/JS — confirmed live
      // after the "Build Your Alert" shortcut shipped. reg.update() is
      // exempt from that throttle: it always fetches sw.js fresh (service
      // worker script requests bypass normal HTTP caching by spec), so
      // calling it here means every page load checks for a new version
      // immediately instead of waiting out the browser's own timer.
      reg.update().catch(() => {});
    }).catch(() => {
      // Best-effort only — push.js will retry this itself if/when the
      // user opts into Push, and a failed registration here must never
      // block the rest of the page.
    });
  }

  if (isStandalone()) return; // already installed — nothing to prompt

  let deferredPrompt = null;
  const installBtn = document.getElementById('installAppBtn');
  const iosBanner = document.getElementById('iosInstallBanner');
  const iosDismiss = document.getElementById('iosInstallDismiss');

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // stop the browser's own mini-infobar; we show our own button instead
    deferredPrompt = event;
    if (installBtn) installBtn.style.display = 'inline-flex';
  });

  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      installBtn.disabled = true;
      deferredPrompt.prompt();
      try {
        const { outcome } = await deferredPrompt.userChoice;
        // outcome is 'accepted' or 'dismissed' — either way the browser
        // will not re-fire beforeinstallprompt for a while, so hide the
        // button rather than leave a now-inert control on screen.
        if (outcome === 'accepted') {
          installBtn.style.display = 'none';
        } else {
          installBtn.disabled = false;
        }
      } catch (err) {
        installBtn.disabled = false;
      }
      deferredPrompt = null;
    });
  }

  window.addEventListener('appinstalled', () => {
    if (installBtn) installBtn.style.display = 'none';
    if (iosBanner) iosBanner.style.display = 'none';
  });

  // iOS: no programmatic prompt exists, so show a plain-language banner
  // instead — once per browser, not on every single page load, via a
  // small localStorage flag (this is a real deployed site, not an
  // in-conversation artifact preview, so localStorage is the correct,
  // durable tool here).
  if (isIos() && iosBanner) {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem('ckm_ios_install_dismissed') === '1';
    } catch (err) {
      // Private browsing / storage blocked — fall back to showing it
      // every load rather than crashing.
    }
    if (!dismissed) {
      iosBanner.style.display = 'flex';
    }
    if (iosDismiss) {
      iosDismiss.addEventListener('click', () => {
        iosBanner.style.display = 'none';
        try {
          localStorage.setItem('ckm_ios_install_dismissed', '1');
        } catch (err) {
          // Best-effort only.
        }
      });
    }
  }
})();
