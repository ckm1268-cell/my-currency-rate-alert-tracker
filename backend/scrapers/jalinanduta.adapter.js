/**
 * Jalinan Duta adapter — Phase 24 (24-Aug-2026)
 * ===============================================
 * STATUS: built, NOT yet verified against a live network connection — see
 * config/websites/jalinanduta.json's "verificationLimitation" and
 * "compliance.actionRequired" fields for exactly what's confirmed vs not,
 * and what must happen before this is wired into scheduled polling
 * (backend/scheduler/run.js's ADAPTERS map, frontend/app.js's
 * REAL_ADAPTER_SUPPORT, .github/workflows/pages.yml, .github/workflows/
 * monitor.yml, or frontend/index.html's money-changer checkboxes — none of
 * those have been touched for this source, deliberately).
 *
 * Unlike mymoneymaster.adapter.js / tajmuhabath.adapter.js /
 * merchantradeasia.adapter.js, this file's selectors were NOT confirmed via
 * a real browser session (no headless-browser tool was available in the
 * environment this was authored in — see config's verificationLimitation).
 * What WAS confirmed: a text-extraction fetch of jalinanduta.com's homepage
 * returned a real, internally-consistent 44-row currency table. Because the
 * exact HTML tag/class/id structure behind that table is unknown, parseHtml()
 * below deliberately does NOT hardcode any CSS selector — it discovers the
 * rate table by reading ITS OWN header row (matching header text like
 * "Code" / "We Sell" / "We Buy", not fixed positions or classes), the same
 * structure-agnostic strategy config/websites/jalinanduta.json's
 * primarySelector.tableDiscovery describes. This is deliberately more
 * defensive than the other 3 adapters, to compensate for having less
 * verification confidence going in, not because it's a "better" general
 * strategy — prefer real confirmed selectors over header-sniffing whenever
 * they're actually available (see mymoneymaster.adapter.js for that case).
 *
 * Primary path: plain HTTP GET of config.liveRateUrl + cheerio parse via
 * the header-driven table/column discovery described above.
 * Fallback path (fetchRateViaPlaywright): same URL, same header-driven
 * parseHtml() logic, read from the rendered DOM instead of raw HTML —
 * covers the case where the primary path's assumption (rates are present
 * without JS execution) turns out to be wrong, or stops being true later.
 *
 * @see backend/scrapers/rateAdapter.interface.js for the required return shape
 */

const cheerio = require('cheerio');
const config = require('../../config/websites/jalinanduta.json');
const { validateRate } = require('../validation/validateRate');

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const FETCH_TIMEOUT_MS = 15_000;

/**
 * Header cell text -> which logical column it is, per
 * config.extraction.headerSynonyms (falls back to a small built-in default
 * if that config block is ever missing, so this never throws on a merely
 * incomplete config).
 */
function classifyHeaderCell(cellText, synonyms) {
  const t = cellText.trim().toLowerCase();
  if (!t) return null;
  const lists = synonyms || {
    code: ['code', 'currency code'],
    sell: ['we sell', 'sell', 'selling'],
    buy: ['we buy', 'buy', 'buying'],
  };
  for (const [column, phrases] of Object.entries(lists)) {
    if (phrases.some((p) => t === p || t.includes(p))) return column;
  }
  return null;
}

/**
 * Given a cheerio-loaded document, find the rate table by scanning every
 * <table> for a header row that yields both a "code" and a "sell" column.
 * Returns { $table, columnIndex: {code, sell, buy} } or null if nothing
 * on the page qualifies.
 */
function discoverRateTable($) {
  const synonyms = config.extraction && config.extraction.headerSynonyms;
  let found = null;

  $('table').each((_, table) => {
    if (found) return; // first qualifying table wins, per config's tableDiscovery note
    const $table = $(table);
    const headerCells = $table.find('tr').first().find('th, td');
    if (headerCells.length === 0) return;

    const columnIndex = {};
    headerCells.each((i, cell) => {
      const column = classifyHeaderCell($(cell).text(), synonyms);
      if (column && !(column in columnIndex)) columnIndex[column] = i;
    });

    if ('code' in columnIndex && 'sell' in columnIndex) {
      found = { $table, columnIndex };
    }
  });

  return found;
}

