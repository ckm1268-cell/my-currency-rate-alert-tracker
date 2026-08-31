# MY Currency Rate Tracker

**v2.0.0** — Real-time currency exchange-rate monitoring and target-rate
alerts for Malaysian money changers. Not a converter — this proves, with a
timestamp, whether the live rate at a chosen money changer has reached your
target *right now*, and alerts you the moment it does. Installs as a free
mobile app (PWA) on Android and iOS in addition to the browser dashboard.

**Live:** https://app.mycurrencyalerts.abrdns.com/
(also reachable at the original https://ckm1268-cell.github.io/my-currency-rate-alert-tracker/ — GitHub Pages serves both, but the custom domain is what's shared with users.)

See `CHANGELOG.md` for the full v2.0.0 feature list and the project's
build history.

## What this does

1. You pick a currency, a BUY/SELL rate type, a target rate, and one or
   more money changers to watch.
2. A scheduled backend job opens each money changer's real live webpage
   (browser automation, not a search snippet or a cached page), reads the
   actual rendered rate, and validates it.
3. It compares the best available rate across your selected sources
   against your target.
4. The moment the target is reached, you get notified — by email,
   Telegram, real push notification (works even with your browser fully
   closed), and/or an in-tab browser alert if you have the dashboard open
   — any combination at once.

Every rate shown is honestly labeled **LIVE**, **SIMULATED**, **STALE**, or
**SOURCE UNAVAILABLE**. Nothing is ever shown as live unless it was
actually retrieved from the real site within the freshness window — see
"What's real vs. simulated" below.

## Money changers

| Source | Status |
|---|---|
| **My Money Master** | ✅ Live |
| **Taj Muhabath** | ✅ Live, with branch selection |
| **Merchantrade Asia** | ✅ Live |
| **Jalinan Duta** | ✅ Live |

Each source has its own adapter (`backend/scrapers/*.adapter.js`) and
config file (`config/websites/*.json`) documenting the exact URL,
selectors, and wait strategy — all captured by directly inspecting the
live rendered page, never guessed. Adding a 5th source means adding one
adapter + one config file, without touching the scheduler, validation, or
target-comparison logic.

A few other money changers were investigated on request and not added —
see `NEW_SOURCES_INVESTIGATION.md` for exactly why (a `403 Forbidden`, a
non-resolving domain, a parked domain, an empty "Coming Soon" page, or a
dynamic widget with no inspectable selectors to build against). None of
these are guesses — every exclusion has a documented, live-checked reason.

## Currency coverage

12 currencies: **USD, SGD, EUR, GBP, AUD, JPY, THB, KRW, CNY, HKD, VND,
TWD.**

A currency is real/LIVE at a given source only when that source's own live
page actually lists it — Taj Muhabath, Jalinan Duta, and My Money Master
all match by ISO currency code directly (so any code any of those three
sites' live table lists just works, automatically — this is how My Money
Master picked up VND/THB/KRW/TWD support in Phase 42, once its adapter
moved to the site's full ~40-currency rate-board page), while Merchantrade
Asia matches by the site's own display-name text (so a new currency there
needs one config-file line added once that text is confirmed on the live
page). A currency/source combination with no real support is clearly
labeled SIMULATED, never silently faked as live — see `frontend/app.js`'s
`hasRealAdapter()` for the full logic.

VND and TWD are quoted per a specific unit denomination rather than per 1
unit (VND per 1,000,000, TWD per 100; also THB/HKD/CNY per 100 and JPY/KRW
per 1,000) — the currency dropdown's labels spell this out, and every
simulated fallback is scaled to match so a multi-source comparison never
mixes units.

## Notifications

| Channel | How it's delivered |
|---|---|
| **Browser** | In-tab only — `new Notification(...)`, fires while the dashboard tab is open. No setup needed. |
| **Email** | Via Resend, sent by the scheduled backend job. See `NOTIFICATIONS_SETUP.md`. |
| **Telegram** | Via the Bot API, sent by the scheduled backend job. See `NOTIFICATIONS_SETUP.md`. |
| **Push** | Real Web Push — a native OS notification delivered by the scheduled backend job even with your browser fully closed. See `PUSH_SETUP.md`. |

Any combination can be selected per alert; all selected channels fire
together the moment a target is reached. Every delivery attempt is
recorded honestly as `DELIVERED` or `FAILED` (with a reason) in the
`notifications` table — never optimistically assumed. All notification
timestamps are shown in Malaysia local time (UTC+8), regardless of which
timezone the backend happens to be running in.

## Accounts (optional)

The dashboard works fully signed out — you can build and watch an alert in
this browser tab without an account. Signing in (your own email + a
password you set) additionally lets you save alert configurations to your
account, isolated from every other user by Postgres Row-Level Security —
see `database/schema.sql`. This requires a Supabase project, which you
provision yourself — see `SUPABASE_SETUP.md` for the full walkthrough.
Until that's done, the account card just shows a "not configured yet"
notice and nothing else on the page is affected.

## Admin Module (v3)

A **Super User** account can bulk-disable, bulk-re-enable, and bulk-delete
other users' accounts from a dedicated page, `admin.html` — reached via a
"🛡️ Admin" link that appears in the topbar automatically once you're signed
in with an admin account. There's no hardcoded admin email list: whether an
account is a Super User is a `role` column on a `profiles` table, promoted
by hand with one SQL statement. Every disable/enable/delete runs through a
Supabase Edge Function (`supabase/functions/admin-users`) using its own
service-role secret — this can't be done from the static frontend alone, the
same reason the recurring rate check runs as a scheduled backend job rather
than in the browser. Optionally, a second Edge Function
(`supabase/functions/notify-admin-signup`) emails and/or Telegram-messages a
configured admin contact within seconds of any new signup, triggered
directly off `auth.users` via a database trigger + `pg_net` — not the
5-minute scheduler. See `ADMIN_SETUP.md` for the full setup walkthrough of
both.

## Install as a mobile app (Android & iOS) — free, no app store

The dashboard installs directly to a phone's home screen as a Progressive
Web App — same live data, same alerts, its own icon, opens full-screen
with no browser address bar. No app-store account, review, or fee. See
`MOBILE_APP_SETUP.md` for install steps on both platforms and the one
extra step iOS needs before Push notifications work there.

## Try it

Open `frontend/index.html` directly in a browser, or serve the folder:

```bash
cd frontend
python3 -m http.server 8080
# then open http://localhost:8080
```

No build step — the frontend is plain HTML/CSS/JS.

## Repository structure

```
my-currency-rate-alert-tracker/
├── frontend/                  # GitHub Pages site — static, no secrets
│   ├── index.html
│   ├── admin.html             # Admin Module (v3) — Super User bulk user management
│   ├── admin.js
│   ├── admin.css
│   ├── styles.css
│   ├── app.js                 # core dashboard logic, live/simulated reading pipeline
│   ├── auth.js                # sign-in + saved alerts UI
│   ├── rateHistory.js         # real Supabase-backed history chart
│   ├── push.js                # Web Push subscribe/unsubscribe flow
│   ├── sw.js                  # service worker — app shell cache + push events (see MOBILE_APP_SETUP.md)
│   ├── supabaseConfig.js      # your project URL + anon key (safe to commit)
│   └── pushConfig.js          # your VAPID public key (safe to commit)
├── backend/                   # never deployed to GitHub Pages
│   ├── scrapers/               # one adapter per money changer
│   ├── validation/              # rate sanity checks + BNM cross-check
│   ├── targetEngine/           # target-comparison engine
│   ├── notifications/          # notify.js (dispatcher) + email.js + telegram.js + webpush.js
│   ├── scheduler/              # the real scheduled job (run.js) + its pure helpers
│   ├── reference/              # Bank Negara Malaysia reference-rate client
│   └── db/                    # Supabase service-role client (backend-only)
├── database/
│   └── schema.sql             # tables, RLS policies, and every migration in order
├── supabase/functions/        # Edge Functions — server-side code with access to secrets
│   ├── admin-users/           # Admin Module (v3): bulk disable/enable/delete via the Auth Admin API
│   ├── notify-admin-signup/   # Admin Module: emails/Telegrams the admin on every new signup
│   └── _shared/cors.ts
├── config/websites/           # per-source URLs, selectors, wait strategy
├── .github/workflows/
│   ├── pages.yml               # deploys frontend/ to GitHub Pages on every push to main
│   └── monitor.yml             # the recurring 5-minute scheduled alert check
├── tests/
├── .env.example
├── SUPABASE_SETUP.md          # provisioning walkthrough
├── NOTIFICATIONS_SETUP.md     # Resend + Telegram walkthrough
├── PUSH_SETUP.md              # VAPID key generation + GitHub secrets walkthrough
├── MOBILE_APP_SETUP.md        # PWA install walkthrough
├── ADMIN_SETUP.md             # Admin Module (v3) walkthrough
├── NEW_SOURCES_INVESTIGATION.md
├── CHANGELOG.md
└── LICENSE
```

## Deploying the frontend to GitHub Pages

This repo deploys via **GitHub Actions**, not "Deploy from a branch" — the
branch-deploy source only offers `/ (root)` or `/docs` as the published
folder, not `/frontend`, so Actions is the only way to publish this
repo's layout without moving files around.

`.github/workflows/pages.yml` runs automatically on every push to `main`,
plus on demand via the Actions tab. It checks out the repo, uploads
`frontend/` as the Pages artifact, and deploys it — no build step.

To set this up on a fresh fork/clone:

1. Push this folder's contents to your own **public** GitHub repository.
2. In the repo, go to **Settings → Pages** and set **Source** to
   **"GitHub Actions"**.
3. `pages.yml` runs on the next push, or trigger it manually from the
   **Actions** tab → "Deploy GitHub Pages" → "Run workflow".
4. GitHub publishes it at `https://<your-username>.github.io/<your-repo>/`
   within a minute or two.

## The recurring schedule and compliance

`.github/workflows/monitor.yml` runs every 5 minutes, checking every
active alert whose own monitoring interval has elapsed since it was last
checked (an alert can be checked *less* often than 5 minutes via its own
interval setting, never more). Before this was turned on, each source's
Terms of Use and `robots.txt` were checked as far as tooling allowed:

- **Merchantrade Asia** — Terms & Conditions page was fetched and read;
  no clause addressing automated access was found; `robots.txt` explicitly
  allows the page this app reads.
- **My Money Master** — no `robots.txt` restriction exists, but its Terms
  of Use page could not be fetched by the tooling used for this review
  (a broken HTTPS redirect a browser follows fine but an automated fetch
  couldn't) — genuinely unread.
- **Taj Muhabath** — no public Terms of Use page could be located at all
  — genuinely unread.

In short: nothing found says "don't automate this," but two of the three
sites' Terms of Use text was never actually read, for reasons outside the
tooling's control — stated plainly rather than overstated. If you want to
revisit this, comment the `schedule:` block back out in `monitor.yml` (the
manual "Run workflow" trigger stays available either way).

## What's real vs. simulated in this build

- **Real:** live rates from all 4 money changers listed above, for every
  currency each site's own live page actually lists — retrieved by
  browser automation, validated, and cross-checked against Bank Negara
  Malaysia's free reference rate as an additional sanity layer.
- **Real:** account sign-in, saved per-user alerts, and their isolation —
  enforced by the database itself (Row-Level Security), not just the UI.
- **Real:** server-side target evaluation on a recurring 5-minute
  schedule, independent of any open browser tab.
- **Real:** email, Telegram, and Web Push delivery, with every attempt
  honestly recorded as delivered or failed.
- **Simulated:** any currency/source combination that source's live page
  doesn't actually list — always labeled SIMULATED, never shown as live.
- **Not built:** WhatsApp/SMS delivery, and any PWA behavior beyond
  receiving push events (no offline support, no install prompt).

## Environment variables

See `.env.example`. `SUPABASE_URL` / `SUPABASE_ANON_KEY` go in
`frontend/supabaseConfig.js`, not `.env` — see `SUPABASE_SETUP.md`.
`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `TELEGRAM_BOT_TOKEN`, and
`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` are backend/GitHub
Actions secrets only — never committed, never referenced in `frontend/`.
See `NOTIFICATIONS_SETUP.md` and `PUSH_SETUP.md` for how to obtain each.

## Tests

112 tests across 14 files — see `tests/README.md` for what each covers.
Run with `node --test tests/` from the repo root, or `npm test` from
`backend/`.

## License

MIT — see `LICENSE`.
