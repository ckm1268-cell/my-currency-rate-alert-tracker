# Push notifications setup — Phase 39 (real Web Push)

This walks you through getting real Push notifications working — alerts
that reach you even with the browser fully closed, delivered by
`backend/scheduler/run.js` the same way Email and Telegram already are (see
`NOTIFICATIONS_SETUP.md`), not the tab-only `Browser` channel that's been
in this app since Phase 6.

Budget about 5 minutes. Unlike Email (Resend account) and Telegram (a bot
via BotFather), Push needs no third-party account at all — the two keys
below are generated locally by a tool already in this repo's own
dependencies, and Web Push itself is a browser-native standard (no
Google/Apple/Microsoft account required to *send* through it, even though
under the hood a push service they operate is what actually delivers it to
the device).

## Before you start: one key is secret, one isn't

Web Push uses a "VAPID" key pair to prove which server is allowed to push
to a given subscription:

- **`VAPID_PUBLIC_KEY`** is not a secret — it's meant to be public, and this
  app already ships it in `frontend/pushConfig.js` (committed to the repo)
  so the browser can use it when subscribing.
- **`VAPID_PRIVATE_KEY`** is the real secret — it's what actually signs the
  push request server-side. Treat it exactly like `SUPABASE_SERVICE_ROLE_KEY`
  or `RESEND_API_KEY`: it only ever belongs in a **GitHub Actions repository
  secret** (step 2 below) and your local `.env`, never in frontend code or
  a commit.

## 1. Generate a VAPID key pair

From the `backend/` folder (where `web-push` is already a dependency —
Phase 39 added it to `backend/package.json`):

```bash
cd backend
npm install        # only needed once, if you haven't already
npx web-push generate-vapid-keys
```

This prints two values:

```
=======================================

Public Key:
BGYd...(a long base64url string)...

Private Key:
ectC...(a shorter base64url string)...

=======================================
```

Copy both — you'll use each exactly once, in two different places.

## 2. Wire the keys in

**Public key → `frontend/pushConfig.js`** (safe to commit):

```js
window.CKM_VAPID_PUBLIC_KEY = "BGYd...(the Public Key you copied)...";
```

Replace the placeholder `"YOUR_VAPID_PUBLIC_KEY"` already in that file with
your real value.

**Both keys → GitHub Actions secrets** (Settings → Secrets and variables →
Actions → New repository secret):

1. Add `VAPID_PUBLIC_KEY` with the Public Key value.
2. Add `VAPID_PRIVATE_KEY` with the Private Key value.
3. Optional: add `VAPID_SUBJECT` set to a `mailto:you@example.com` or
   `https://yoursite.example` — this is shown to push-service operators
   (Google/Mozilla/etc.) if they ever need to contact you about this app's
   use of push; it defaults to a placeholder if you skip it, which still
   works, just isn't a real contact.

These join `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`,
and `TELEGRAM_BOT_TOKEN` from earlier phases —
`.github/workflows/monitor.yml` reads all of them (plus these three new
ones) as environment variables for the scheduled job.

Yes, `VAPID_PUBLIC_KEY` is set in *two* places (the committed
`pushConfig.js` and the GitHub secret) — that's expected, not a mistake.
The frontend needs it to create a subscription in the browser; the backend
needs the identical value to sign the push request that subscription will
accept. They must match exactly, or the push service will reject the send.

## 3. Test it

1. Push a fresh commit with your real `pushConfig.js` value, so it deploys
   to GitHub Pages (Web Push subscriptions only work over HTTPS, which
   GitHub Pages already gives you — this won't work if you're testing
   against a plain `http://` local file).
2. On the deployed dashboard, sign in, check **Push** under Notification,
   and allow the browser's permission prompt when it appears. The status
   line under the checkboxes should change to "Subscribed on this device
   ✓ — click Save to attach it."
3. Set a target rate at or above the current live rate (so it triggers
   immediately) and click **Save current alert to my account**.
