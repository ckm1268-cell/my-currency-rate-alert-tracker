/**
 * Wawasan Ilham adapter — built 01-Sep-2026
 * ===========================================
 * STATUS: built from real, live-captured data (see
 * config/websites/wawasanilham.json's verificationLimitation for the full
 * chain of evidence) but NOT YET run end-to-end against the live site from
 * a machine with real network access, and NOT YET wired into scheduled
 * polling (see config's compliance.actionRequired). Run
 * `node backend/scripts/checkRate.js wawasanilham CNY --branch=6` for real
 * before enabling this in production.
 *
 * Unlike Jalinan Duta (built from a text-extraction fetch only, with no
 * confirmed HTML structure) or Taj Muhabath (requires a full headless
 * browser because rates are empty until client-side JS populates them),
 * this adapter's design was possible because the project owner captured,
 * directly from their own browser session: the real <select id="branch_id">
 * options, the real network request the page's own JS makes
 * (POST site/getRateHistory/{branch_id}), the real JSON response shape,
 * and a real full sample of rendered rows. See config's notes for the full
 * back-and-forth this was built from, including a per-currency endpoint
 * (site/getCurrencyDetails) that was investigated and confirmed to be
 * UNRELATED to this table (it only powers the page's own currency-converter
 * widget) — deliberately not used here.
 *
 * Primary path: a direct POST to the same JSON endpoint the page's own JS
 * calls, parsed with cheerio (no browser needed — see config's
 * requiresBrowserAutomationReason for why this is not "bypassing" anything).
 * Fallback path: Playwright, driving the real page and real branch dropdown,
 * for defense against the primary path ever being blocked.
 *
 * @see backend/scrapers/rateAdapter.interface.js for the required return shape
 */

const cheerio = require('cheerio');
const config = require('../../config/websites/wawasanilham.json');
const { validateRate } = require('../validation/validateRate');

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const FETCH_TIMEOUT_MS = 15_000;
const NAV_TIMEOUT_MS = 20_000;

/**
 * Resolves a requested branch (id or display name) against config.branches.
 * Falls back to config.defaultBranch if none was requested.
 *
 * @param {string} [requestedBranch]
 * @returns {{ id: string, name: string } | null} null if requestedBranch
 *   was given but does not match any known branch (never silently guesses)
 */
function resolveBranch(requestedBranch) {
  const branches = config.branches || [];
  if (!requestedBranch) {
    return branches.find((b) => b.id === config.defaultBranch) || branches[0] || null;
  }
  const needle = String(requestedBranch).trim().toLowerCase();
  return (
    branches.find(
      (b) => b.id === String(requestedBranch) || b.name.toLowerCase() === needle
    ) || null
  );
}

/**
 * Given the currency-table cell's own display name (e.g. "Chinese Renminbi"),
 * resolves it to an ISO code using config.currencyDisplayNames — the table
 * itself has no ISO-code column (confirmed live; see config's
 * primarySelector.currencyMatchStrategy), so name-matching is the only
 * option, not a shortcut taken to avoid harder work.
 *
 * @param {string} displayName
 * @returns {string | null}
 */
function resolveCurrencyCode(displayName) {
  if (!displayName) return null;
  const key = displayName.trim().toUpperCase();
  const map = config.currencyDisplayNames || {};
  return map[key] || null;
}

/**
 * Pure parsing function: given the raw 'table' HTML fragment from a
 * getRateHistory JSON response, extract the buy/sell rate for the
 * requested currency code.
 *
 * Fixed column positions are used (see config.primarySelector — this
 * fragment has no header row at all, confirmed live, so there is nothing
 * for header-driven discovery like jalinanduta.adapter.js to key off).
 *
 * @param {string} tableHtml
 * @param {string} currencyCode e.g. "CNY"
 * @returns {{ buyRate: number, sellRate: number, unit: number, updatedRaw: string|null } | null}
 */
