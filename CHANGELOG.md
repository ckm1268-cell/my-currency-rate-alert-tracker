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
