# CKM Currency Rate Monitor

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
| 1 | Repo scaffold, dashboard UI on simulated data, deployable to GitHub Pages | ✅ this build |
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

## Deploying the Phase 1 frontend to GitHub Pages

This part you'll need to do yourself — I can build and verify the code, but
I can't create repositories or push under your GitHub account.

1. Create a new **public** GitHub repository (e.g. `currency-rate-alert`).
2. Push this folder's contents to it:
   ```bash
   git init
   git add .
   git commit -m "Phase 1: repo scaffold + dashboard UI on simulated data"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```
3. In the repo, go to **Settings → Pages**, set **Source** to "Deploy from a
   branch", branch `main`, folder `/frontend`. Save.
4. GitHub will publish it at `https://<your-username>.github.io/<your-repo>/`
   within a minute or two.

(If your GitHub plan/org requires it, Pages can also build from a
`gh-pages` branch or a GitHub Actions deploy workflow instead of `/frontend`
directly — either works, since `frontend/` has no build step to run.)

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