function parseTableHtml(tableHtml, currencyCode) {
  if (!tableHtml) return null;
  const $ = cheerio.load(`<table>${tableHtml}</table>`);
  const { unitCellIndex, buyCellIndex, sellCellIndex, updatedCellIndex } = config.primarySelector;

  let result = null;

  $('tr').each((_, row) => {
    if (result) return; // first match wins

    const cells = $(row).find('td');
    if (cells.length <= Math.max(unitCellIndex, buyCellIndex, sellCellIndex, updatedCellIndex)) {
      return;
    }

    // Name lives in a nested span; fall back to the whole first cell's text
    // if that span is ever restructured (see config.primarySelector.nameCellSelector).
    const nameCell = cells.eq(0);
    const nameText =
      nameCell.find('span.currency-txt').first().text().trim() || nameCell.text().trim();

    const code = resolveCurrencyCode(nameText);
    if (!code || code !== currencyCode.toUpperCase()) return;

    const unitRaw = cells.eq(unitCellIndex).text().trim();
    const buyRaw = cells.eq(buyCellIndex).text().trim();
    const sellRaw = cells.eq(sellCellIndex).text().trim();
    const updatedRaw = cells.eq(updatedCellIndex).text().trim() || null;

    const unit = parseFloat(unitRaw);
    const buyRate = parseFloat(buyRaw);
    const sellRate = parseFloat(sellRaw);
    if (Number.isNaN(buyRate) || Number.isNaN(sellRate)) return;

    result = {
      buyRate,
      sellRate,
      unit: Number.isNaN(unit) ? 1 : unit,
      updatedRaw,
    };
  });

  return result;
}

function buildResult({ input, branch, buyRate, sellRate, status, validationStatus, errorMessage }) {
  return {
    source: config.id,
    branch: branch ?? null,
    currency: input.currencyCode,
    buyRate: buyRate ?? null,
    sellRate: sellRate ?? null,
    retrievedAt: new Date().toISOString(),
    // The site's "last updated" cell is time-only (e.g. "12:47 PM"), no
    // date and no timezone — confirmed live. Constructing a full ISO
    // timestamp from that would mean guessing "today" in some timezone,
    // which is exactly the kind of unverified assumption this project
    // avoids; sourceTimestamp is left null rather than fabricated.
    sourceTimestamp: null,
    status,
    validationStatus,
    ...(errorMessage ? { errorMessage } : {}),
  };
}

async function runExtraction(tableHtml, input, branchName) {
  let parsed;
  try {
    parsed = parseTableHtml(tableHtml, input.currencyCode);
  } catch (err) {
    return buildResult({
      input,
      branch: branchName,
      status: 'EXTRACTION_ERROR',
      validationStatus: 'NOT_RUN',
      errorMessage: `Parse threw: ${err.message}`,
    });
  }

  if (!parsed) {
    return buildResult({
      input,
      branch: branchName,
      status: 'EXTRACTION_ERROR',
      validationStatus: 'NOT_RUN',
      errorMessage:
        `Could not find a "${input.currencyCode}" row in branch "${branchName}"'s rate table, ` +
        `or config.currencyDisplayNames has no mapping for this currency's on-page display name. ` +
        `Per project brief section 23, this is reported honestly as "source structure may have ` +
        `changed" rather than silently returning a stale or fabricated value.`,
    });
  }

  const { buyRate, sellRate } = parsed;
  const expectedRange =
    config.validation && config.validation.expectedRange && config.validation.expectedRange[input.currencyCode];

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
      branch: branchName,
      buyRate,
      sellRate,
      status: 'RATE_VALIDATION_ERROR',
      validationStatus: 'FAILED',
      errorMessage: validation.reasons.join('; '),
    });
  }

  return buildResult({
    input,
    branch: branchName,
    buyRate,
    sellRate,
    status: 'LIVE',
    validationStatus: 'PASSED',
  });
}

/**
 * Primary path: direct POST to the same JSON endpoint the page's own JS
 * calls (config.endpoint), no browser needed — see config's
 * requiresBrowserAutomationReason.
 *
 * @param {import('./rateAdapter.interface').RateAdapterInput} input
 * @returns {Promise<import('./rateAdapter.interface').StandardRateResult>}
 */
