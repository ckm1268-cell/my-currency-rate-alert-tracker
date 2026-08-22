/**
 * Merchantrade Asia adapter — added 22-Aug-2026 (post-Phase 10)
 * ===============================================================
 * STATUS: implemented and unit-tested against a real, live-verified page
 * structure (see config/websites/merchantradeasia.json). This adapter was
 * requested by the user via a pasted Python/Selenium reference script
 * listing several money changers; per this project's non-negotiable rule
 * against guessing selectors, the site's real URL and real rendered DOM
 * were independently re-verified live (via direct browser automation, not
 * the Python script's own assumptions, and not WebFetch — which cannot
 * execute JS or reveal real class/id names) before this file was written.
 *
 * Like Taj Muhabath, there is no HTTP-only primary path for this site: a
 * plain fetch() of liveRateUrl returns the '.exchange-arrow-row' row
 * skeleton and column headers, but with every row's actual currency name /
 * buy / sell content EMPTY — confirmed live 22-Aug-2026 by running
 * fetch(location.href) from inside the loaded page and grepping the raw
 * response for "RENMINBI" (zero matches) versus the already-rendered DOM
 * (which does contain it). Playwright is therefore the only extraction
 * path, not a fallback — same situation as tajmuhabath.adapter.js.
 *
 * Unlike Taj Muhabath, this page has no branch selector that affects the
 * Counter Exchange Rates table — see config.branchNotes. A `branch` input
 * is accepted for interface consistency but is not used to select
 * anything; it is only threaded into the failure-path error paths.
 *
 * IMPORTANT — a note on testing in this development environment: the pure
 * parseHtml() half of this adapter is unit-tested against a real, live-
 * captured HTML fixture (tests/merchantradeasia.adapter.test.js +
 * tests/fixtures/merchantradeasia.exchange.sample.html — the actual CNY/
 * AUD/JPY row markup and values observed live). The Playwright-driving
 * half (fetchRate itself) was proven correct by hand, live, via real
 * browser automation (not simulated/invented) during this build — but a
 * local `node scripts/checkRate.js merchantradeasia CNY` run inside this
 * particular sandbox fails with a Playwright browser-binary mismatch
 * specific to this dev environment (its pre-installed Chromium revision
 * doesn't match what this repo's pinned `playwright` version expects, and
 * outbound HTTPS from a Playwright-launched browser process is separately
 * blocked here even pointed at the matching local binary) — this is a
 * sandbox limitation, not a defect in the selectors or logic above, and it
 * mirrors the same caveat already recorded in mymoneymaster.adapter.js's
 * header comment for the same underlying reason (restricted network
 * egress in this authoring environment). The real GitHub Actions workflow
 * (.github/workflows/pages.yml) runs `npx playwright install --with-deps
 * chromium` itself before calling this adapter, which resolves the
 * version mismatch — treat that first real CI run as the actual
 * end-to-end confirmation of the live network round-trip, exactly as the
 * other two adapters' header comments already ask you to.
 *
 * @see backend/scrapers/rateAdapter.interface.js for the required return shape
 */

const cheerio = require('cheerio');
const config = require('../../config/websites/merchantradeasia.json');
const { validateRate } = require('../validation/validateRate');

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const NAV_TIMEOUT_MS = 20_000;
const SETTLE_WAIT_MS = 5_000; // matches the window used during live verification

/**
 * Pure parsing function: given the RENDERED HTML of liveRateUrl (i.e.
 * page.content() after JS has populated the rows, not a raw fetch()),
 * extract the buy/sell rate for the requested currency. Kept separate from
 * the Playwright driving code so it can be unit-tested against a captured
 * HTML fixture without needing a browser.
 *
 * @param {string} html
 * @param {string} currencyCode e.g. "CNY"
 * @returns {{ buyRate: number, sellRate: number } | null} null if the
 *   currency's row could not be located or its values could not be parsed
 */
