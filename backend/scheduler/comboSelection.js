/**
 * Combo selection — Phase 8
 * ============================
 * Pure helper functions for the scheduled backend job
 * (backend/scheduler/run.js). Deliberately separated from run.js — which
 * does real I/O (Supabase, live adapter/network calls) — so this logic can
 * be unit-tested without any of that (see tests/comboSelection.test.js).
 */

// Phase 25 (25-Aug-2026) hidden-issue fix: getRequiredCombos() and
// readingsForAlert() below used to each hardcode
// `source === 'tajmuhabath'` as their own private, duplicated way of
// answering "does this source support branches" — a magic string that
// had to independently stay in sync with config/websites/tajmuhabath.json's
// own branchSupport: true (the field frontend/app.js's SOURCES array
// already treats as the real source of truth) AND with itself, in two
// separate functions in this one file. Nothing had actually drifted yet
// (adding Jalinan Duta, Phase 24, correctly needed no change here since it
// isn't 'tajmuhabath'), but that was luck, not a guarantee — the next
// source to ever need branch support would have silently done nothing
// here until someone remembered to add a 3rd/4th copy of the same string
// check. Reading each config's own branchSupport field instead means this
// file can never disagree with the one place that's supposed to define it.
//
// Follow-up fix (25-Aug-2026, later same day): the Set below was built but
// getRequiredCombos()/readingsForAlert() were never actually switched over
// to read it — both still had the literal `source === 'tajmuhabath'` check
// a few lines down, so the magic-string problem this comment describes was
// still live. Both functions now call BRANCH_SUPPORTED_SOURCES.has(source)
// instead — this Set is the thing that actually decides branch handling.
const fs = require('node:fs');
const path = require('node:path');

const BRANCH_SUPPORTED_SOURCES = new Set(
  fs.readdirSync(path.join(__dirname, '../../config/websites'))
    .filter((f) => f.endsWith('.json'))
    .filter((f) => {
      const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/websites', f), 'utf8'));
      return config.branchSupport === true;
    })
    .map((f) => f.replace(/\.json$/, ''))
);

// Phase 33 (26-Aug-2026) fix: reported — the Activity Log showed
// "My Money Master — VND · EXTRACTION_ERROR: Parse threw: No
// currencyDisplayNames entry for 'VND' in config/websites/mymoneymaster.json".
// Root cause: this file had no concept of which currencies a source's
// adapter actually supports — getRequiredCombos() built a combo for every
// source+currency pair ANY alert asked for, even when that source's own
// config never had a mapping for that currency. That's not a real failure
// — it's the scheduler asking the adapter to do something it was never
// built to do — but it read exactly like one, complete with an internal
// file path leaking into a user-facing log line.
//
// Phase 38 (26-Aug-2026) follow-up: the original fix answered "is this
// combo supported" with a human-curated allowlist (SUPPORTED_CURRENCIES)
// that required a manual checkRate.js run + live cross-check before each
// new currency could be added — mirroring frontend/app.js's old
// REAL_ADAPTER_SUPPORT. Reported: the project owner has already verified
// all 4 registered money changers directly, repeatedly, and does not want
// that per-currency ceremony gating a currency newly selected at one of
// these 4 — only an actual 5th money changer added later should need it.
//
// Phase 48 (29-Aug-2026): CODE_MATCHED_SOURCES and
// DISPLAY_NAME_MATCHED_CURRENCIES used to be hand-duplicated here and in
// frontend/app.js, "kept in sync by hand" per a comment that used to sit
// where this one now does. That discipline failed twice without either
// copy ever raising an error (My Money Master + VND, Phase 42;
// Merchantrade Asia + JPY/USD/SGD, Phase 47) — a currency added to one
// copy and not the other just silently never got checked by the
// scheduler, with the live dashboard the only place the gap was ever
// visible. Both lists now live in exactly one file,
// frontend/currencySupport.js, which this file require()s below and
// frontend/app.js loads via a <script> tag before app.js — see that
// file's own header comment for the full architecture (why a plain
// require()/UMD file, not an async fetch) and the full Phase 42/47
// incident history. There is no longer a second copy anywhere to drift
// out of sync with.
const {
  CODE_MATCHED_SOURCES: CODE_MATCHED_SOURCES_LIST,
  DISPLAY_NAME_MATCHED_CURRENCIES,
} = require('../../frontend/currencySupport.js');
const CODE_MATCHED_SOURCES = new Set(CODE_MATCHED_SOURCES_LIST);

/**
 * Is this source+currency combo one the scheduler should actually attempt
 * a live check for? True unconditionally for a code-matched source (Taj
 * Muhabath, Jalinan Duta, My Money Master — any currency their live table
 * lists works automatically); for a display-name-matched source
 * (Merchantrade Asia), true only if that source's own currencyDisplayNames
 * config has an entry for this currency, since the parser genuinely has
 * no other way to find the right row. See this file's Phase 38 comment
 * above for why this is no longer a manual-verification allowlist.
 *
 * @param {string} source
 * @param {string} currency
 * @returns {boolean}
 */
