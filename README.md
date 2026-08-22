# MY Currency Rate Tracker

Real-time currency exchange-rate monitoring and target-rate alerts for
Malaysian money changers. Not a converter — this proves, with a timestamp,
whether the live rate at a chosen money changer has reached your target
*right now*, and alerts you the moment it does.

Initial scope: **CNY/MYR, SELL rate**, from **My Money Master**,
**Taj Muhabath**, and (added 22-Aug-2026) **Merchantrade Asia**.
Architecture supports adding more currencies, branches, and sources
without a redesign — Merchantrade Asia is itself proof of that: it was
added after the original Phase 1-10 build without touching the scheduler,
validation, or target-comparison logic, only adding its own adapter +
config file and a few registration lines (see the "Money changers" section
below).

## Current status: Phase 10 of 10

| Phase | What | Status |
|---|---|---|
| 1 | Repo scaffold, dashboard UI on simulated data, deployed to GitHub Pages | ✅ live |
| 2 | My Money Master live retrieval | ✅ live (CNY SELL/BUY) |
| 3 | Taj Muhabath live retrieval | ✅ live (CNY SELL/BUY, branch: LALAPORT BBCC) |
| 4 | Rate validation wired into adapters | ✅ done for both adapters (`backend/validation/validateRate.js`) |
| 5 | Target comparison engine wired to real data | ✅ done — `isTargetMet` (`frontend/app.js`) operates on real readings; `backend/targetEngine/compareTarget.js` is the tested server-side twin, now actually called by Phase 8's scheduler |
| 6 | Browser notifications wired to real alerts | ✅ live-tested end-to-end against a real trigger, not just read-through |
| 7 | Supabase (DB, auth, multi-user) | ✅ schema + RLS + email/password sign-up + log-in + password reset + per-user saved alerts — **live-tested end-to-end**, including a real cross-account isolation check across three separate accounts (see `SUPABASE_SETUP.md`) |
| 8 | Scheduled backend job (Supabase-backed) | ✅ implemented and **live-tested successfully** — `backend/scheduler/run.js` (wired into `.github/workflows/monitor.yml`) fetches every ACTIVE alert, checks both adapters, writes to the `rates` table, evaluates each alert against the **best rate across its selected sources**, and marks it TRIGGERED + logs a `notifications` row the moment a target is met — no browser tab required. As of Phase 14 this runs on a **recurring 5-minute schedule**, not just a manual click — see that row below and the Compliance note. |
| 9 | Full test pass | 🟡 partial — unit tests for all three adapters' parsing logic, the target-comparison engine, the scheduler's pure combo-selection, notify-target-resolution, and due-for-check logic, and the notification-message formatting all exist and pass (69/69, updated 22-Aug-2026 with the Phase 14 due-for-check tests); no end-to-end/multi-user automated test pass yet beyond the manual proofs recorded for Phases 7/8 |
| 10 | Email / Telegram, rate-history charts | ✅ implemented — real email (Resend) and Telegram delivery from `backend/scheduler/run.js` via `backend/notifications/notify.js` (see `NOTIFICATIONS_SETUP.md`), plus a real, Supabase-backed rate-history chart (`frontend/rateHistory.js`) for signed-in users, replacing the old session-only chart for anyone signed in. Telegram delivery has since been confirmed `DELIVERED` in a real test run; email is still blocked on Resend's sandbox-sending restriction — see `NOTIFICATIONS_SETUP.md`'s Troubleshooting section. |
| — | Merchantrade Asia live retrieval (post-Phase 10, 22-Aug-2026) | ✅ live (CNY SELL/BUY) — added on request, alongside a documented look at three other money changers that could NOT be added yet (MaxMoney: blocked by a `403 Forbidden`; Spectrum Forex: domain does not resolve; Vital Rate: parked domain, likely absorbed into Merchantrade Asia) — see the "Money changers" section below for the full findings. |
| — | Simultaneous multi-channel notifications (post-Phase 10, 22-Aug-2026) | ✅ done — the Notification field is now checkboxes, not a single dropdown: an alert can select any combination of Browser/Email/Telegram at once, and **all** selected channels fire together via `Promise.all` when the target is met (`resolveNotifyTargets()` + the notify loop in `backend/scheduler/run.js`), instead of only whichever one was picked. Requires the `notification_methods` (array) column added by the Phase 11 migration block at the bottom of `database/schema.sql` — the old singular `notification_method` column is backfilled into the array automatically, then dropped, so **this schema.sql must be re-run in Supabase's SQL Editor** for saving/sending to keep working. |
| — | Edit an existing saved alert (post-Phase 10, 22-Aug-2026) | ✅ done — each saved alert now has an **Edit** button alongside Disable/Delete. It loads that alert's exact settings back into the form (`window.CKM.loadAlertIntoForm()` in `frontend/app.js`), shows an "Editing…" banner with Cancel, and re-labels Save as **Update this alert** — clicking it does a Supabase `UPDATE` on that same row instead of creating a new one. No schema change needed. |
| 14 | Recurring schedule — the monitoring interval becomes real | ✅ done, 22-Aug-2026, **at the project owner's explicit request** — `.github/workflows/monitor.yml` now runs every 5 minutes via `schedule:`, not only on a manual click. `alerts.last_checked_at` (new column, `database/schema.sql`'s Phase 14 migration) plus `run.js`'s `isDueForCheck()` make each alert's own **Monitoring interval** dropdown actually throttle how often it's re-checked — a workflow run skips any alert whose own interval hasn't elapsed yet. A single alert can never be checked *more* often than the workflow's own 5-minute cadence, only less. See the Compliance note directly below for exactly what was (and wasn't) verified about each site's Terms of Use before this was turned on — this is a real change in how often these three real sites get automated traffic, and it deserves to be read, not just skimmed. |
| — | Interval dropdown genuinely matches real check frequency (post-Phase 14, 22-Aug-2026) | ✅ done — the **"Every 1 minute"** option was removed from the dropdown (`frontend/index.html`). GitHub Actions doesn't reliably run scheduled workflows more often than every 5 minutes no matter what cron is set, and running real checks against three live money-changer sites every single minute would also go beyond the "low, respectful frequency" compliance decision documented below. So **5 minutes is now both the default and the true floor** — every remaining option (5/10/15/30) already maps 1:1 onto real-world check frequency via `isDueForCheck()`, with no gap between what the dropdown promises and what actually happens. `database/schema.sql`'s CHECK constraint still technically permits a stored value of `1` (harmless — treated identically to 5 — and left alone to avoid a needless extra migration), it's just no longer offered in the UI. |