/**
 * Pure parsing function: given the raw HTML of config.liveRateUrl, extract
 * the buy/sell rate for the requested currency using header-driven column
 * discovery (see file header comment for why no CSS selector is hardcoded).
 *
 * @param {string} html
 * @param {string} currencyCode e.g. "CNY"
 * @returns {{ buyRate: number, sellRate: number } | null} null if no
 *   qualifying table was found, or no row matched this currency code
 */
function parseHtml(html, currencyCode) {
  const $ = cheerio.load(html);
  const table = discoverRateTable($);
  if (!table) return null;

  const { $table, columnIndex } = table;
  const rows = $table.find('tr').slice(1); // skip the header row already consumed

  let buyRate = null;
  let sellRate = null;

  rows.each((_, row) => {
    if (sellRate !== null) return; // already matched
    const cells = $(row).find('td, th');
    if (cells.length === 0) return;

    const codeCell = cells.eq(columnIndex.code).text().trim().toUpperCase();
    if (codeCell !== currencyCode.toUpperCase()) return;

    const sellText = cells.eq(columnIndex.sell).text().trim();
    const sellVal = parseFloat(sellText);
    if (!Number.isNaN(sellVal)) sellRate = sellVal;

    if ('buy' in columnIndex) {
      const buyText = cells.eq(columnIndex.buy).text().trim();
      const buyVal = parseFloat(buyText);
      if (!Number.isNaN(buyVal)) buyRate = buyVal;
    }
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
    sourceTimestamp: null, // this page's homepage table does not publish its own per-row timestamp
    status,
    validationStatus,
    ...(errorMessage ? { errorMessage } : {}),
  };
}

async function runExtraction(html, input) {
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
        `Could not locate a rate table with recognizable Code/We Sell/We Buy headers ` +
        `containing a "${input.currencyCode}" row on ${config.liveRateUrl}. ` +
        `Per config/websites/jalinanduta.json's verificationLimitation, this adapter's ` +
        `column discovery was never confirmed against a live run — inspect the real ` +
        `page's HTML now and adjust discoverRateTable()/classifyHeaderCell() if the ` +
        `page's actual header text differs from what was assumed.`,
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
 * Primary path: plain HTTP GET + cheerio parse.
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

  return runExtraction(html, input);
}

/**
 * Fallback path: same URL, rendered DOM via Playwright instead of raw HTML —
 * covers the case where the primary path's "rates are present without JS"
 * assumption turns out to be wrong. See config.playwrightFallbackReason.
 * @param {import('./rateAdapter.interface').RateAdapterInput} input
 */
async function fetchRateViaPlaywright(input) {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (err) {
    return buildResult({
      input,
      status: 'SOURCE_UNAVAILABLE',
      validationStatus: 'NOT_RUN',
      errorMessage: `Playwright fallback unavailable: ${err.message}`,
    });
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ userAgent: DEFAULT_USER_AGENT });
    await page.goto(config.liveRateUrl, { waitUntil: 'domcontentloaded', timeout: FETCH_TIMEOUT_MS });
    // Header-driven discovery needs at least one <table> attached with a
    // "Code"-like header cell — see config.waitStrategy.playwrightFallback.
    await page.waitForSelector('table', { timeout: FETCH_TIMEOUT_MS }).catch(() => {});
    const html = await page.content();
    return runExtraction(html, input);
  } catch (err) {
    return buildResult({
      input,
      status: 'SOURCE_UNAVAILABLE',
      validationStatus: 'NOT_RUN',
      errorMessage: `Playwright fetch failed: ${err.message}`,
    });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Tries the primary (HTTP) path first; falls back to Playwright only if the
 * primary path did not produce a LIVE result. Matches mymoneymaster.adapter.js's
 * own fetchRateWithFallback() pattern exactly.
 * @param {import('./rateAdapter.interface').RateAdapterInput} input
 */
async function fetchRateWithFallback(input) {
  const primary = await fetchRate(input);
  if (primary.status === 'LIVE') return primary;
  const fallback = await fetchRateViaPlaywright(input);
  return fallback.status === 'LIVE' ? fallback : primary;
}

module.exports = { fetchRate, fetchRateViaPlaywright, fetchRateWithFallback, parseHtml };
