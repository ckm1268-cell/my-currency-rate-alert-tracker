/**
 * Taj Muhabath adapter — Phase 3
 * ================================
 * STATUS: scaffold only. Not yet implemented.
 *
 * Verified 21-Aug-2026 (see config/websites/tajmuhabath.json): the rate
 * table's raw HTML ships with an EMPTY body — rows are filled in by
 * client-side JavaScript, progressively (each row's own "Last Updated"
 * timestamp lands a second or two apart from the next). This source
 * genuinely requires a headless browser. Implement in this order:
 *
 *   1. Launch Playwright, goto(config.liveRateUrl)
 *   2. If a specific branch was requested, select it via '#dpdBranch' and
 *      wait for the table body to refresh
 *   3. Wait for 'table#example1 tbody tr' to have rows (count > 0)
 *   4. Wait an additional short settle window (rows populate async) before
 *      reading — do not extract on first paint
 *   5. Find the row where the "code" cell equals the requested currencyCode,
 *      read weBuy / weSell / lastUpdated from that row
 *   6. hand the raw values to backend/validation before returning
 *   7. on any failure, return a StandardRateResult with the appropriate
 *      non-LIVE status — never fall back to a previous value labeled LIVE
 *
 * @see backend/scrapers/rateAdapter.interface.js for the required return shape
 */

const config = require('../../config/websites/tajmuhabath.json');

/**
 * @param {import('./rateAdapter.interface').RateAdapterInput} input
 * @returns {Promise<import('./rateAdapter.interface').StandardRateResult>}
 */
async function fetchRate(input) {
  throw new Error(
    `tajmuhabath.adapter.fetchRate() is not implemented yet — this is a ` +
    `Phase 1 repo scaffold. See the header comment in this file and ` +
    `config/websites/tajmuhabath.json for the verified extraction plan. ` +
    `Requested: ${JSON.stringify(input)}`
  );
}

module.exports = { fetchRate, config };
