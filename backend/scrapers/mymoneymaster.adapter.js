/**
 * My Money Master adapter — Phase 2, migrated Phase 42 (27-Aug-2026)
 * ====================================================================
 * PHASE 42 MIGRATION: the project owner reported VND permanently stuck on
 * SIMULATED for this source and attached a screenshot of a real VND row
 * ("Viet Nam / 1M Vietnam Dong ( VND )", Buy 155.30 / Sell 157.80) that
 * does not exist on the old liveRateUrl ('/Home/rate_board', an 8-card
 * page). The owner identified where it actually came from:
 * 'index.php?/Home/full_rate_board' — a much larger, ~40-currency table on
 * the same domain. A live connected-browser session that same day
 * confirmed: this page is a superset of the old 8-card page (the old 8
 * currencies' Buy/Sell figures match exactly, e.g. CNY 60.20/60.47 both
 * places — nothing about those 8 changes), it genuinely lists all 12 of
 * this app's supported currencies including VND/THB/KRW/TWD (previously
 * believed entirely unavailable from this source), the values are present
 * in the RAW HTTP response (no JS required, same as before), and every
 * currency's per-unit convention on this page (e.g. "100 Chinese Renminbi
 * ( CNY )", "1M Vietnam Dong ( VND )") matches
 * backend/validation/bnmCrossCheck.js's ADAPTER_CURRENCY_UNIT map exactly
 * — see config/websites/mymoneymaster.json's "PHASE 42" note for the full
 * verification detail, and tests/fixtures/mymoneymaster.full_rate_board.sample.html
 * for the real captured markup.
 *
 * Because this page prints each currency's own ISO code directly (e.g.
 * "( VND )"), matching switched from a hand-maintained
 * currencyDisplayNames lookup to direct CODE extraction — the same
 * strategy Taj Muhabath and Jalinan Duta already use (see
 * frontend/app.js's CODE_MATCHED_SOURCES, now including 'mymoneymaster').
 * A currency this page genuinely doesn't list now fails the same way a
 * missing Taj Muhabath row does — EXTRACTION_ERROR with an honest "row not
 * found" message — instead of the old hard throw on a missing config
 * entry, since there is no per-currency config entry left to be missing.
 *
 * Primary path: plain HTTP GET of config.liveRateUrl + cheerio parse of
 * 'div.table-responsive.rate-board-table table tbody tr' rows (see
 * config.primarySelector for the exact cell layout). No browser
 * required — confirmed the BUY/SELL values are present in the raw HTTP
 * response, independent of any JS execution (re-verified 27-Aug-2026).
 *
 * Fallback path (fetchRateViaPlaywright): same URL, same selectors, read
 * from the rendered DOM instead of raw HTML. Used automatically by
 * fetchRateWithFallback() if the primary path fails for any reason
 * (network error, non-200, selector not found, or failed validation) —
 * this guards against the site moving this page to client-side rendering
 * in the future without anyone noticing until every reading starts failing.
 *
 * IMPORTANT — a note on testing in this development environment: the
 * sandbox this adapter is developed in has restricted network egress and
 * cannot reach www.mymoneymaster.com.my directly (no arbitrary outbound
 * HTTP). The extraction logic is therefore verified two ways instead: (1)
 * the exact HTML structure was captured live via a real browser session
 * (not simulated/invented — see the fixture file's own header for exactly
 * what was captured and how), and (2) that captured structure is used as
 * a fixture to unit-test parseHtml() locally
 * (tests/mymoneymaster.adapter.test.js). The live network fetch() call
 * itself runs for real in an environment with real internet access (the
 * user's machine, or the GitHub Actions runner) — it was not possible to
 * prove that specific HTTP round-trip from inside this sandbox. Treat the
 * first live run there as the actual end-to-end confirmation, and open an
 * issue if it needs adjustment — a third-party site's markup can always
 * change between this file being written and being run.
 *
 * @see backend/scrapers/rateAdapter.interface.js for the required return shape
 */

const cheerio = require('cheerio');
const config = require('../../config/websites/mymoneymaster.json');
const { validateRate } = require('../validation/validateRate');

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const FETCH_TIMEOUT_MS = 15_000;

/**
 * Pure parsing function: given the raw HTML of config.liveRateUrl, extract
 * the buy/sell rate for the requested currency. Kept separate from the
 * network call so it can be unit-tested against a captured HTML fixture
 * without needing a live connection.
 *
 * Phase 42: matches by ISO code extracted directly from each row's own
 * text (config.primarySelector.codeExtractPattern against the text found
 * at config.primarySelector.currencyTextSelector) rather than a
 * currencyDisplayNames lookup — see this file's header comment for why.
 *
 * @param {string} html
 * @param {string} currencyCode e.g. "CNY"
 * @returns {{ buyRate: number, sellRate: number } | null} null if the
 *   currency's row could not be located or its cells could not be parsed
 */
function parseHtml(html, currencyCode) {
  const $ = cheerio.load(html);
  const { rowSelector, currencyTextSelector, buyCellIndex, sellCellIndex, codeExtractPattern } =
    config.primarySelector;
  const codePattern = new RegExp(codeExtractPattern);

  let result = null;

  $(rowSelector).each((_, row) => {
    if (result) return; // already found it

    const currencyText = $(row).find(currencyTextSelector).first().text().trim();
    if (!currencyText) return;

    const match = currencyText.match(codePattern);
    if (!match) return;

    const rowCode = match[1].toUpperCase();
    if (rowCode !== currencyCode) return;

    const cells = $(row).find('td');
    if (cells.length <= Math.max(buyCellIndex, sellCellIndex)) return;

    const buyRate = parseFloat($(cells[buyCellIndex]).text().trim());
    const sellRate = parseFloat($(cells[sellCellIndex]).text().trim());
    if (Number.isNaN(buyRate) || Number.isNaN(sellRate)) return;

    result = { buyRate, sellRate };
  });

  return result;
}