**CNY at all three money changers is real.** My Money Master CNY, Taj
Muhabath CNY (branch: LALAPORT BBCC), and Merchantrade Asia CNY are
retrieved live by a GitHub Actions job on every deploy — see
`backend/scripts/checkRate.js` and `.github/workflows/pages.yml`. Every
other currency, and any other Taj Muhabath branch, is still simulated by
`frontend/app.js` and always labeled SIMULATED — never LIVE, per the
project's core rule. See `config/websites/*.json` for the live-inspected
extraction plan for each source (URLs, selectors, wait strategy — verified
directly against the live sites, not guessed, and re-verified when a
site's structure changed mid-build — see the "notes" fields in those
config files for the full story of what changed and how it was caught).

### Money changers — coverage and what was ruled out (22-Aug-2026)

The user asked to add several money changers from a reference Python
script. Per this project's non-negotiable rule against guessing selectors
or trusting an unverified URL, each was independently checked live before
any adapter code was written:

| Money changer | Result |
|---|---|
| **Merchantrade Asia** | ✅ Added. URL from the script (`https://mtradeasia.com/exchange`) was correct; real CNY data confirmed live via direct browser automation; DOM structure captured and documented in `config/websites/merchantradeasia.json`. See `backend/scrapers/merchantradeasia.adapter.js`. |
| **My Money Master** | Already implemented (Phase 2). Note: the reference script used `https://www.moneymaster.com.my/` — the real, working domain is `http://www.mymoneymaster.com.my/` (confirmed live back in Phase 2; the script's URL does not resolve to the real site). No action needed beyond this note. |
| **MaxMoney** | ❌ Not added. Both `https://maxmoney.com.my/` and `https://www.maxmoney.com.my/` returned a server-level `403 Forbidden` (Apache `ErrorDocument`) on direct request, live-checked 22-Aug-2026 — this reads as an access control / anti-bot response, and per this project's compliance rules (and this assistant's own operating rules), that is not bypassed. If you have a different real URL for this money changer, or know this block is geo/IP-specific and not present from your own network, let the maintainer know and this can be re-attempted. |
| **Spectrum Forex** | ❌ Not added. `spectrumforex.com.my` does not currently resolve (confirmed NXDOMAIN via an authoritative DNS lookup, 22-Aug-2026) — there is no live site at that address to build an adapter against. If you have an updated URL for this business, it can be re-attempted. |
| **Vital Rate** | ❌ Not added. `vitalrate.com` is a parked/for-sale domain (redirects to a domain marketplace listing), not the real company. Public information indicates Vital Rate Sdn Bhd was acquired by Merchantrade Asia Sdn Bhd in 2017 and may no longer operate as an independent brand — some of its former branches (e.g. Pavilion KL) now appear as Merchantrade Asia branches on the page the new adapter above already covers. If Vital Rate still operates independently under a different real domain, share it and this can be reconsidered. |

