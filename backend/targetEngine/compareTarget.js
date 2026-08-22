/**
 * Target comparison engine — Phase 5, extended Phase 8
 * =========================================================
 * STATUS: implemented and unit-tested (21-Aug-2026); extended 22-Aug-2026
 * (Phase 8) with pickBestReading() — see that function's own doc comment.
 *
 * Evaluates a validated live rate against a user's Alert condition. See the
 * "Target Rate Logic" section of the project reference pack for the full
 * condition set (reaches, below, at-or-below, above, changes by X%) and the
 * duplicate-alert-suppression rule: once an alert's status flips to
 * TRIGGERED it must not re-fire on every subsequent qualifying check — only
 * on reset or a new qualifying event after the user re-arms it. Duplicate
 * suppression itself is caller state (a `triggered` flag the caller owns,
 * same as `frontend/app.js`'s `state.triggered`) — this function is a pure
 * per-check evaluation and does not track that state itself, so it can be
 * called safely on every poll without side effects.
 *
 * This module mirrors `frontend/app.js`'s own `isTargetMet()` (used there
 * for the live in-browser demo/dashboard) exactly, condition-for-condition.
 * It exists as its own tested module — rather than only living in the
 * frontend — because a future server-side notification channel (email,
 * Telegram — see Phase 6+ and the project brief's section 13 preference for
 * "an efficient backend monitoring service rather than making every user's
 * browser independently scrape the same website") needs to evaluate the
 * same target logic without a browser tab open. It is not yet wired into
 * `backend/scripts/checkRate.js` or any GitHub Actions step — today's
 * pipeline only fetches and validates a rate and publishes it to
 * `frontend/data/latest-rates.json`; the frontend does its own comparison
 * client-side. Wiring this module server-side is Phase 6+ work once a real
 * per-user alert store exists (Phase 7, Supabase) to read target
 * configuration from.
 *
 * @param {{ liveRate: number, targetRate: number,
 *           condition: "AT_OR_BELOW"|"BELOW"|"REACHES"|"ABOVE"|"PCT_CHANGE",
 *           prevRate?: number|null,
 *           pctChangeThreshold?: number }} params
 *   `prevRate` and `pctChangeThreshold` only matter for condition
 *   "PCT_CHANGE": `prevRate` is the previous reading to compare against
 *   (no previous reading yet => never triggers), and `pctChangeThreshold`
 *   is the minimum absolute percentage change required (defaults to 1,
 *   matching the frontend's default and the project brief's example).
 * @returns {boolean} true if this condition is currently met
 */
function isTargetMet(params) {
  const { liveRate, targetRate, condition, prevRate, pctChangeThreshold } = params || {};

  if (typeof liveRate !== 'number' || !Number.isFinite(liveRate)) return false;
  if (typeof targetRate !== 'number' || !Number.isFinite(targetRate)) return false;

  switch (condition) {
    case 'AT_OR_BELOW':
      return liveRate <= targetRate;
    case 'BELOW':
      return liveRate < targetRate;
    case 'REACHES':
      return liveRate === targetRate;
    case 'ABOVE':
      return liveRate > targetRate;
    case 'PCT_CHANGE': {
      if (prevRate == null || typeof prevRate !== 'number' || !Number.isFinite(prevRate) || prevRate === 0) {
        return false; // no baseline to compare against yet
      }
      const threshold =
        typeof pctChangeThreshold === 'number' && Number.isFinite(pctChangeThreshold) && pctChangeThreshold > 0
          ? pctChangeThreshold
          : 1; // default 1%, matching frontend/app.js's default state.pctChange
      const pctChange = Math.abs((liveRate - prevRate) / prevRate) * 100;
      return pctChange >= threshold;
    }
    default:
      return false; // unknown/missing condition never triggers — fail closed, not open
  }
}

/**
 * pickBestReading() — Phase 8
 * ==============================
 * Given a set of live readings (StandardRateResult-shaped — see
 * backend/scrapers/rateAdapter.interface.js) for the sources one alert has
 * selected, returns the single reading that alert should actually be
 * evaluated against: the best rate among the sources that are currently
 * LIVE (a lower SELL rate is better for a buyer; a higher BUY rate is
 * better for a seller — see the project brief's rate-type explainer).
 *
 * This exists because of a real inconsistency found and fixed during the
 * Phase 8 build (22-Aug-2026): the dashboard's multi-source comparison
 * table already visually marks the best-rate row and shows a "REACHED"
 * badge on it, but the alerting logic that actually decided whether to
 * fire a notification (both the live frontend's tick() and, before this
 * function existed, nothing on the backend at all) only ever looked at a
 * single "primary" source — My Money Master if selected, Taj Muhabath
 * only as a fallback — never the genuinely best rate across every source
 * the user selected. A saved multi-source alert could sit at "Best /
 * REACHED" on screen while never actually triggering. Confirmed with the
 * user (via an explicit choice, not assumed) that the correct behavior is
 * "best rate across every selected source triggers the alert" — this
 * function is the single, shared implementation of that rule for the
 * backend; frontend/app.js's own pickBestReading() mirrors it exactly for
 * the live in-browser demo, the same mirroring relationship isTargetMet()
 * already has between the two files.
 *
 * A reading only counts as a candidate if its status is exactly "LIVE" —
 * i.e. it was actually retrieved this run AND passed validateRate()
 * (backend/validation/validateRate.js runs inside each adapter before it
 * ever returns status "LIVE" — see rateAdapter.interface.js). STALE,
 * SOURCE_UNAVAILABLE, EXTRACTION_ERROR, and RATE_VALIDATION_ERROR
 * readings are never candidates, never silently treated as "good enough."
 *
 * @param {Array<{source:string, branch:string|null, currency:string,
 *   buyRate:number|null, sellRate:number|null, status:string}>} readings
 * @param {"BUY"|"SELL"} rateType
 * @returns {object|null} the best LIVE reading, or null if none of the
 *   given readings are currently LIVE (caller should skip evaluating the
 *   alert this run rather than guessing — never fall back to a stale or
 *   failed reading just to have something to compare).
 */
function pickBestReading(readings, rateType) {
  const key = rateType === 'SELL' ? 'sellRate' : 'buyRate';
  const candidates = (readings || []).filter(
    (r) => r && r.status === 'LIVE' && typeof r[key] === 'number' && Number.isFinite(r[key])
  );
  if (!candidates.length) return null;

  const better = (a, b) => (rateType === 'SELL' ? a[key] < b[key] : a[key] > b[key]);
  let best = candidates[0];
  candidates.forEach((r) => { if (better(r, best)) best = r; });
  return best;
}

module.exports = { isTargetMet, pickBestReading };
