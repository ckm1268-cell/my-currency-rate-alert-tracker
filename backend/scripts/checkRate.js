#!/usr/bin/env node
/**
 * checkRate.js — Phase 2/3 CLI runner
 * ===================================
 * Usage: node scripts/checkRate.js <source> <currencyCode> [branch]
 *   e.g. node scripts/checkRate.js mymoneymaster CNY
 *   e.g. node scripts/checkRate.js tajmuhabath CNY "THE EXCHANGE TRX"
 *   e.g. node scripts/checkRate.js merchantradeasia CNY "Pavilion KL"
 *
 * [branch] is optional and only meaningful for adapters whose config sets
 * branchSupport: true (Taj Muhabath, Wawasan Ilham, Jalinan Duta, and — as
 * of Phase 55, 02-Sep-2026 — Merchantrade Asia too; see
 * config/websites/merchantradeasia.json's branchNotes for how a real,
 * previously-absent branch selector was found live on that site). My
 * Money Master is the only adapter left that ignores a branch argument if
 * one is passed — confirmed live to publish one site-wide rate, no
 * per-branch selector on the page at all.
 *
 * Runs the named adapter's fetchRateWithFallback() (HTTP/direct-fetch
 * first, Playwright fallback where applicable — Taj Muhabath's adapter is
 * Playwright-only; My Money Master, Wawasan Ilham, and — as of Phase 55 —
 * Merchantrade Asia all try a direct fetch first and only fall back to a
 * real browser if that fails), prints the StandardRateResult as
 * JSON to stdout, and merges it
 * into frontend/data/latest-rates.json — the flat-file "API" the static
 * GitHub Pages frontend reads (see frontend/app.js: loadLiveData()).
 *
 * Why a committed JSON file instead of a database call: Phase 7 of the
 * approved roadmap wires up Supabase for real multi-user storage and
 * Realtime push updates. Until that lands, this is the honest, minimal way
 * to get a genuinely live-retrieved number onto a static site with zero
 * secrets in the frontend — this script only ever runs server-side (a
 * developer's machine, or the GitHub Actions runner in
 * .github/workflows/pages.yml), never in the browser. The frontend only
 * ever reads a same-origin static JSON file it already trusts, exactly
 * like it would read any other asset GitHub Pages serves.
 *
 * This file intentionally has NO Supabase/network-secret dependency, so it
 * can be deleted outright once Phase 7 replaces this mechanism.
 */

const fs = require('node:fs');
const path = require('node:path');

const ADAPTERS = {
  mymoneymaster: () => require('../scrapers/mymoneymaster.adapter'),
  tajmuhabath: () => require('../scrapers/tajmuhabath.adapter'),
  merchantradeasia: () => require('../scrapers/merchantradeasia.adapter'),
  // Phase 24 (24-Aug-2026) — jalinanduta is registered here ONLY, not yet
  // in backend/scheduler/run.js's own ADAPTERS map or any GitHub Actions
  // workflow. This script is exactly the manual, one-off verification tool
  // NEW_SOURCES_INVESTIGATION.md asks be run before wiring it into
  // anything scheduled — registering it here is that verification step,
  // not a decision to start polling it automatically.
  jalinanduta: () => require('../scrapers/jalinanduta.adapter'),
  // 01-Sep-2026 — same precedent as jalinanduta above: wawasanilham is
  // registered here ONLY, not yet in backend/scheduler/run.js's ADAPTERS
  // map, frontend/app.js's SOURCES, or any GitHub Actions workflow. See
  // config/websites/wawasanilham.json's compliance.actionRequired for
  // exactly what a passing run here should look like before that changes.
  wawasanilham: () => require('../scrapers/wawasanilham.adapter'),
};

const DATA_FILE = path.join(__dirname, '..', '..', 'frontend', 'data', 'latest-rates.json');

async function main() {
  const [, , sourceId, currencyCode, branch] = process.argv;

  if (!sourceId || !currencyCode) {
    console.error('Usage: node scripts/checkRate.js <source> <currencyCode> [branch]');
    console.error(`Known sources: ${Object.keys(ADAPTERS).join(', ')}`);
    process.exit(1);
  }

  const loadAdapter = ADAPTERS[sourceId];
  if (!loadAdapter) {
    console.error(`Unknown source "${sourceId}". Known sources: ${Object.keys(ADAPTERS).join(', ')}`);
    process.exit(1);
  }

  const adapter = loadAdapter();
  console.error(`[checkRate] Fetching ${sourceId} ${currencyCode}${branch ? ` (branch: ${branch})` : ''}...`);

  const result = await adapter.fetchRateWithFallback({ currencyCode, ...(branch ? { branch } : {}) });
  console.error(`[checkRate] status=${result.status} validationStatus=${result.validationStatus}` +
    (result.errorMessage ? ` errorMessage=${result.errorMessage}` : ''));
  console.log(JSON.stringify(result, null, 2));

  mergeIntoDataFile(result);

  if (result.status !== 'LIVE') {
    // Non-zero exit so a CI step can flag/notify on a bad run without
    // needing to parse the JSON output itself, while the JSON output
    // above and the merged data file still faithfully record what
    // actually happened (never silently dropped).
    process.exitCode = 2;
  }
}

function mergeIntoDataFile(result) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });

  let existing = { generatedAt: null, results: [] };
  if (fs.existsSync(DATA_FILE)) {
    try {
      existing = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (!Array.isArray(existing.results)) existing.results = [];
    } catch (err) {
      console.error(`[checkRate] WARNING: could not parse existing ${DATA_FILE} (${err.message}) — starting fresh.`);
      existing = { generatedAt: null, results: [] };
    }
  }

  const key = (r) => `${r.source}::${r.currency}::${r.branch || ''}`;
  const filtered = existing.results.filter((r) => key(r) !== key(result));
  filtered.push(result);

  const updated = { generatedAt: new Date().toISOString(), results: filtered };
  fs.writeFileSync(DATA_FILE, JSON.stringify(updated, null, 2) + '\n');
  console.error(`[checkRate] Wrote ${DATA_FILE} (${filtered.length} result(s)).`);
}

main().catch((err) => {
  console.error('[checkRate] FATAL:', err);
  process.exit(1);
});