### Currency coverage — VND and TWD added (22-Aug-2026, same day)

Requested via the dashboard's currency dropdown. Both are now selectable, and **both are real/LIVE at Merchantrade Asia** (`config/websites/merchantradeasia.json`'s `currencyDisplayNames` and `validation.expectedRange` now cover `VND` and `TWD` alongside `CNY`; no adapter code changed, since `parseHtml()` was already currency-agnostic — only the config entries were new). My Money Master and Taj Muhabath were not re-checked for VND/TWD coverage, so those two sources still simulate them if selected — same honest LIVE/SIMULATED split already used for every other non-CNY currency.

One thing worth knowing if you're reading a target rate for either: **Merchantrade Asia doesn't quote every currency per 1 unit.** CNY and TWD are per 100 units (label reads "100 CNY" / "100 TWD"), but VND is quoted per **1,000,000** units ("1000000 VND") — confirmed live, not assumed (see the `validation.notes` field in the config file). The currency dropdown's VND/TWD labels spell out the unit denomination for exactly this reason, and the simulated fallback values for both are scaled to match, so a multi-source alert comparing a simulated My Money Master reading against a real Merchantrade Asia one stays apples-to-apples.

### Compliance note (read this — `monitor.yml` now runs on a recurring schedule)

Through Phase 13, neither `pages.yml` nor `monitor.yml` ran on a cron. All
three of `config/websites/mymoneymaster.json`,
`config/websites/tajmuhabath.json`, and
`config/websites/merchantradeasia.json` flagged the same open action item:
a human should read each site's Terms of Use before this runs on a
recurring, unattended schedule. Additionally, the Taj Muhabath adapter
deliberately does NOT call the internal API endpoint its branch dropdown
uses internally (discovered during the Phase 3 build) — that endpoint
requires an authorization this adapter does not have and should not
attempt to replicate. See the header comment in
`backend/scrapers/tajmuhabath.adapter.js` for details. The MaxMoney
adapter that was NOT added (see the "Money changers" section above) is a
related example of the same principle applied at the URL-access level
rather than the API level — a `403 Forbidden` was treated as an access
control to respect, not a puzzle to work around.

**Phase 14 (22-Aug-2026): the project owner explicitly decided to turn the
schedule on**, at a modest 5-minute interval, after being told what had and
hadn't actually been checked. For the record, here's exactly what that
review found, tool limitations included, so this isn't overstated as more
thorough than it was:

