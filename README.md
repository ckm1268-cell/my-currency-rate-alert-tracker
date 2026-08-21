# MY Currency Rate Tracker

Real-time currency exchange-rate monitoring and target-rate alerts for
Malaysian money changers. Not a converter — this proves, with a timestamp,
whether the live rate at a chosen money changer has reached your target
*right now*, and alerts you the moment it does.

Initial scope: **CNY/MYR, SELL rate**, from **My Money Master** and
**Taj Muhabath**. Architecture supports adding more currencies, branches,
and sources without a redesign.

## Current status: Phase 1 of 10

| Phase | What | Status |
|---|---|---|
| 1 | Repo scaffold, dashboard UI on simulated data, deployed to GitHub Pages | ✅ live |
| 2 | My Money Master live retrieval | ⏳ not started |
| 3 | Taj Muhabath live retrieval | ⏳ not started |
| 4 | Rate validation wired into adapters | ⏳ not started |
| 5 | Target comparison engine wired to real data | ⏳ not started |
| 6 | Browser notifications wired to real alerts | ⏳ not started |
| 7 | Supabase (DB, auth, multi-user) | ⏳ not started |
| 8 | GitHub Pages + GitHub Actions scheduler live in production | ⏳ not started |
| 9 | Full test pass | ⏳ not started |
| 10 | Email / Telegram, rate-history charts | ⏳ not started |

**Everything on screen in this build is simulated.** The dashboard is fully
interactive and the alert-comparison/validation *logic* is real — only the
rate numbers themselves are generated locally (see the header comment in
`frontend/app.js`). Nothing here is presented as a live rate. See
`config/websites/*.json` for the real, live-inspected extraction plan for
each source, which Phases 2–3 will implement.

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
│   └── app.js
├── backend/                  # Phase 2+ — never deployed to GitHub Pages
│   ├── scrapers/              # one adapter per money changer
│   ├── validation/
│   ├── targetEngine/
│   ├── notifications/
│   └── db/
├── config/websites/          # per-source URLs, selectors, wait strategy
├── .github/workflows/         # scheduled monitor (currently manual-trigger only)
├── tests/
├── .env.example
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
  sanity checks, the responsive/mobile layout, and the adapter
  configuration in `config/websites/*.json` (URLs and selectors were
  captured by directly inspecting the live sites on 21-Aug-2026, not
  guessed).
- **Simulated:** every rate number. `frontend/app.js` generates them with a
  small random walk around realistic starting values and always labels them
  SIMULATED — never LIVE, per the project's core rule.
- **Not yet built:** the actual browser-automation/HTTP retrieval
  (`backend/scrapers/*.adapter.js` are stubs that throw "not implemented"),
  the database, multi-user auth, and every notification channel beyond the
  browser demo.

## Environment variables

See `.env.example`. None of these are required to run the Phase 1 frontend
— they matter starting Phase 7 (Supabase) and Phase 8 (GitHub Actions
secrets for the scheduled scraper).

## License

MIT — see `LICENSE`. Change this if you'd prefer something else before
you push it publicly.
