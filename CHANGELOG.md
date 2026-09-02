# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/).

This file starts at v1.0.0. Everything before that was iterative
development (~40 numbered "phases," each addressing one requested feature
or bug fix) — that detailed build history still exists in this repo's git
log and commit messages if you need it, but isn't repeated here entry by
entry. This file tracks releases going forward.

## [Unreleased]

### Fixed

**My Money Master permanently showed UNAVAILABLE despite the backend successfully retrieving its rate**

- Root cause: the branch dropdown added for UI consistency (see "My Money
  Master's branch field is now clearly cosmetic" below) fed its cosmetic
  branch value ("Mid Valley Megamall") into the same lookup used for real
  branch-aware sources, which matches Supabase rows by exact branch. My
  Money Master's adapter has always stored `branch: null` (its real site
  has no branches), so the lookup could never find the row the backend had
  just successfully written -- confirmed live via GitHub Actions logs
  showing `status=LIVE validationStatus=PASSED` for My Money Master on
  every run, while the dashboard simultaneously showed it as UNAVAILABLE.
  `activeSourceList()` and `computeAlertReading()` in `frontend/app.js` now
  look up (and match) any `branchIsCosmetic` source using `branch: null`,
  regardless of what's shown in its (disabled) dropdown.

**Admin page could silently fail to open, showing the dashboard instead with no error**

- `frontend/sw.js`'s service worker treated every same-origin navigation
  identically: on success it cached the response under one hardcoded key
  ('index.html'), and on ANY fetch failure it fell back to that same
  cached entry -- so a transient hiccup while navigating to `admin.html`
  could silently serve the cached dashboard at the `/admin.html` URL, with
  no visible error. Confirmed live: a fresh fetch of `admin.html` from
  within the wrongly-loaded page succeeded immediately (proving hosting
  was fine), and a plain reload fixed it. Only the true shell entry page
  (`index.html` / `/`) now gets this cache-and-fallback treatment; every
  other navigation is left alone, so a genuine failure shows the browser's
  own error instead of a different page's content.

**Admin panel's `admin-users` Edge Function returned a misleading 401 "Invalid or expired session"**

- Reported live even when the caller's session token had many minutes
  left before expiring -- the function's `admin.auth.getUser(jwt)` check
  was failing for some other reason (most likely a stale/mismatched
  `SERVICE_ROLE_KEY` or `SUPABASE_URL` Edge Function secret, e.g. left
  over from this project's Aug-2026 API key rotation), but every possible
  failure reason was silently swallowed and reported as the exact same
  "sign in again" message, with nothing logged anywhere to tell them
  apart. `supabase/functions/admin-users/index.ts` now (1) retries the
  check once after a short delay, ruling out a one-off network blip
  before it's ever treated as a real failure, and (2) logs the actual
  error (message/status/code) so it shows up in the function's own
  Supabase Dashboard logs. **Note:** this makes the true cause
  diagnosable and rules out transient network errors, but if the root
  cause turns out to be a stale secret, actually fixing it requires
  re-setting that secret in the Supabase project -- see ADMIN_SETUP.md's
  Troubleshooting section for the exact steps; this repo has no way to do
  that on its own.

### Added

**My Money Master's branch field is now clearly cosmetic**

- Its label reads just "My Money Master" instead of "My Money Master
  branch", and the dropdown itself is now permanently disabled (it
  already only ever offered one option, "Mid Valley Megamall") -- signed
  in or not. This makes it visually obvious there's nothing to actually
  select, matching the underlying reality: the real site has no branch
  selection at all.

**"Build Your Alert" now locks for signed-out visitors**

- A signed-out visitor now sees the "Build Your Alert" form showing only
  its default settings (CNY SELL, target 60.50, all 5 money changers
  checked, "Rate reaches or falls below target", every 5 minutes, Email
  notifications) -- every field is disabled and cannot be changed until
  they sign in. "Start monitoring" and "Reset alert" still work, so a
  signed-out visitor can preview monitoring with these defaults; they just
  can't customize currency, target rate, money changers, branches,
  condition, interval, or notification method without an account.