- **Merchantrade Asia** — its Terms & Conditions page
  (`https://mtradeasia.com/legal/terms-and-conditions`) WAS fetched and
  read. No clause addressing automated access, scraping, bots, or
  crawlers was found. `robots.txt` explicitly allows the `/exchange` page
  (see that config file's `compliance` block).
- **My Money Master** — no `robots.txt` restriction exists (404). Its
  Terms of Use page (`/Home/policy`) could NOT actually be fetched: the
  site has no working HTTPS (`https://` redirects back to `http://`, which
  the fetching tool used for this review can't follow — a real technical
  limitation, not a skipped step). Genuinely unread.
- **Taj Muhabath** — no public Terms of Use page could be located at all;
  the site only exposes a Privacy link and a registration-gated "terms"
  reference reachable after signing up. Genuinely unread.

In short: nothing found says "don't automate this," but two of the three
sites' actual Terms of Use text was never read, for reasons outside the
tooling's control. If you're the project owner reading this later and want
to revisit that decision — tighten the interval, pause it, or actually get
eyes on those two remaining pages (e.g. open `http://www.mymoneymaster.com.my/Home/policy`
directly in a browser, since a browser follows that redirect fine even
though the automated fetch tool couldn't) — comment the `schedule:` block
back out in `.github/workflows/monitor.yml` (the `workflow_dispatch:`
manual trigger stays available either way) and it goes back to manual-only
immediately.

### Accounts (Phase 7 — optional)

The dashboard works fully without signing in, exactly as it did in Phases
1-6. Signing in (your own email address + a password you set — "Forgot
password?" is supported too) additionally lets you save your current alert
configuration to your own account, isolated from every other user by
Postgres Row-Level Security — see `database/schema.sql`. Credentials are
never stored in this repo — Supabase Auth hashes and stores each password
server-side (see `SUPABASE_SETUP.md`'s "why email + password instead of a
login table in the repo" note). This
requires a Supabase project, which you provision yourself; **see
`SUPABASE_SETUP.md` for the full step-by-step walkthrough.** Until that's
done, the account card on the dashboard shows a small "not configured yet"
notice and nothing else on the page is affected.

## Try it

Open `frontend/index.html` directly in a browser, or serve the folder:

```bash
cd frontend
python3 -m http.server 8080
# then open http://localhost:8080
```

No build step, no dependencies for the frontend in this phase.

## Repository structure

```
currency-rate-alert/
├── frontend/                 # GitHub Pages site — static, no secrets
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── auth.js                # Phase 7 — sign-in + saved alerts UI, additive to app.js
│   ├── rateHistory.js         # Phase 10 — real Supabase-backed history chart, additive to app.js
│   └── supabaseConfig.js      # Phase 7 — your project URL + anon key (safe to commit)
├── backend/                  # Phase 2+ — never deployed to GitHub Pages
│   ├── scrapers/              # one adapter per money changer
│   ├── validation/
│   ├── targetEngine/
│   ├── notifications/          # Phase 10 — notify.js (dispatcher) + email.js (Resend) + telegram.js (Bot API)
│   ├── scheduler/              # Phase 8 — the real scheduled job (run.js) + its pure combo-selection helpers
│   └── db/                    # Supabase service-role client (backend-only)
├── database/
│   └── schema.sql             # Phase 7 tables + RLS; Phase 10 adds telegram_chat_id / delivery_error columns
├── config/websites/          # per-source URLs, selectors, wait strategy
├── .github/workflows/         # scheduled monitor (currently manual-trigger only)
├── tests/
├── .env.example
├── SUPABASE_SETUP.md          # Phase 7 — provisioning walkthrough
├── NOTIFICATIONS_SETUP.md     # Phase 10 — Resend + Telegram walkthrough
└── LICENSE
```

## Deploying the frontend to GitHub Pages

**Live now:** https://ckm1268-cell.github.io/my-currency-rate-alert-tracker/

This repo deploys via **GitHub Actions**, not "Deploy from a branch". That
matters because GitHub's branch-deploy source only lets you pick `/ (root)`
or `/docs` as the published folder — it does **not** offer `/frontend` as an
option (this was tested directly in the Pages settings UI; the folder
dropdown returns "No results found" for anything else). Since this repo
keeps `frontend/` as its own top-level folder, GitHub Actions is the only
source that can publish it without moving files around.

The workflow lives at `.github/workflows/pages.yml` and runs automatically
on every push to `main`, plus on demand via the Actions tab ("Run workflow").
It checks out the repo, uploads `frontend/` as the Pages artifact, and
deploys it — no build step, since the frontend has none.

To set this up on a fresh fork/clone:

1. Push this folder's contents to your own **public** GitHub repository:
   ```bash
   git init
   git add .
   git commit -m "Phase 1: repo scaffold + dashboard UI on simulated data"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```
2. In the repo, go to **Settings → Pages** and set **Source** to
   **"GitHub Actions"** (not "Deploy from a branch").
3. The `pages.yml` workflow (already in `.github/workflows/`) will run on
   the next push, or trigger it manually from the **Actions** tab →
   "Deploy GitHub Pages" → "Run workflow".
4. GitHub will publish it at `https://<your-username>.github.io/<your-repo>/`
   within a minute or two. Check the **Actions** tab for build status.

## What's real vs. simulated in this build

- **Real:** the UI, the form validation, the target-comparison logic
  (`isTargetMet` in `frontend/app.js`), the duplicate-alert-suppression
  logic, the multi-source "best rate" comparison, the rate-validation
  sanity checks, the responsive/mobile layout, the adapter configuration in
  `config/websites/*.json` (URLs and selectors were captured by directly
  inspecting the live sites, not guessed) — **and, as of Phase 3 (My Money
  Master + Taj Muhabath) and again as of 22-Aug-2026 (Merchantrade Asia),
  the CNY rate itself from all three sources**, retrieved live by
  `backend/scrapers/mymoneymaster.adapter.js`,
  `backend/scrapers/tajmuhabath.adapter.js`, and
  `backend/scrapers/merchantradeasia.adapter.js`, validated, and published
  to `frontend/data/latest-rates.json` on every deploy.
- **Simulated:** every other currency, and any Taj Muhabath branch other
  than LALAPORT BBCC. `frontend/app.js` generates these with a small random
  walk around realistic starting values and always labels them SIMULATED —
  never LIVE, per the project's core rule.
- **Real, confirmed live (Phase 7):** account sign-in, saved per-user
  alerts, and their isolation — enforced by the database itself
  (`database/schema.sql`'s Row-Level Security policies), not just by the
  UI. Live-tested end-to-end, including cross-account isolation across
  three separate accounts. See `SUPABASE_SETUP.md`.
- **Real, as of Phase 8:** a saved alert's target condition IS evaluated
  server-side — independent of any open browser tab — by
  `backend/scheduler/run.js`, using the best rate across the alert's
  selected sources. It marks the alert TRIGGERED and logs a
  `notifications` row the moment a target is met. The gap is no longer
  "this doesn't exist" — it's "this only runs when a maintainer manually
  triggers the 'Monitor Exchange Rates' GitHub Actions workflow"; there is
  no recurring schedule yet (see the Compliance note above).
- **Real, as of Phase 10:** email (via Resend) and Telegram (via the Bot
  API) notifications are actually sent by `backend/scheduler/run.js` the
  moment a saved alert's target is reached — see `backend/notifications/
  notify.js` and `NOTIFICATIONS_SETUP.md`. The `notifications` row records
  the real outcome (`DELIVERED` or `FAILED`, with a reason) rather than
  being optimistically marked delivered before a send is even attempted.
  Also as of Phase 10: signed-in users see a **real** rate-history chart
  (`frontend/rateHistory.js`) sourced from the `rates` table Phase 8's
  scheduler has been writing to — not just this browser session's readings.
- **Not yet built:** an automatic recurring schedule for the Phase 8/10 job
  (compliance review pending — see above, this is what makes real history
  and real alerts still depend on someone clicking "Run workflow"), and
  WhatsApp/SMS delivery (project brief's optional Phase 3 channels).

## Environment variables

See `.env.example`. None of these are required to run the Phase 1-6
frontend as a signed-out demo. `SUPABASE_URL` / `SUPABASE_ANON_KEY` matter
once you provision Supabase for Phase 7 (see `SUPABASE_SETUP.md`) — the
anon key goes in `frontend/supabaseConfig.js`, not `.env` (that file is for
backend-only values). `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, and
`TELEGRAM_BOT_TOKEN` are Phase 8/10 — backend/GitHub Actions secrets only,
never committed, never referenced anywhere in `frontend/`. See
`NOTIFICATIONS_SETUP.md` for how to obtain the latter two.

## License

MIT — see `LICENSE`. Change this if you'd prefer something else before
you push it publicly.