async function fetchHtml(url, { signal } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': DEFAULT_USER_AGENT },
    signal,
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
  }
  return res.text();
}

function buildResult({ input, buyRate, sellRate, status, validationStatus, errorMessage }) {
  return {
    source: config.id,
    branch: null,
    currency: input.currencyCode,
    buyRate: buyRate ?? null,
    sellRate: sellRate ?? null,
    retrievedAt: new Date().toISOString(),
    // Phase 42: the full_rate_board page DOES publish a per-row "at
    // HH:MM AM/PM" time (config.primarySelector.lastUpdatedCellIndex),
    // but no date — only the page's own top banner shows a date, once,
    // for the whole table. Guessing which calendar day an isolated
    // "HH:MM" belongs to (today vs. yesterday, around midnight) would be
    // exactly the kind of unverified assumption this project's rules
    // warn against, so this is deliberately left null rather than
    // fabricating a full timestamp — retrievedAt above already gives an
    // honest, unambiguous capture time.
    sourceTimestamp: null,
    status,
    validationStatus,
    ...(errorMessage ? { errorMessage } : {}),
  };
}

/**
 * Primary path: plain HTTP GET + cheerio parse.
 *
 * @param {import('./rateAdapter.interface').RateAdapterInput} input
 * @returns {Promise<import('./rateAdapter.interface').StandardRateResult>}
 */
async function fetchRate(input) {
  if (!input || !input.currencyCode) {
    throw new Error('fetchRate(input): input.currencyCode is required');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let html;
  try {
    html = await fetchHtml(config.liveRateUrl, { signal: controller.signal });
  } catch (err) {
    return buildResult({
      input,
      status: 'SOURCE_UNAVAILABLE',
      validationStatus: 'NOT_RUN',
      errorMessage: `Fetch failed: ${err.message}`,
    });
  } finally {
    clearTimeout(timeout);
  }

  let parsed;
  try {
    parsed = parseHtml(html, input.currencyCode);
  } catch (err) {
    return buildResult({
      input,
      status: 'EXTRACTION_ERROR',
      validationStatus: 'NOT_RUN',
      errorMessage: `Parse threw: ${err.message}`,
    });
  }

  if (!parsed) {
    return buildResult({
      input,
      status: 'EXTRACTION_ERROR',
      validationStatus: 'NOT_RUN',
      errorMessage:
        `Could not locate a row for "${input.currencyCode}" on the page ` +
        `(looked for "( ${input.currencyCode} )" in each row's currency-txt span). ` +
        `The page's structure may have changed, or this currency genuinely isn't ` +
        `listed there right now — see config/websites/mymoneymaster.json.`,
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
}

/**
 * Fallback path: same URL, same selectors, read via a real rendered
 * browser (Playwright) instead of a raw HTTP fetch. Only reached by
 * fetchRateWithFallback() when the primary path did not return LIVE.
 *
 * Requires the `playwright` package and its browsers to be installed
 * (see backend/package.json and the GitHub Actions workflow step that
 * runs `npx playwright install --with-deps chromium`).
 *
 * @param {import('./rateAdapter.interface').RateAdapterInput} input
 * @returns {Promise<import('./rateAdapter.interface').StandardRateResult>}
 */
async function fetchRateViaPlaywright(input) {
  if (!input || !input.currencyCode) {
    throw new Error('fetchRateViaPlaywright(input): input.currencyCode is required');
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
    await page.goto(config.liveRateUrl, { waitUntil: 'domcontentloaded', timeout: FETCH_TIMEOUT_MS });
    await page.waitForSelector(config.primarySelector.rowSelector, { timeout: FETCH_TIMEOUT_MS });
    const html = await page.content();

    const parsed = parseHtml(html, input.currencyCode);
    if (!parsed) {
      return buildResult({
        input,
        status: 'EXTRACTION_ERROR',
        validationStatus: 'NOT_RUN',
        errorMessage: `[Playwright fallback] Could not locate a row for "${input.currencyCode}" in the rendered DOM.`,
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
        errorMessage: `[Playwright fallback] ${validation.reasons.join('; ')}`,
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
      errorMessage: `[Playwright fallback] ${err.message}`,
    });
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Recommended entry point for the scheduler: try the cheap HTTP path
 * first, only pay for a full browser launch if that path failed.
 *
 * @param {import('./rateAdapter.interface').RateAdapterInput} input
 * @returns {Promise<import('./rateAdapter.interface').StandardRateResult>}
 */
async function fetchRateWithFallback(input) {
  const primaryResult = await fetchRate(input);
  if (primaryResult.status === 'LIVE') return primaryResult;

  const fallbackResult = await fetchRateViaPlaywright(input);
  if (fallbackResult.status === 'LIVE') return fallbackResult;

  // Neither path succeeded — return the primary result (HTTP path) since
  // it's the cheaper/faster one to have failed and is usually the more
  // actionable error for debugging a plain markup change; the fallback's
  // error is folded in for visibility.
  return {
    ...primaryResult,
    errorMessage:
      `${primaryResult.errorMessage || 'primary path failed'} ` +
      `| Playwright fallback also failed: ${fallbackResult.errorMessage || 'unknown error'}`,
  };
}

module.exports = { fetchRate, fetchRateViaPlaywright, fetchRateWithFallback, parseHtml, config };