function isSupportedCombo(source, currency) {
  if (CODE_MATCHED_SOURCES.has(source)) return true;
  const list = DISPLAY_NAME_MATCHED_CURRENCIES[source];
  return Array.isArray(list) && list.includes(currency);
}

/**
 * Stable string key identifying one (source, currency, branch) combination
 * — the unit of work the scheduler actually needs to check once per run,
 * no matter how many alerts reference it.
 *
 * @param {{ source: string, currency: string, branch?: string|null }} combo
 * @returns {string}
 */
function comboKey({ source, currency, branch }) {
  return `${source}::${currency}::${branch || ''}`;
}

/**
 * Given every ACTIVE alert row (from the `alerts` table), returns the
 * deduplicated list of {source, currency, branch} combinations that need a
 * live rate check this run. Multiple alerts sharing the same
 * source+currency+branch collapse into a single combo — one adapter call
 * serves every alert that needs it, rather than one call per alert. This is
 * the project brief's section 13 preference for "an efficient backend
 * monitoring service rather than making every user's browser independently
 * scrape the same website" — now true of the backend's own alert count too,
 * not just true relative to per-browser scraping.
 *
 * `branch` is only ever taken from the alert for sources that actually
 * support branches (currently just "tajmuhabath" — see
 * config/websites/tajmuhabath.json's branchSupport flag). For every other
 * source the combo's branch is always null, even if the alert row happens
 * to have a branch value stored (My Money Master publishes one site-wide
 * rate; a branch value on an alert only ever meant something for a Taj
 * Muhabath row in the first place, per how frontend/auth.js's
 * saveCurrentAlert() writes it).
 *
 * @param {Array<{ sources: string[], currency: string, branch?: string|null }>} alerts
 * @returns {Array<{ source: string, currency: string, branch: string|null }>}
 */
function getRequiredCombos(alerts) {
  const seen = new Map();
  (alerts || []).forEach((alert) => {
    const sources = Array.isArray(alert.sources) ? alert.sources : [];
    sources.forEach((source) => {
      // Phase 33 fix — never build a combo for a source+currency this
      // project hasn't actually verified an adapter for; see
      // isSupportedCombo()'s own comment above for why calling the
      // adapter anyway is wrong, not just noisy.
      if (!isSupportedCombo(source, alert.currency)) return;
      const branch = BRANCH_SUPPORTED_SOURCES.has(source) ? (alert.branch || null) : null;
      const combo = { source, currency: alert.currency, branch };
      seen.set(comboKey(combo), combo);
    });
  });
  return Array.from(seen.values());
}

/**
 * Phase 33 — the mirror image of getRequiredCombos() above: every distinct
 * source+currency pair some alert actually asked for that got skipped
 * because isSupportedCombo() said no. Not used to check anything — purely
 * so backend/scheduler/run.js can log what it silently declined to do,
 * instead of that only being visible as an absence. An alert that skips
 * here isn't necessarily unevaluated this run — it's still evaluated
 * normally against any of its OTHER selected sources that ARE supported;
 * this only means this one particular source contributes nothing.
 *
 * @param {Array<{ sources: string[], currency: string }>} alerts
 * @returns {Array<{ source: string, currency: string }>}
 */
function getSkippedUnsupportedCombos(alerts) {
  const seen = new Map();
  (alerts || []).forEach((alert) => {
    const sources = Array.isArray(alert.sources) ? alert.sources : [];
    sources.forEach((source) => {
      if (isSupportedCombo(source, alert.currency)) return;
      const key = `${source}::${alert.currency}`;
      seen.set(key, { source, currency: alert.currency });
    });
  });
  return Array.from(seen.values());
}

/**
 * Given one alert and a map of comboKey -> StandardRateResult (this run's
 * readings, one per required combo — see getRequiredCombos above), returns
 * just the readings relevant to this specific alert's selected sources.
 * This is exactly what backend/targetEngine/compareTarget.js's
 * pickBestReading() should be given to choose the best of for this alert.
 *
 * Silently skips a source with no corresponding entry in
 * resultsByComboKey (e.g. an unknown source id, or a combo that was
 * skipped this run for some reason) rather than throwing — an alert
 * missing one of its sources' readings should still be evaluated against
 * whichever of its sources DID produce a reading, not fail outright.
 *
 * @param {{ sources: string[], currency: string, branch?: string|null }} alert
 * @param {Map<string, object>} resultsByComboKey
 * @returns {object[]} StandardRateResult-shaped readings, one per source
 *   that has one — never longer than alert.sources.length, may be shorter.
 */
function readingsForAlert(alert, resultsByComboKey) {
  const sources = Array.isArray(alert.sources) ? alert.sources : [];
  return sources
    .map((source) => {
      const branch = BRANCH_SUPPORTED_SOURCES.has(source) ? (alert.branch || null) : null;
      return resultsByComboKey.get(comboKey({ source, currency: alert.currency, branch }));
    })
    .filter(Boolean);
}

module.exports = {
  comboKey,
  getRequiredCombos,
  readingsForAlert,
  isSupportedCombo,
  getSkippedUnsupportedCombos,
  CODE_MATCHED_SOURCES,
  DISPLAY_NAME_MATCHED_CURRENCIES,
};
