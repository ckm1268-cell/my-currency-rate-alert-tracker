# MY Currency Rate Tracker

Real-time currency exchange-rate monitoring and target-rate alerts for
Malaysian money changers. Not a converter — this proves, with a timestamp,
whether the live rate at a chosen money changer has reached your target
*right now*, and alerts you the moment it does.

Initial scope: **CNY/MYR, SELL rate**, from **My Money Master** and
**Taj Muhabath**. Architecture supports adding more currencies, branches,
and sources without a redesign.

## Current status: Phase 8 of 10

| Phase | What | Status |
|---|---|---|
| 1 | Repo scaffold, dashboard UI on simulated data, deployed to GitHub Pages | ✅ live |
| 2 | My Money Master live retrieval | ✅ live (CNY SELL/BUY) |
| 3 | Taj Muhabath live retrieval | ✅ live (CNY SELL/BUY, branch: LALAPORT BBCC) |
| 4 | Rate validation wired into adapters | ✅ done for both adapters (`backend/validation/validateRate.js`) |
| 5 | Target comparison engine wired to real data | ✅ done — `isTargetMet` (`frontend/app.js`) operates on real readings; `backend/targetEngine/compareTarget.js` is the tested server-side twin, now actually called by Phase 8's scheduler |
| 6 | Browser notifications wired to real alerts | ✅ live-tested end-to-end against a real trigger, not just read-through |
| 7 | Supabase (DB, auth, multi-user) | ✅ schema + RLS + magic-link sign-in + per-user saved alerts — **live-tested end-to-end**, including a real cross-account isolation check across three separate accounts (see `SUPABASE_SETUP.md`) |
| 8 | Scheduled backend job (Supabase-backed) | ✅ implemented — `backend/scheduler/run.js` (wired into `.github/workflows/monitor.yml`) fetches every ACTIVE alert, checks both adapters, writes to the `rates` table, evaluates each alert against the **best rate across its selected sources**, and marks it TRIGGERED + logs a `notifications` row the moment a target is met — no browser tab required. Runs via manual "Run workflow" trigger only; **no recurring cron yet**, deliberately gated on the Terms of Use compliance review (see Compliance note below). **Not yet live-tested against a real Supabase project** — this sandbox cannot reach either money-changer site or a real Supabase instance; the first real run needs to happen via the Actions tab, see the note in the Phase 8 status write-up. |
| 9 | Full test pass | 🟡 partial — unit tests for both adapters' parsing logic, the target-comparison engine (including Phase 8's `pickBestReading`), and the scheduler's pure combo-selection logic all exist and pass (38/38); no end-to-end/multi-user test pass yet beyond Phase 7's manual isolation check |
| 10 | Email / Telegram, rate-history charts | ⏳ not started |

**CNY at both money changers is real.** My Money Master CNY and Taj
Muhabath CNY (branch: LALAPORT BBCC) are retrieved live by a GitHub
Actions job on every deploy — see `backend/scripts/checkRate.js` and
`.github/workflows/pages.yml`. Every other currency, and any other Taj
Muhabath branch, is still simulated by `frontend/app.js` and always
labeled SIMULATED — never LIVE, per the project's core rule. See
`config/websites/*.json` for the live-inspected extraction plan for each
source (URLs, selectors, wait strategy — verified directly against the
live sites, not guessed, and re-verified when a site's structure changed
mid-build — see the "notes" fields in those config files for the full
story of what changed and how it was caught).

### Compliance note (read before enabling any schedule)

Neither `pages.yml` nor `monitor.yml` runs on a cron yet. Both
`config/websites/mymoneymaster.json` and `config/websites/tajmuhabath.json`
flag an open action item: a human should read each site's Terms of Use
before this runs on a recurring, unattended schedule. Additionally, the
Taj Muhabath adapter deliberately does NOT call the internal API endpoint
its branch dropdown uses internally (discovered during the Phase 3 build) —
that endpoint requires an authorization this adapter does not have and
should not attempt to replicate. See the header comment in
`backend/scrapers/tajmuhabath.adapter.js` for details.

As of Phase 8, `monitor.yml` runs a real, fully-implemented pipeline
(`backend/scheduler/run.js`) on every manual trigger — this compliance
blocker now gates a functional job, not a placeholder. Do not uncomment
the `schedule:` block in that file until the Terms of Use review above has
actually been done.

### Accounts (Phase 7 — optional)

The dashboard works fully without signing in, exactly as it did in Phases
1-6. Signing in (magic-link email, no password) additionally lets you save
your current alert configuration to your own account, isolated from every
other user by Postgres Row-Level Security — see `database/schema.sql`. This
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
│   └── supabaseConfig.js      # Phase 7 — your project URL + anon key (safe to commit)
├── backend/                  # Phase 2+ — never deployed to GitHub Pages
│   ├── scrapers/              # one adapter per money changer
│   ├── validation/
│   ├── targetEngine/
│   ├── notifications/
│   ├── scheduler/              # Phase 8 — the real scheduled job (run.js) + its pure combo-selection helpers
│   └── db/                    # Supabase service-role client (backend-only)
├── database/
│   └── schema.sql             # Phase 7 — tables + Row-Level Security policies
├── config/websites/          # per-source URLs, selectors, wait strategy
├── .github/workflows/         # scheduled monitor (currently manual-trigger only)
├── tests/
├── .env.example
├── SUPABASE_SETUP.md          # Phase 7 — provisioning walkthrough
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
  inspecting the live sites, not guessed) — **and, as of Phase 3, the CNY
  rate itself from both My Money Master and Taj Muhabath**, retrieved live
  by `backend/scrapers/mymoneymaster.adapter.js` and
  `backend/scrapers/tajmuhabath.adapter.js`, validated, and published to
  `frontend/data/latest-rates.json` on every deploy.
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
- **Not yet built:** an automatic recurring schedule for the Phase 8 job
  (compliance review pending — see above), and every notification channel
  beyond the browser demo (Phase 10) — a `notifications` row from Phase 8
  is logged with `delivery_status: "PENDING"` today, honestly reflecting
  that nothing server-side actually pushes it to the user yet.

## Environment variables

See `.env.example`. None of these are required to run the Phase 1-6
frontend as a signed-out demo. `SUPABASE_URL` / `SUPABASE_ANON_KEY` matter
once you provision Supabase for Phase 7 (see `SUPABASE_SETUP.md`) — the
anon key goes in `frontend/supabaseConfig.js`, not `.env` (that file is for
backend-only values). `SUPABASE_SERVICE_ROLE_KEY` and the email/Telegram
keys are Phase 8/10 — backend/GitHub Actions secrets only, never committed.

## License

MIT — see `LICENSE`. Change this if you'd prefer something else before
you push it publicly.
