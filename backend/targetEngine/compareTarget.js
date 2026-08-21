/**
 * Target comparison engine — Phase 5
 * =====================================
 * STATUS: implemented and unit-tested (21-Aug-2026).
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

module.exports = { isTargetMet };