4. **Close the browser completely** — not just the tab, the whole browser
   application. This is the actual point of Push; testing with the tab
   still open would only prove the in-tab `Browser` channel works, which
   was already true since Phase 6.
5. In GitHub, go to the **Actions** tab → **Monitor Exchange Rates** →
   **Run workflow**.
6. Within a minute or so, a native OS notification should appear even
   though the browser is closed. Clicking it should open (or focus) the
   app.
7. Also worth checking in Supabase's **Table Editor** → `notifications`:
   the row for this alert with `notification_type = 'push'` should show
   `delivery_status = 'DELIVERED'`. If it shows `'FAILED'`, the
   `delivery_error` column has the reason.

## Troubleshooting

### The Push checkbox is disabled, or the status says "isn't configured on this deployment yet"

`frontend/pushConfig.js` still has the placeholder value
(`"YOUR_VAPID_PUBLIC_KEY"`), or your browser doesn't support the Push API
at all (Web Push is supported by every current major browser except Safari
on iOS before iOS 16.4 — if you're testing on an older iPhone, this is a
real platform limitation, not a bug here).

### `delivery_error` says: `VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not set`

The GitHub Actions secrets from step 2 aren't set, or a secret name has a
typo. Secret names are case-sensitive and must match exactly:
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`.

### `delivery_error` says: `No push subscription saved for this alert`

The alert's `notification_methods` includes `push`, but its
`push_subscription` column is empty — this shouldn't be possible through
the normal UI (`frontend/auth.js`'s save guard blocks it), but could happen
if a row was edited directly in Supabase's Table Editor. Fix: on the
dashboard, uncheck then re-check **Push**, allow the permission prompt
again, and re-save the alert.

### `delivery_error` says: `Push subscription no longer valid (HTTP 404/410)`

The browser this alert was subscribed on has revoked or expired the
subscription — usually because notification permission was later denied,
site data was cleared, or the browser/OS unregistered it after a long
period of inactivity. This is normal Web Push lifecycle behavior, not a
bug: subscriptions are tied to one browser install and aren't permanent.
Fix: open the app on that device again, uncheck then re-check **Push** to
create a fresh subscription, and re-save the alert.

### The notification never arrives, and no error shows up anywhere

A few things this app cannot control or see into:

- **OS-level "Do Not Disturb" / notification settings** for the browser
  itself — check your OS's notification settings for Chrome/Edge/Firefox
  specifically, separate from the in-browser permission prompt.
- **Browser fully quit vs. "closed" on some platforms.** On some
  OS/browser combinations, closing the last window doesn't fully quit the
  browser process (it may keep running in the background specifically to
  keep push working) — this is actually in your favor for reliability, but
  worth knowing if you're trying to test the "truly closed" case and the
  browser process is still technically running.
- Check the Actions run log itself (`node scheduler/run.js`'s console
  output) for the `notify via push: ...` line — it shows the exact
  `deliveryStatus` this run got, which is the most reliable single source
  of truth for whether the send was even attempted.

## What this does and doesn't do yet

- **Real:** `backend/notifications/webpush.js` sends an actual, encrypted
  Web Push request via the standard protocol the moment a saved Push
  alert's target is reached — same "called for real, delivery outcome
  recorded honestly" standard as Email/Telegram. `frontend/sw.js` (the
  service worker) is what shows the native notification even with the tab
  closed, and focuses/opens the app if you click it.
- **Not yet:** a recurring schedule — same outstanding blocker as
  Email/Telegram (see `NOTIFICATIONS_SETUP.md`'s own note on this); Push
  only fires when the workflow is triggered, manually or once that
  blocker clears.
- **Not yet:** any UI to see or manage subscriptions across multiple
  devices from one place, or to know a subscription has silently expired
  before a send actually fails against it — the 404/410 handling above is
  reactive (you find out the next time it triggers), not proactive.
- **Not a PWA.** `frontend/sw.js` exists purely to receive push events; it
  does not add offline support, an install prompt, or any other
  Progressive Web App behavior — that's a genuinely separate feature this
  phase deliberately did not build.
