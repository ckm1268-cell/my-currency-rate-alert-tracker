/**
 * Web Push subscription flow — Phase 39 (26-Aug-2026)
 * ========================================================
 * Self-contained, loaded after app.js (needs window.CKM.getState()) and
 * after frontend/pushConfig.js (needs window.CKM_VAPID_PUBLIC_KEY). Fails
 * soft exactly like frontend/rateHistory.js and frontend/auth.js: if
 * push isn't configured yet, or this browser doesn't support it, the Push
 * checkbox stays usable-looking but explains why it can't be enabled,
 * rather than throwing or silently doing nothing.
 *
 * Deliberately owns the "notifPush" checkbox's *change* listener entirely
 * on its own — app.js does NOT also wire a plain "flip the boolean on
 * click" listener for it the way it does for notifEmail/notifTelegram.
 * Those two are simple user intent with nothing to verify; Push requires
 * an actual async permission request + subscription before it would be
 * honest to say `state.notifications.push = true` — setting it eagerly on
 * click, before subscribe() has actually succeeded, would be the same
 * "claims a channel is live before it's proven so" mistake the Phase 5
 * fireAlert()/Phase 25 notify() incidents already caught and fixed for
 * other channels. app.js still owns *restoring* the checkbox's checked
 * state when loading a saved alert (see its loadAlertIntoForm()) — that's
 * just reflecting stored data, not requesting a new subscription, so it
 * belongs there for consistency with how email/telegram are restored.
 */

(function () {
  'use strict';

  function isPushSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  function isConfigured() {
    return (
      typeof window.CKM_VAPID_PUBLIC_KEY === 'string' &&
      window.CKM_VAPID_PUBLIC_KEY &&
      window.CKM_VAPID_PUBLIC_KEY !== 'YOUR_VAPID_PUBLIC_KEY'
    );
  }

  // Standard boilerplate: PushManager.subscribe() needs the VAPID public
  // key as a raw Uint8Array, not the base64url string it's distributed as.
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  function setStatus(msg) {
    const el = document.getElementById('pushStatus');
    if (el) el.textContent = msg;
  }

  let swRegistrationPromise = null;
  function ensureServiceWorker() {
    if (!swRegistrationPromise) {
      swRegistrationPromise = navigator.serviceWorker.register('sw.js');
    }
    return swRegistrationPromise;
  }

  /**
   * Requests notification permission (if not already decided) and creates
   * (or reuses) a real PushSubscription, storing it as plain JSON directly
   * on window.CKM.getState().pushSubscription — getState() returns the
   * SAME live state object app.js's own closure uses (not a snapshot copy;
   * see app.js's `window.CKM.getState = () => state;`), so this write is
   * immediately visible to frontend/auth.js's saveCurrentAlert() the next
   * time the user clicks Save, with no extra plumbing needed.
   *
   * @returns {Promise<boolean>} true only if a real subscription now exists.
   */
  async function subscribe() {
    if (!isPushSupported()) {
      setStatus('This browser doesn’t support push notifications.');
      return false;
    }
    if (!isConfigured()) {
      setStatus('Push isn’t configured on this deployment yet (missing VAPID key) — see PUSH_SETUP.md.');
      return false;
    }

    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }
    if (permission !== 'granted') {
      setStatus('Notification permission was not granted — enable notifications for this site in your browser settings to use Push.');
      return false;
    }

    try {
      const reg = await ensureServiceWorker();
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(window.CKM_VAPID_PUBLIC_KEY),
        });
      }
      const state = window.CKM.getState();
      state.pushSubscription = sub.toJSON();
      setStatus('Subscribed on this device ✓ — click "Save current alert" below to attach it.');
      return true;
    } catch (err) {
      setStatus(`Could not subscribe to push: ${err.message}`);
      return false;
    }
  }

  /**
   * Best-effort unsubscribe — used when the user unchecks Push. A failure
   * here (e.g. the service worker never registered) is not treated as
   * fatal: the important, always-reliable step is clearing
   * state.pushSubscription so a subsequent Save never re-attaches a stale
   * subscription the user explicitly asked to stop using.
   */
  async function unsubscribe() {
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg && (await reg.pushManager.getSubscription());
        if (sub) await sub.unsubscribe();
      }
    } catch (err) {
      // Best-effort only — see comment above.
    }
    const state = window.CKM.getState();
    state.pushSubscription = null;
    setStatus('Push notifications disabled on this device.');
  }

  function wire() {
    const checkbox = document.getElementById('notifPush');
    if (!checkbox) return;

    if (!isPushSupported()) {
      checkbox.disabled = true;
      setStatus('This browser doesn’t support push notifications.');
    } else if (!isConfigured()) {
      setStatus('Push isn’t configured on this deployment yet — see PUSH_SETUP.md.');
    }

    checkbox.addEventListener('change', async (e) => {
      const state = window.CKM.getState();
      if (e.target.checked) {
        const ok = await subscribe();
        state.notifications.push = ok;
        if (!ok) e.target.checked = false; // never leave the box checked over a subscription that doesn't actually exist
      } else {
        state.notifications.push = false;
        await unsubscribe();
      }
    });

    // Reflect an already-existing subscription on load (e.g. this device
    // was already subscribed from an earlier visit, or the "Edit" flow
    // just checked this box while restoring a saved Push alert) — purely
    // informational, does not create a new subscription on its own.
    if (isPushSupported() && isConfigured()) {
      navigator.serviceWorker.getRegistration()
        .then((reg) => (reg ? reg.pushManager.getSubscription() : null))
        .then((sub) => {
          if (sub) {
            const state = window.CKM.getState();
            if (checkbox.checked) {
              state.pushSubscription = sub.toJSON();
              setStatus('Subscribed on this device ✓');
            }
          }
        })
        .catch(() => {});
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
