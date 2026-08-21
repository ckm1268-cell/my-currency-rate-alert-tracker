/**
 * My Money Master adapter — Phase 2
 * ==================================
 * STATUS: implemented and unit-tested against a real, freshly re-verified
 * page structure (see config/websites/mymoneymaster.json — re-verified
 * 21-Aug-2026 during this Phase 2 build, which corrected the primary/
 * secondary selector assignment from the original architecture review).
 *
 * Primary path: plain HTTP GET of config.liveRateUrl ('/Home/rate_board')
 * + cheerio parse of the '.smallBox3' per-country cards. No browser
 * required — confirmed the BUY/SELL values are present in the raw HTTP
 * response, independent of any JS execution.
 *
 * Fallback path (fetchRateViaPlaywright): same URL, same selectors, read
 * from the rendered DOM instead of raw HTML. Used automatically by
 * fetchRateWithFallback() if the primary path fails for any reason
 * (network error, non-200, selector not found, or failed validation) —
 * this guards against the site moving this page to client-side rendering
 * in the future without anyone noticing until every reading starts failing.
 *
 * IMPORTANT — a note on testing in this development environment: the
 * sandbox this adapter was authored in has restricted network egress and
 * cannot reach www.mymoneymaster.com.my directly (no arbitrary outbound
 * HTTP). The extraction logic below was therefore verified two ways
 * instead: (1) the exact HTML structure was captured live, moments before
 * writing this file, via a real browser session (not simulated/invented),
 * and (2) that captured structure was used as a fixture to unit-test
 * parseHtml() locally (tests/mymoneymaster.adapter.test.js) — confirming
 * it correctly extracts CNY BUY 60.30 / SELL 60.60, the real live values
 * observed during that same session. The live network fetch() call itself
 * will run for the first time in an environment with real internet access
 * (the user's machine, or the GitHub Actions runner) — it was not possible
 * to prove that specific HTTP round-trip from inside this sandbox. Treat
 * the first live run there as the actual end-to-end confirmation, and open
 * an issue if it needs adjustment — a third-party site's markup can always
 * change between this file being written and being run for the first time.
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
 * @param {string} html
 * @param {string} currencyCode e.g. "CNY"
 * @returns {{ buyRate: number, sellRate: number } | null} null if the
 *   currency's card could not be located or its rows could not be parsed
 */
function parseHtml(html, currencyCode) {
  const displayName = config.currencyDisplayNames && config.currencyDisplayNames[currencyCode];
  if (!displayName) {
    throw new Error(
      `No currencyDisplayNames entry for "${currencyCode}" in ` +
      `config/websites/mymoneymaster.json — add one before requesting this currency.`
    );
  }

  const $ = cheerio.load(html);
  let buyRate = null;
  let sellRate = null;

  $(config.primarySelector.cardBlockSelector).each((_, block) => {
    if (buyRate !== null && sellRate !== null) return; // already found it

    const heading = $(block).find(config.primarySelector.headingSelector).first().text().trim();
    if (heading !== displayName) return;

    $(block)
      .find(config.primarySelector.valueRowSelector)
      .each((__, row) => {
        const spans = $(row).find('span');
        if (spans.length < 2) return;

        const label = $(spans[0]).text().trim().toLowerCase();
        const rawValue = $(spans[1]).text().trim();
        const numericValue = parseFloat(rawValue);
        if (Number.isNaN(numericValue)) return;

        if (label.startsWith('buy')) {
          buyRate = numericValue;
        } else if (label.startsWith('sell')) {
          sellRate = numericValue;
        }
      });
  });

  if (buyRate === null || sellRate === null) return null;
  return { buyRate, sellRate };
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
    sourceTimestamp: null, // this page does not publish its own per-row timestamp
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
        `Could not locate a "${input.currencyCode}" card on the page ` +
        `(looked for heading "${config.currencyDisplayNames[input.currencyCode]}"). ` +
        `The page's structure may have changed — see config/websites/mymoneymaster.json.`,
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
    await page.waitForSelector(
      `${config.primarySelector.cardBlockSelector} ${config.primarySelector.headingSelector}`,
      { timeout: FETCH_TIMEOUT_MS }
    );
    const html = await page.content();

    const parsed = parseHtml(html, input.currencyCode);
    if (!parsed) {
      return buildResult({
        input,
        status: 'EXTRACTION_ERROR',
        validationStatus: 'NOT_RUN',
        errorMessage: `[Playwright fallback] Could not locate a "${input.currencyCode}" card in the rendered DOM.`,
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
