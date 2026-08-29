# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/).

This file starts at v1.0.0. Everything before that was iterative
development (~40 numbered "phases," each addressing one requested feature
or bug fix) — that detailed build history still exists in this repo's git
log and commit messages if you need it, but isn't repeated here entry by
entry. This file tracks releases going forward.

## [Unreleased]

### Added

**Admin Module — bulk manage user accounts**
- A new Super User role (`profiles.role`) lets a promoted account open
  `admin.html` and bulk-disable, bulk-re-enable, or bulk-delete other
  users' accounts, with a confirmation dialog before anything destructive
  runs and a full audit log (`admin_actions`) of every attempt.
- Backed by a new Supabase Edge Function (`supabase/functions/admin-users`)
  that holds its own service-role secret and re-verifies the caller's admin
  role server-side on every request — the frontend never has, and never
  could have, enough access on its own to disable or delete an account.
- An admin can never act on their own account, to prevent an accidental
  self-lockout with no other admin available to undo it.
- See `ADMIN_SETUP.md` for the full setup walkthrough (schema migration,
  deploying the Edge Function, promoting your first Super User).

**Live rates**
- Merchantrade Asia's SGD is now live (previously SIMULATED): the site
  splits SGD into two note-denomination tiers with no single obvious
  rate, same ambiguity USD had until Phase 44 — the project owner picked
  BIG as the standard tier, same as USD.

### Fixed

- The Admin Module's "🛡️ Admin" link and "← Back to dashboard" button
  rendered as underlined text links instead of pill buttons.
- Signing out left the "Build Your Alert" form permanently hidden on
  desktop for any account that had it auto-collapsed while signed in,
  with no way to bring it back.
- Signing back in during the same page visit (after signing out) no
  longer re-collapsed "Build Your Alert" the way a fresh page load would.
- The Admin Module's "Filter by email" search box rendered as a large
  empty box on mobile instead of a normal-sized field.
- Migrated off the legacy JWT-based Supabase `anon`/`service_role` keys
  to the newer `sb_publishable_.../sb_secret_...` keys, after the
  service-role key was inadvertently exposed during setup; the legacy
  keys have been revoked.
- **Merchantrade Asia's JPY, USD, and SGD never actually went live for
  any user, despite v2.0.0 and the SGD note above claiming they had.**
  The backend scheduler (`backend/scheduler/comboSelection.js`) keeps
  its own hand-maintained copy of the same currency-support list
  `frontend/app.js` uses (a browser-only file the scheduler can't
  `require()`), and that copy was never updated when JPY/USD were added
  at v2.0.0 or when SGD was added just above. The result: the frontend
  correctly believed these three combos were real, but the scheduler's
  `isSupportedCombo()` kept silently returning false for them, so it
  never once attempted a live check — the `rates` table had zero rows
  for Merchantrade Asia + JPY/USD/SGD, and the dashboard correctly (per
  its own no-fake-LIVE-label rule) kept showing them as SIMULATED
  indefinitely, with nothing to signal why. This is the same failure
  mode as the My Money Master + VND incident earlier in this project's
  history, recurring because the list is duplicated by hand in two
  files instead of shared from one. Found after a user reported the
  SGD fix above didn't actually take effect on the live dashboard.
  Fixed by syncing the scheduler's list to match the frontend's; see
  `comboSelection.js`'s own header comment for the full incident
  writeup.