- All 5 money changers (My Money Master, Taj Muhabath, Merchantrade Asia,
  Jalinan Duta, Wawasan Ilham) now default to checked -- previously
  Jalinan Duta and Wawasan Ilham launched unchecked ("opt-in until it's
  earned some track record").

**Merchantrade Asia is now branch-aware**

- A real "Select Branch" control was found live on Merchantrade Asia's own
  exchange-rate page during a fresh check of both remaining non-branch
  money changers (My Money Master and Merchantrade Asia) — confirmed to
  genuinely change the Counter Exchange Rates table's numbers (e.g. CNY
  sell 61.60 at Pavilion KL vs 60.55 at The Gardens Mall KL, checked live
  across all 14 branches). Merchantrade Asia now gets the same branch
  dropdown treatment as Taj Muhabath, Wawasan Ilham, and Jalinan Duta,
  defaulting to Pavilion KL (the live page's own default). My Money Master
  was re-checked the same way and confirmed to still have no branch
  selection at all — it stays a single site-wide rate.
- Under the hood, the adapter's primary extraction path switched from
  Playwright DOM-scraping to a direct call to the same JSON endpoint the
  live page's own branch selector calls — simpler and no browser required
  — with the old Playwright approach kept as a defensive fallback.

### Changed

**Branch selection moved inline, directly under its money changer**

- Each branch-aware money changer's (Taj Muhabath, Wawasan Ilham, Jalinan
  Duta, and now Merchantrade Asia) branch dropdown now renders immediately
  under that money changer's own checkbox in the "Build Your Alert" form,
  appearing the instant it's checked and disappearing when unchecked.
  Previously all branch dropdowns were grouped together in one shared
  block lower down the form, separated from the checkboxes they belonged
  to.

**My Money Master now shows a branch dropdown too — UI consistency only**

- My Money Master's checkbox now gets the same branch dropdown treatment
  as the other 4 money changers, always showing its one real address
  ("Mid Valley Megamall") as the sole option. This is a frontend-only,
  cosmetic change requested for visual consistency across the form — it
  does **not** reflect real per-branch data. My Money Master's live site
  still has no branch selection at all (one address, one site-wide rate,
  re-confirmed live during the Merchantrade Asia investigation above), and
  nothing about the actual scrape, validation, or comparison logic
  changed: `backend/scrapers/mymoneymaster.adapter.js` and
  `config/websites/mymoneymaster.json` (`branchSupport: false`) are both
  untouched.

## [3.0.0] — 2026-09-02

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

**Admin Module — notify the admin on every new signup (optional)**
- A new Supabase Edge Function (`supabase/functions/notify-admin-signup`),
  triggered directly off `auth.users` INSERTs via a database trigger +
  `pg_net`, emails and/or Telegram-messages one configured admin contact
  within seconds of any new signup — not on a delay from the 5-minute
  scheduler.
- The webhook URL and its shared authentication secret are stored in
  Supabase Vault, never committed to this repo.
- Fails safe: a problem anywhere in the notification path (missing config,
  network error, the function itself being down) can never block or fail
  the actual signup.
- Fully optional — everything else in the Admin Module works with or
  without this set up. See `ADMIN_SETUP.md` Step 5 for the walkthrough.

**Live rates**
- Merchantrade Asia's SGD is now live (previously SIMULATED): the site
  splits SGD into two note-denomination tiers with no single obvious
  rate, same ambiguity USD had until Phase 44 — the project owner picked
  BIG as the standard tier, same as USD.

**New money-changer source & branch selection**
- Wawasan Ilham is now a fully live source (previously investigated but
  not built) — its rate table requires a branch to be selected first, so
  it ships with branch selection using the same pattern as Taj Muhabath.
  Confirmed live via `checkRate.js wawasanilham CNY` (`LIVE`/`PASSED`) and
  cross-checked against the project owner's own screenshots of the live
  site.
- Jalinan Duta also gained branch selection (Bukit Bintang / Masjid
  India / Nu Sentral), each confirmed to publish genuinely different
  rates.
- Alerts can now select more than one branch-aware source at once, each
  keeping its own branch choice — previously the app only stored a single
  shared branch value, which would have silently misapplied one source's
  branch name to another. Alerts now store a `branches` map instead of one
  `branch` value; requires the `database/schema.sql` migration to be run
  before this release is deployed.

### Fixed

**Branch dropdown missing for every source after the Phase 52 deploy (02-Sep-2026)**
- After the per-source branch selection release (see above), the custom
  domain briefly served a stale cached `app.js` (still built around the
  old single `<select id="branch">` element) alongside the newly deployed
  `index.html` (which had already replaced that element with
  `#branchFieldsContainer`). The mismatch threw `Cannot set properties of
  null` while loading any saved alert, which silently broke the branch
  dropdown for every money changer — Taj Muhabath included, not just the
  two newly branch-aware sources — until each visitor's browser cache
  happened to expire.