async function fetchRate(input) {
  if (!input || !input.currencyCode) {
    throw new Error('fetchRate(input): input.currencyCode is required');
  }

  const branch = resolveBranch(input.branch);
  if (!branch) {
    return buildResult({
      input,
      branch: input.branch || null,
      status: 'EXTRACTION_ERROR',
      validationStatus: 'NOT_RUN',
      errorMessage: `Unknown branch "${input.branch}" — not one of config.branches. ` +
        `Refusing to guess a branch_id rather than silently defaulting to the wrong branch.`,
    });
  }

  const url = config.endpoint.url.replace('{branchId}', branch.id);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let json;
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: config.liveRateUrl,
        Origin: 'https://www.wawasanilham.com',
      },
      body: '',
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    json = await res.json();
  } catch (err) {
    return buildResult({
      input,
      branch: branch.name,
      status: 'SOURCE_UNAVAILABLE',
      validationStatus: 'NOT_RUN',
      errorMessage: `Fetch failed: ${err.message}`,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!json || typeof json.table !== 'string') {
    return buildResult({
      input,
      branch: branch.name,
      status: 'EXTRACTION_ERROR',
      validationStatus: 'NOT_RUN',
      errorMessage:
        `Response from ${url} did not include the expected "table" field as a string. ` +
        `Per config.endpoint.responseShape, this may mean the site's API shape has changed.`,
    });
  }

  return runExtraction(json.table, input, branch.name);
}

/**
 * Fallback path: real headless browser, real page, real branch dropdown —
 * for defense against the primary (direct-POST) path ever being blocked.
 * @param {import('./rateAdapter.interface').RateAdapterInput} input
 */
async function fetchRateViaPlaywright(input) {
  const branch = resolveBranch(input.branch);
  if (!branch) {
    return buildResult({
      input,
      branch: input.branch || null,
      status: 'EXTRACTION_ERROR',
      validationStatus: 'NOT_RUN',
      errorMessage: `Unknown branch "${input.branch}" — not one of config.branches.`,
    });
  }

  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (err) {
    return buildResult({
      input,
      branch: branch.name,
      status: 'SOURCE_UNAVAILABLE',
      validationStatus: 'NOT_RUN',
      errorMessage: `Playwright fallback unavailable: ${err.message}`,
    });
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ userAgent: DEFAULT_USER_AGENT });
    await page.goto(config.liveRateUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    await page.waitForSelector('#branch_id', { timeout: NAV_TIMEOUT_MS });
    await page.selectOption('#branch_id', { value: branch.id });
    // Selecting fires the page's own onchange (getRateHistory) — wait for
    // the resulting table to actually populate before reading it.
    await page.waitForFunction(
      () => {
        const el = document.querySelector('#rateHistoryTable');
        return el && el.querySelectorAll('tr').length > 0;
      },
      { timeout: NAV_TIMEOUT_MS }
    ).catch(() => {});
    const tableHtml = await page.$eval('#rateHistoryTable', (el) => el.innerHTML).catch(() => null);
    return runExtraction(tableHtml, input, branch.name);
  } catch (err) {
    return buildResult({
      input,
      branch: branch.name,
      status: 'SOURCE_UNAVAILABLE',
      validationStatus: 'NOT_RUN',
      errorMessage: `Playwright fetch failed: ${err.message}`,
    });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Tries the primary (direct-POST) path first; falls back to Playwright
 * only if the primary path did not produce a LIVE result. Matches every
 * other adapter's own fetchRateWithFallback() pattern exactly.
 * @param {import('./rateAdapter.interface').RateAdapterInput} input
 */
async function fetchRateWithFallback(input) {
  const primary = await fetchRate(input);
  if (primary.status === 'LIVE') return primary;
  const fallback = await fetchRateViaPlaywright(input);
  return fallback.status === 'LIVE' ? fallback : primary;
}

module.exports = {
  fetchRate,
  fetchRateViaPlaywright,
  fetchRateWithFallback,
  parseTableHtml,
  resolveBranch,
  resolveCurrencyCode,
};
