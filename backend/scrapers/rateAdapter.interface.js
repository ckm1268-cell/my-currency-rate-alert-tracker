/**
 * Standard Rate Adapter Contract
 * ================================
 * Every money-changer adapter (backend/scrapers/*.adapter.js) must export a
 * single async function matching this shape. This lets the scheduler treat
 * every source identically, and lets a new money changer be added later
 * without touching anything outside its own adapter file + config entry.
 *
 * @typedef {Object} RateAdapterInput
 * @property {string} currencyCode   - ISO code, e.g. "CNY"
 * @property {string} [branch]       - branch identifier, only meaningful for
 *                                      adapters where config.branchSupport is true
 *
 * @typedef {Object} StandardRateResult
 * @property {string} source           - adapter id, e.g. "mymoneymaster"
 * @property {string|null} branch      - branch used, or null if not applicable
 * @property {string} currency         - ISO code, e.g. "CNY"
 * @property {number|null} buyRate     - null if not extracted / failed validation
 * @property {number|null} sellRate    - null if not extracted / failed validation
 * @property {string} retrievedAt      - ISO timestamp: when THIS system fetched it
 * @property {string|null} sourceTimestamp - ISO timestamp the SOURCE page itself
 *                                            displayed, if available (e.g. Taj
 *                                            Muhabath's per-row "Last Updated")
 * @property {"LIVE"|"STALE"|"SOURCE_UNAVAILABLE"|"EXTRACTION_ERROR"|"RATE_VALIDATION_ERROR"} status
 * @property {"PASSED"|"FAILED"|"NOT_RUN"} validationStatus
 * @property {string} [errorMessage]   - present when status is not LIVE
 *
 * A result may only carry status "LIVE" if it was retrieved from the adapter's
 * configured live page within this run (see config/websites/*.json), passed
 * validate() in backend/validation, and was NOT sourced from cache, search
 * results, or a previous run's value. See:
 * PART 9 "LIVE RATE VERIFICATION STANDARD" in the project reference pack.
 *
 * @param {RateAdapterInput} input
 * @returns {Promise<StandardRateResult>}
 */

module.exports = {
  // Marker export only — this file documents the contract. Each concrete
  // adapter (mymoneymaster.adapter.js, tajmuhabath.adapter.js, ...)
  // implements it independently.
};