- Fixed structurally, not just by waiting it out: `.github/workflows/pages.yml`
  now runs `.github/scripts/cache_bust_frontend.py` before every deploy,
  appending a `?v=<git-sha>` suffix to every local script/stylesheet URL in
  `frontend/*.html`. A URL the browser has never cached before is always
  fetched fresh, so `index.html` and its scripts can never again be served
  as a mismatched pair from two different deploys.

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
- **Same anti-pattern, found and fixed in two more places on a full
  codebase sweep prompted by the fix above.** After the currency-support
  duplication was eliminated, a repo-wide search for the same "keep two
  copies in sync by hand" pattern turned up two more genuine instances,
  both already flagged in code comments as risks but never actually
  fixed:
  - `backend/validation/bnmCrossCheck.js`'s `ADAPTER_CURRENCY_UNIT` map
    (the per-currency denomination each money changer's rates are quoted
    in — e.g. CNY per 100, JPY per 1,000, VND per 1,000,000) was its own
    hand-typed object literal, independently "matching" a convention
    that `frontend/app.js` and every `config/websites/*.json` adapter's
    notes only ever described in prose, never enforced in code. Now
    lives in `frontend/currencySupport.js`'s new `CURRENCY_UNIT` export.
  - `backend/scheduler/run.js`'s `SOURCE_DISPLAY_NAMES` map (money
    changer id → display name, e.g. `jalinanduta` → `"Jalinan Duta"`)
    duplicated `frontend/app.js`'s `SOURCES` array by hand. A drift here
    wouldn't have broken monitoring the way the currency-support bug
    did, but it would have shown a raw internal id instead of a real
    name in an actual alert a user receives. Now lives in a new
    `frontend/sourceNames.js`.
  - Also found: `formatMalaysiaTime()`, the Malaysia-timezone formatter
    used in every notification's "Time:" line, was defined twice —
    once in `backend/notifications/notify.js`, once in `frontend/app.js`'s
    `fireAlert()` — byte-for-byte identical on purpose, with both
    copies' comments explicitly citing "no shared module system between
    frontend and backend" as the reason a shared version wasn't
    possible. That reasoning stopped being true the moment
    `frontend/currencySupport.js` was built. Now lives in a new
    `frontend/timeFormat.js`, required by `notify.js` and loaded via
    `<script>` by `app.js` — the exact same function reference in both,
    not just matching output (verified directly: `notify.formatMalaysiaTime
    === require('./frontend/timeFormat.js').formatMalaysiaTime` is `true`).

  All three follow the same shape as the currency-support fix: one file
  in `frontend/` (the only directory GitHub Pages actually publishes),
  loaded via a `<script>` tag by the browser and via `require()` by
  Node, so there's no second copy left anywhere to drift out of sync.
  `tests/bnmCrossCheck.test.js`'s own "must match" test had the identical
  blind spot as the old `comboSelection.test.js` test — it compared
  `ADAPTER_CURRENCY_UNIT` against a literal pasted into the test file,
  never actually reading the shared source — and has been fixed the same
  way. A new `tests/sharedModules.test.js` covers the two new files.
  Full test suite verified green: 133/133 (128 previous + 5 new).

**Correct official-site default branches everywhere, and a one-time data migration (Phase 53)**
- Every branch-aware source's branch dropdown now defaults to that
  source's own real official live-site default branch (the one already
  pre-selected if you open the site yourself and never touch its branch
  selector) the first time its checkbox is checked, or when a saved alert
  is loaded without its own explicit choice for a source it has selected
  -- previously Taj Muhabath defaulted to a different branch
  ("LALAPORT BBCC") chosen deliberately back in Phase 3 to exercise the
  branch-selection code path in CI, not the site's own natural default
  ("THE EXCHANGE TRX").
- One-time migration: every existing saved alert's branch-aware sources
  were reset to their real official default in the database
  (`database/schema.sql`'s Phase 53 block) -- `tajmuhabath` to
  "THE EXCHANGE TRX", `wawasanilham` to "NSK Trade City, Kuchai Lama",
  `jalinanduta` to "Bukit Bintang" -- so every pre-existing alert now
  shows and monitors the same branch a fresh alert would default to.

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