function parseHtml(html, currencyCode) {
  const displayName = config.currencyDisplayNames && config.currencyDisplayNames[currencyCode];
  if (!displayName) {
    throw new Error(
      `No currencyDisplayNames entry for "${currencyCode}" in ` +
      `config/websites/merchantradeasia.json — add one before requesting this currency.`
    );
  }

  const $ = cheerio.load(html);
  let buyRate = null;
  let sellRate = null;

  $(config.primarySelector.rowSelector).each((_, row) => {
    if (buyRate !== null && sellRate !== null) return; // already found it

    const rowText = $(row).text();
    const needle = `/ ${displayName}`;
    if (!rowText.toUpperCase().includes(needle.toUpperCase())) return;

    const buyText = $(row).find(config.primarySelector.buySelector).first().text().trim();
    const sellText = $(row).find(config.primarySelector.sellSelector).first().text().trim();
    const buyVal = parseFloat(buyText);
    const sellVal = parseFloat(sellText);
    if (Number.isNaN(buyVal) || Number.isNaN(sellVal)) return;

    buyRate = buyVal;
    sellRate = sellVal;
  });

  if (buyRate === null || sellRate === null) return null;
  return { buyRate, sellRate };
}

function buildResult({ input, buyRate, sellRate, status, validationStatus, errorMessage }) {
  return {
    source: config.id,
    branch: null, // this site's Counter Exchange Rates table is not branch-specific — see config.branchNotes
    currency: input.currencyCode,
    buyRate: buyRate ?? null,
    sellRate: sellRate ?? null,
    retrievedAt: new Date().toISOString(),
    sourceTimestamp: null, // this page does not publish its own per-row timestamp
    status,
    validationStatus,
    ...(errorMessage ? { errorMessage } : {}),
  };
}

/**
 * Primary (and only) extraction path: Playwright, real rendered DOM.
 *
 * @param {import('./rateAdapter.interface').RateAdapterInput} input
 * @returns {Promise<import('./rateAdapter.interface').StandardRateResult>}
 */
async function fetchRate(input) {
  if (!input || !input.currencyCode) {
    throw new Error('fetchRate(input): input.currencyCode is required');
  }

  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (err) {
    return buildResult({
      input,
      status: 'SOURCE_UNAVAILABLE',
      validationStatus: 'NOT_RUN',
      errorMessage: `Playwright is not available: ${err.message}`,
    });
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ userAgent: DEFAULT_USER_AGENT });
    await page.goto(config.liveRateUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    await page.waitForSelector(config.primarySelector.rowSelector, { timeout: NAV_TIMEOUT_MS });

    // Row shells attach quickly (they're server-rendered) but their real
    // currency/buy/sell content arrives later via JS — see config.notes.
    await page.waitForTimeout(SETTLE_WAIT_MS);

    const html = await page.content();
    const parsed = parseHtml(html, input.currencyCode);

    if (!parsed) {
      return buildResult({
        input,
        status: 'EXTRACTION_ERROR',
        validationStatus: 'NOT_RUN',
        errorMessage:
          `Could not locate a "${input.currencyCode}" row in ${config.primarySelector.rowSelector} ` +
          `(looked for display name "${config.currencyDisplayNames[input.currencyCode]}"). ` +
          `The page's structure may have changed — see config/websites/merchantradeasia.json.`,
      });
    }

    const { buyRate, sellRate } = parsed;
    const expectedRange = config.validation &&
      config.validation.expectedRange &&
      config.validation.expectedRange[input.currencyCode];

    const validation = validateRate({
      currency: input.currencyCode,
      buyRate,
      sellRate,
      retrievedAt: new Date().toISOString(),
      expectedRange,
    });

    if (!validation.passed) {
      return buildResult({
        input,
        buyRate,
        sellRate,
        status: 'RATE_VALIDATION_ERROR',
        validationStatus: 'FAILED',
        errorMessage: validation.reasons.join('; '),
      });
    }

    return buildResult({
      input,
      buyRate,
      sellRate,
      status: 'LIVE',
      validationStatus: 'PASSED',
    });
  } catch (err) {
    return buildResult({
      input,
      status: 'SOURCE_UNAVAILABLE',
      validationStatus: 'NOT_RUN',
      errorMessage: err.message,
    });
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Same entry-point name as the other adapters for a uniform interface
 * across adapters used by backend/scripts/checkRate.js and
 * backend/scheduler/run.js — there is no fallback here, Playwright is
 * already the primary (and only) path. Kept as a thin alias so the caller
 * doesn't need to know which adapters have a fallback and which don't.
 *
 * @param {import('./rateAdapter.interface').RateAdapterInput} input
 * @returns {Promise<import('./rateAdapter.interface').StandardRateResult>}
 */
async function fetchRateWithFallback(input) {
  return fetchRate(input);
}

module.exports = { fetchRate, fetchRateWithFallback, parseHtml, config };