- **Structural follow-up to the fix above:** re-syncing the two
  hand-duplicated currency-support lists was the second time that
  "keep in sync by hand" discipline had silently failed (the first
  was My Money Master + VND, `[2.0.0]`'s Phase 42 fix), so this time
  the duplication itself was removed rather than repaired again. Both
  lists now live in exactly one file, `frontend/currencySupport.js`
  (a small UMD-style module with no dependencies), which
  `frontend/app.js` loads via a `<script>` tag and
  `backend/scheduler/comboSelection.js` loads via `require()` — the
  same bytes, read synchronously by both the browser and Node, so
  there is no longer a second copy anywhere that can drift out of
  sync. `tests/comboSelection.test.js`'s "must never drift" test,
  which used to compare two hardcoded literals pasted into the test
  file against each other (and so never could have caught either
  incident), now requires the real shared file directly. Full test
  suite verified green: 128/128.

## [2.0.0] — 2026-08-28

### Added

**Mobile install (PWA)**
- The app now installs directly to an Android or iOS home screen as a
  free Progressive Web App — no app store, account, or fee. Same live
  Supabase data, same adapters, same scheduler; only the install/launch
  experience is new.
- A web app manifest and a brand-matching icon set (`frontend/manifest.json`,
  `frontend/assets/icons/`).
- An "Install App" button on Android/Chrome (`beforeinstallprompt`) and an
  "Add to Home Screen" instruction banner on iOS Safari, which has no
  install-button API of its own (`frontend/installPrompt.js`).
- The existing Web Push service worker now also caches the app's own
  static shell for installability and instant/offline-resilient
  launches — explicitly scoped to never cache Supabase or any other
  live-data request, so an installed app can never show a stale number
  labeled LIVE. See `frontend/sw.js`'s header comment and
  `MOBILE_APP_SETUP.md` for the full detail, including the one iOS-only
  caveat: Push notifications there only work once the app has actually
  been added to the home screen first.

This supersedes the "No PWA install/offline support" line under v1.0.0's
Known limitations below — that was accurate for v1.0.0 at the time, and
is left as a historical record rather than edited out.

**Desktop UX: quicker access to saved alerts**
- A "+ Build Your Alert" shortcut now sits at the top right of "My saved
  alerts", filled in the same accent colour as the primary Save button —
  jumps straight to the alert form.
- On desktop (≥881px) viewports, a signed-in user's "Build Your Alert"
  form sidebar now starts collapsed rather than permanently occupying a
  340px column — it appears on request (the shortcut above, or "Edit" on
  a saved alert), then automatically collapses again and scrolls back to
  "Your Account" once a save or update succeeds. Mobile is completely
  unaffected, and a signed-out desktop visitor still sees the form
  immediately — there's no shortcut to bring it back without an account,
  so it was never hidden from them in the first place.

**Merchantrade Asia: USD and JPY now live**
- USD (standardized on the "BIG" note-denomination tier — this source
  quotes USD as three separately-priced rows by banknote size, with no
  single unqualified rate) and JPY (with an explicit x10 unit-scale
  conversion applied in the adapter — this source quotes JPY per 100
  units, every other source and this app's own convention is per 1,000)
  are now retrieved live from Merchantrade Asia instead of showing
  SIMULATED. SGD remains SIMULATED there — same denomination-tier
  ambiguity as USD had, no standard tier specified for it yet.

### Fixed

- A Web Push notification's click-through opened a GitHub 404 instead of
  the app — the payload used a root-relative URL (`/`), which a service
  worker's `clients.openWindow()` resolves against the site's origin, not
  this GitHub Pages *project* page's actual subpath. Now uses the real
  deployed URL (overridable via an optional `APP_URL` environment
  variable for anyone who forks/redeploys this repo elsewhere).
- The installed app's home-screen label was originally too long to
  display cleanly on an iOS icon ("MY Currency Rate Tracker" truncated
  visually) — shortened to "MY Rate Tracker" for both the manifest's
  `short_name` and iOS's `apple-mobile-web-app-title`. The browser-tab
  `<title>` is deliberately unchanged and still shows the full name.
- An already-installed app's service worker could keep serving stale
  CSS/JS after a deploy for up to ~24 hours (the browser's own update-
  check throttle), since the shell cache version wasn't being bumped on
  every frontend change — every change to a cached file now bumps
  `CKM_SHELL_CACHE`, and the service worker also proactively checks for
  an update on every page load rather than waiting on that throttle.

## [1.0.0] — 2026-08-26

First tagged release. Everything below is real and live-verified against
the actual services, not a demo — see "What's real vs. simulated" in the
README for exactly what that means per feature.

### Added

**Live rate monitoring**
- Real, live-scraped exchange rates from 4 Malaysian money changers: My
  Money Master, Taj Muhabath (with branch selection), Merchantrade Asia,
  and Jalinan Duta.
- 12 supported currencies: USD, SGD, EUR, GBP, AUD, JPY, THB, KRW, CNY,
  HKD, VND, TWD — with an architecture that lets a new currency work
  automatically at any source whose live page already lists it, no manual
  per-currency verification step required.
- A "best rate across your selected sources" comparison engine that always
  prefers a real reading over a simulated one when both exist for the same
  alert, never lets a fabricated number silently win.
- An additional sanity check against Bank Negara Malaysia's free public
  reference rate, catching decimal-placement/unit-scaling errors a static
  range check alone might miss.
- Rate history charts, backed by real historical data once signed in.

**Alerts**
- Target-rate alerts with configurable BUY/SELL rate type, condition (at
  or below / above / % change), and monitoring interval (5/10/15/30 min).
- A recurring backend schedule (GitHub Actions, every 5 minutes) that
  evaluates every active alert independent of any open browser tab.
- Honest LIVE / SIMULATED / STALE / SOURCE_UNAVAILABLE labeling everywhere
  a rate is shown — never displays fabricated data as if it were live.

**Notifications**
- Email (via Resend) and Telegram (via the Bot API), sent by the
  scheduled backend job the moment a target is reached.
- Real Web Push — a native OS notification that arrives even with the
  browser fully closed, via a service worker + VAPID keys + server-side
  delivery, distinct from the in-tab-only browser notification.
- Any combination of channels can be selected per alert and all fire
  together; every delivery attempt is honestly recorded as DELIVERED or
  FAILED (with a reason), never optimistically assumed.
- All "Time:" timestamps shown in notifications are in Malaysia local
  time (UTC+8), regardless of which timezone the backend happens to run
  in.

**Accounts and multi-user support**
- Supabase-backed sign-up/sign-in (email + password, with password reset),
  and per-user saved alerts isolated by Postgres Row-Level Security —
  live-tested across separate accounts to confirm one user can never see
  or modify another's alerts.

**Hosting**
- Public static frontend on GitHub Pages, deployed via GitHub Actions
  (no build step).

### Fixed

- The best-rate picker could select a simulated reading over a real one
  purely by chance when an alert mixed sources with and without real
  currency support, causing an incorrect SIM badge and, in principle, a
  false client-side alert — now real readings are always preferred
  whenever at least one exists.
- Notification "Time:" lines showed the sending server's own timezone
  (UTC on GitHub Actions) instead of Malaysia time — now always formatted
  explicitly as Malaysia local time across every channel.
- A "browser" channel notification row used to show a misleading
  `PENDING` delivery status that would never resolve — now correctly
  shown as `NOT_APPLICABLE` (this channel has no server-side delivery by
  design).

### Known limitations

- The recurring schedule runs every 5 minutes — an individual alert can
  never be checked more often than that, only less (per its own interval).
- WhatsApp/SMS delivery is out of scope for this release.
- No PWA install/offline support — the service worker exists solely to
  receive push notifications.
- Some sources' Terms of Use pages could not be directly fetched and
  verified (technical limitation, documented in the README's Compliance
  note) — nothing found prohibits automated access, but this is stated
  plainly rather than overstated.
