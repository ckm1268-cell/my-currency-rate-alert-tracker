/**
 * Web Push delivery channel — Phase 39 (26-Aug-2026)
 * ===================================================================
 * Real, server-side "works even with the browser closed" push, using the
 * standard Web Push protocol (RFC 8030/8291/8188) via the `web-push` npm
 * package. This is the one notification channel in this project that adds
 * an actual dependency rather than a thin `fetch()` wrapper like email.js
 * and telegram.js — deliberately: Web Push payloads must be encrypted per
 * RFC 8291 (ECDH + HKDF + AES128GCM) and the request signed with a VAPID
 * JWT (RFC 8292, ES256). That's real, security-sensitive cryptography, not
 * a REST call — hand-rolling it with Node's raw `crypto` module would be
 * exactly the kind of "reimplement well-tested crypto by hand" risk this
 * project avoids elsewhere (see e.g. tajmuhabath.adapter.js's explicit
 * refusal to reverse-engineer that site's internal auth). `web-push` is
 * the standard, widely-used library for this — same tier of justified
 * dependency as `playwright`/`@supabase/supabase-js` already are.
 *
 * Why this exists at all: before this phase, "browser notification" only
 * ever meant frontend/app.js's in-tab `new Notification(...)` call, which
 * genuinely cannot fire with the tab or browser closed — notify.js's own
 * header comment says so explicitly. The project's footer copy promises
 * a "Push" channel alongside Email/Telegram as something the scheduled
 * backend job delivers — this file is what makes that literally true
 * instead of aspirational.
 *
 * How a subscription gets here: frontend/push.js calls
 * `PushManager.subscribe()` in the browser (after the user checks "Push
 * notification" and grants permission) and stores the resulting
 * PushSubscription (as plain JSON — `{ endpoint, keys: { p256dh, auth } }`)
 * directly on that alert's own `alerts.push_subscription` column (Phase 39
 * migration, see database/schema.sql) — same "store it on the alert row,
 * no separate profile table" philosophy already used for
 * `telegram_chat_id`. backend/scheduler/run.js's resolveNotifyTargets()
 * passes that subscription straight through to notify.js, which passes it
 * to sendWebPush() below.
 *
 * Required environment variables: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (see
 * .env.example — backend / GitHub Actions secret only; the PUBLIC key is
 * also, separately and intentionally, placed in frontend/pushConfig.js,
 * since a Web Push "application server key" is meant to be public — it's
 * how the browser proves which server may push to a given subscription,
 * not a secret). Optional: VAPID_SUBJECT — a mailto: or https: URL the
 * push service can use to contact the sender if something's wrong with
 * this app's use of push; defaults to a placeholder if unset (still works,
 * just less helpful to push-service operators than a real contact).
 * Generate a key pair with `npx web-push generate-vapid-keys` — see
 * PUSH_SETUP.md for the full walkthrough.
 */

'use strict';

const webpush = require('web-push');

/**
 * Configures the `web-push` module's VAPID details from the current
 * environment. Called on every send rather than cached behind a
 * once-per-process flag: `setVapidDetails()` is cheap (it just stores the
 * three values in the `web-push` module's own internal state, no network
 * call), and NOT caching keeps this function honestly re-checking
 * `process.env` every time — including in tests, where a cached "already
 * configured" flag would let a real key set by an earlier test silently
 * paper over a later test that's specifically checking the missing-key
 * error path (an actual bug hit and fixed while writing
 * tests/webpush.test.js — see that file's own header comment). Throws a
 * clear, specific error — never a generic crash — if either required key
 * is missing, mirroring email.js's/telegram.js's own missing-credential
 * guards.
 */
function ensureVapidConfigured() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    throw new Error(
      'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not set — cannot send a push notification. ' +
      'Generate a key pair with `npx web-push generate-vapid-keys`, put the PUBLIC key in ' +
      'frontend/pushConfig.js (safe to commit) and BOTH keys as GitHub Actions repo secrets ' +
      '(Settings -> Secrets and variables -> Actions) and in .env for local runs. See PUSH_SETUP.md.'
    );
  }

  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

/**
 * @param {{ subscription: { endpoint: string, keys: { p256dh: string, auth: string } },
 *           title: string, body: string, url?: string }} params
 * @returns {Promise<{ statusCode: number|null }>}
 * @throws if the VAPID keys are missing, no subscription is given, the
 *   subscription is malformed, or the push service itself rejects the send
 *   (including a 404/410 for a subscription the browser has since revoked
 *   — see the caller-facing note on that below). The caller (notify.js) is
 *   responsible for catching this and recording a FAILED delivery, same
 *   contract as sendEmail()/sendTelegramMessage().
 */
async function sendWebPush({ subscription, title, body, url }) {
  ensureVapidConfigured();

  if (!subscription || typeof subscription !== 'object' || !subscription.endpoint) {
    throw new Error('sendWebPush() called without a valid push subscription (missing endpoint).');
  }

  const payload = JSON.stringify({ title, body, url: url || '/' });

  try {
    const result = await webpush.sendNotification(subscription, payload);
    return { statusCode: (result && result.statusCode) || null };
  } catch (err) {
    // web-push throws a WebPushError with statusCode/body for a real HTTP
    // rejection from the push service (Google/Mozilla/etc.'s push
    // endpoint) — surface those specifically, since a 404/410 here means
    // this exact subscription no longer exists (the user uninstalled,
    // cleared site data, or revoked notification permission on that
    // device) and re-sending to it will never succeed until the browser
    // creates a fresh subscription. This project does not auto-clear a
    // stale subscription from the alert row on this failure (that would
    // silently disable the user's alert channel with no way for them to
    // know why) — it's surfaced as a FAILED delivery with an explicit
    // reason instead, same "never silently degrade" principle as every
    // other error path in this codebase. See PUSH_SETUP.md's
    // Troubleshooting section for what to do about it.
    if (err && (err.statusCode === 404 || err.statusCode === 410)) {
      throw new Error(
        `Push subscription no longer valid (HTTP ${err.statusCode}) — the browser this alert was ` +
        `subscribed on has revoked or expired it. Re-enable Push in the app on that device to ` +
        `re-subscribe, then save the alert again.`
      );
    }
    if (err && err.statusCode) {
      throw new Error(`Push service error (HTTP ${err.statusCode}): ${err.body || err.message}`);
    }
    throw new Error(`Web Push send failed: ${err.message}`);
  }
}

module.exports = { sendWebPush, ensureVapidConfigured };
