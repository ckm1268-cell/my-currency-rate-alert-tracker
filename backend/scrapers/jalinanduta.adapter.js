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
 * Phase 52 (02-Sep-2026) — resolves a requested branch (id or display
 * name) against config.branches, matching wawasanilham.adapter.js's own
 * resolveBranch() exactly (same shape, same "never silently guess"
 * contract). Falls back to config.defaultBranch when no branch was
 * requested. Returns null for an unrecognized branch rather than
 * defaulting to the wrong one.
 *
 * @param {string} [requestedBranch]
 * @returns {{ id: string, name: string, url: string } | null}
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
 * Returns { found, tableCount } where found is either
 * { $table, columnIndex: {code, sell, buy} } or null if nothing on the
 * page qualifies, and tableCount is how many <table> elements were on
 * the page at all (used by diagnoseFailure() below to tell "no tables"
 * apart from "tables, but none with the right headers").
 */
function discoverRateTable($) {
  const synonyms = config.extraction && config.extraction.headerSynonyms;
  let found = null;
  let tableCount = 0;

  $('table').each((_, table) => {
    tableCount++;
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

  return { found, tableCount };
}

/**
 * Phase 59 (02-Sep-2026) — turns a raw HTML string into a short, concrete
 * diagnostic sentence for when parseHtml() below fails, so an
 * EXTRACTION_ERROR's own errorMessage says WHICH of these actually
 * happened instead of just "could not locate a table":
 *   1. No <table> tag anywhere in the response at all -- the single
 *      strongest signal the page returned was NOT the real rates page
 *      (a bot-check/WAF challenge, a maintenance page, or an error page
 *      commonly return 200 with ordinary-looking HTML but no <table>).
 *   2. A <table> exists, but none of them have a header row this
 *      adapter's own classifyHeaderCell() recognizes as both a "code"
 *      and a "sell" column -- points at a genuine site redesign.
 *   3. A qualifying table was found, but no row's code column matched
 *      the requested currency -- the table exists and looks right, but
 *      this one currency's own row is missing (removed, or a text
 *      variant classifyHeaderCell()/the code match didn't anticipate).
 * Deliberately a plain string match, not a second cheerio parse -- this
 * only has to be diagnostic-quality, not another extraction path.
 *
 * @param {string} html
 * @param {string} currencyCode
 * @param {ReturnType<typeof discoverRateTable>} tableResult
 * @returns {string}
 */
function diagnoseFailure(html, currencyCode, tableResult) {
  const hasTableTag = /<table[\s>]/i.test(html);
  if (!hasTableTag) {
    return (
      `[diagnostic] The response (${html.length} chars) contains NO <table> tag at all. ` +
      `This usually means the page returned was not the real rates page -- a bot-check/` +
      `WAF challenge, a maintenance page, or an error page can all return HTTP 200 with a ` +
      `normal-looking body but no rates table. The live site's real structure was manually ` +
      `re-confirmed working (a real browser session, DevTools DOM read) shortly before this ` +
      `code shipped, so a NO-<table> result from the scheduled job specifically -- while a ` +
      `manual check passes -- points at the requester (this job's own IP/User-Agent) getting ` +
      `treated differently by the host, not a real site redesign.`
    );
  }
  if (!tableResult || !tableResult.found) {
    return (
      `[diagnostic] The response has a <table> tag, but none of the ${tableResult ? tableResult.tableCount : '?'} ` +
      `table(s) on the page have a header row classifyHeaderCell() recognizes as both a ` +
      `"code" and a "sell" column. This points at a genuine header-text change on the site ` +
      `-- inspect the page's real header row text now and update classifyHeaderCell()'s ` +
      `synonym lists (or config.extraction.headerSynonyms) to match.`
    );
  }
  const codeAppears = new RegExp(currencyCode, 'i').test(html);
  return (
    `[diagnostic] A qualifying rate table was found, but no row's code column matched ` +
    `"${currencyCode}". The text "${currencyCode}" ${codeAppears ? 'DOES' : 'does NOT'} appear ` +
    `anywhere else in the response, which ${codeAppears
      ? 'suggests the row exists but in a shape this code did not match (e.g. a table cell ' +
        'this adapter is not reading, or extra whitespace/formatting around the code) -- ' +
        'inspect that row directly.'
      : 'suggests this currency genuinely has no row on this page right now (removed, or ' +
        'renamed) rather than a parsing bug.'}`
  );
}

/**
 * Pure parsing function: given the raw HTML of config.liveRateUrl, extract
 * the buy/sell rate for the requested currency using header-driven column
 * discovery (see file header comment for why no CSS selector is hardcoded).
 * Returns null on any failure (no qualifying table, or no row matching
 * this currency code) -- this function's contract is unchanged from
 * before Phase 59 and is relied on elsewhere, including this file's own
 * tests. When it does return null, runExtraction() below separately
 * calls discoverRateTable() + diagnoseFailure() to explain WHY, rather
 * than this function taking on that job itself.
 *
 * @param {string} html
 * @param {string} currencyCode e.g. "CNY"
 * @returns {{ buyRate: number, sellRate: number } | null}
 */
function parseHtml(html, currencyCode) {
  const $ = cheerio.load(html);
  const { found } = discoverRateTable($);
  if (!found) return null;

  const { $table, columnIndex } = found;
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

function buildResult({ input, branch, buyRate, sellRate, status, validationStatus, errorMessage }) {
  return {
    source: config.id,
    branch: branch ?? null,
    currency: input.currencyCode,
    buyRate: buyRate ?? null,
    sellRate: sellRate ?? null,
    retrievedAt: new Date().toISOString(),
    sourceTimestamp: null, // none of this site's pages publish their own per-row timestamp
    status,
    validationStatus,
    ...(errorMessage ? { errorMessage } : {}),
  };
}

async function runExtraction(html, input, branchName, sourceUrl) {
  let parsed;
  try {
    parsed = parseHtml(html, input.currencyCode);
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
    let diagnostic;
    try {
      const $ = cheerio.load(html);
      const tableResult = discoverRateTable($);
      diagnostic = diagnoseFailure(html, input.currencyCode, tableResult);
    } catch (diagErr) {
      diagnostic = `[diagnostic] Diagnostic re-parse itself threw: ${diagErr.message}`;
    }
    return buildResult({
      input,
      branch: branchName,
      status: 'EXTRACTION_ERROR',
      validationStatus: 'NOT_RUN',
      errorMessage:
        `Could not locate a "${input.currencyCode}" row in a recognizable Code/We Sell/We Buy ` +
        `rate table on ${sourceUrl || config.liveRateUrl}. This adapter's extraction logic ` +
        `was manually confirmed working against this site's real branch pages on 02-Sep-2026 ` +
        `(see config/websites/jalinanduta.json's branchNotes) -- so a failure here now is ` +
        `unexpected, not an unverified guess. ${diagnostic}`,
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
 * Primary path: plain HTTP GET + cheerio parse, against whichever
 * branch's own URL was requested (config.branches — see resolveBranch()
 * above). Defaults to config.defaultBranch when no branch is given, and
 * refuses to fetch anything for an unrecognized branch rather than
 * silently falling back to a different one.
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
        `Refusing to guess a branch rather than silently defaulting to the wrong one.`,
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let html;
  try {
    html = await fetchHtml(branch.url, { signal: controller.signal });
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

  return runExtraction(html, input, branch.name, branch.url);
}

/**
 * Fallback path: same branch URL, rendered DOM via Playwright instead of
 * raw HTML — covers the case where the primary path's "rates are present
 * without JS" assumption turns out to be wrong. See config.playwrightFallbackReason.
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
    await page.goto(branch.url, { waitUntil: 'domcontentloaded', timeout: FETCH_TIMEOUT_MS });
    // Header-driven discovery needs at least one <table> attached with a
    // "Code"-like header cell — see config.waitStrategy.playwrightFallback.
    await page.waitForSelector('table', { timeout: FETCH_TIMEOUT_MS }).catch(() => {});
    const html = await page.content();
    return runExtraction(html, input, branch.name, branch.url);
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

module.exports = { fetchRate, fetchRateViaPlaywright, fetchRateWithFallback, parseHtml, resolveBranch };
