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
      const branch = source === 'tajmuhabath' ? (alert.branch || null) : null;
      const combo = { source, currency: alert.currency, branch };
      seen.set(comboKey(combo), combo);
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
      const branch = source === 'tajmuhabath' ? (alert.branch || null) : null;
      return resultsByComboKey.get(comboKey({ source, currency: alert.currency, branch }));
    })
    .filter(Boolean);
}

module.exports = { comboKey, getRequiredCombos, readingsForAlert };
