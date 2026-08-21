/**
 * My Money Master adapter — Phase 2
 * ==================================
 * STATUS: scaffold only. Not yet implemented.
 *
 * Verified 21-Aug-2026 (see config/websites/mymoneymaster.json): the CNY
 * BUY/SELL values are present in the raw server-rendered HTML, so this
 * adapter's PRIMARY path is a plain HTTP GET + HTML parse — it does not need
 * a headless browser. Implement in this order:
 *
 *   1. fetch(config.liveRateUrl)
 *   2. parse with cheerio, select '.rating-content.simply-scroll-list li'
 *   3. match each <li>'s text against the textPattern in the config file
 *      to find the row for the requested currencyCode
 *   4. hand the raw buy/sell strings to backend/validation before returning
 *   5. on any failure (network, selector not found, validation failed),
 *      return a StandardRateResult with the appropriate non-LIVE status —
 *      never fall back to a previous value labeled LIVE
 *
 * A Playwright-based fallback path (same selector, real browser) should be
 * added behind the same function signature for resilience if My Money
 * Master ever moves this data to client-side rendering — see
 * config.playwrightFallback.
 *
 * @see backend/scrapers/rateAdapter.interface.js for the required return shape
 */

const config = require('../../config/websites/mymoneymaster.json');

/**
 * @param {import('./rateAdapter.interface').RateAdapterInput} input
 * @returns {Promise<import('./rateAdapter.interface').StandardRateResult>}
 */
async function fetchRate(input) {
  throw new Error(
    `mymoneymaster.adapter.fetchRate() is not implemented yet — this is a ` +
    `Phase 1 repo scaffold. See the header comment in this file and ` +
    `config/websites/mymoneymaster.json for the verified extraction plan. ` +
    `Requested: ${JSON.stringify(input)}`
  );
}

module.exports = { fetchRate, config };
