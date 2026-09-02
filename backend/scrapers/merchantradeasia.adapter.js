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
 * PHASE 55 (02-Sep-2026) — branch selection added, and the extraction
 * strategy inverted. Requested explicitly: check this site's official live
 * page for real branch selection and, if found, build it the same way as
 * Taj Muhabath / Wawasan Ilham / Jalinan Duta. A real connected-browser
 * session found the page had been redesigned since the 28-Aug-2026 (Phase
 * 46) verification to add a genuine "Select Branch" control whose value
 * really does change the Counter Exchange Rates table's numbers — see
 * config.branchNotes and config.notes' own Phase 55 entry for the full
 * evidence (real CNY figures compared live across 6 different branches).
 *
 * That same session found the page's own React app fires a plain,
 * unauthenticated GET to https://mtradeasia.com/api/exchange/soap?branch=
 * <code> whenever the branch selector changes — the exact same endpoint
 * this adapter's PRIMARY path now calls directly (see config.endpoint),
 * mirroring wawasanilham.adapter.js's own precedent for a page's own
 * confirmed JSON endpoint (not reverse-engineered, not authenticated
 * behind a token the page's own JS supplies — unlike Taj Muhabath's
 * internal API, which this project deliberately does NOT call for exactly
 * that reason; see tajmuhabath.adapter.js's header comment). No browser is
 * needed for the primary path any more.
 *
 * The OLD primary path — Playwright driving the real rendered page — is
 * kept as fetchRateViaPlaywright(), a defensive fallback for if the direct
 * endpoint is ever blocked. Its DOM selectors (config.primarySelector)
 * were re-confirmed live during this same Phase 55 session, byte-for-byte
 * unchanged from the original 22-Aug-2026 verification — only a branch-
 * select step was added ahead of it.
 *
 * IMPORTANT — a note on testing in this development environment: the pure
 * parsing halves of this adapter (parseJsonRates() and parseHtml()) are
 * unit-tested against real, live-captured fixtures. The Playwright-driving
 * half (fetchRateViaPlaywright itself) was proven correct by hand, live,
 * via real browser automation during this build — but a local run inside
 * this particular sandbox can fail with a Playwright browser-binary
 * mismatch specific to this dev environment (see mymoneymaster.adapter.js's
 * header comment for the same underlying reason). This is a sandbox
 * limitation, not a defect in the selectors or logic above. The real
 * GitHub Actions workflow (.github/workflows/pages.yml) runs `npx
 * playwright install --with-deps chromium` itself before calling this
 * adapter — treat that first real CI run as the actual end-to-end
 * confirmation of the fallback path's live network round-trip. The
 * primary (direct-GET) path needs no such caveat: it is a plain fetch(),
 * proven live during this same build session.
 *
 * @see backend/scrapers/rateAdapter.interface.js for the required return shape
 */

const cheerio = require('cheerio');
const config = require('../../config/websites/merchantradeasia.json');
const { validateRate } = require('../validation/validateRate');

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const FETCH_TIMEOUT_MS = 15_000;
const NAV_TIMEOUT_MS = 20_000;
const SETTLE_WAIT_MS = 5_000; // matches the window used during live verification

/**
 * Phase 55 (02-Sep-2026) — resolves a requested branch (id or display
 * name) against config.branches, matching jalinanduta.adapter.js's and
 * wawasanilham.adapter.js's own resolveBranch() exactly (same shape, same
 * "never silently guess" contract). Falls back to config.defaultBranch
 * when no branch was requested. Returns null for an unrecognized branch
 * rather than defaulting to the wrong one.
 *
 * @param {string} [requestedBranch]
 * @returns {{ id: string, name: string } | null}
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
 * Phase 55 (02-Sep-2026) — pure parsing function for the PRIMARY path:
 * given the parsed JSON body of config.endpoint's response (the
 * `{ data: [...] }` shape — see config.endpoint.description), extract the
 * buy/sell rate for the requested currency. Kept separate from the fetch
 * driving code so it can be unit-tested against a captured JSON fixture
 * without needing the network.
 *
 * @param {object} json parsed response body — must have a `data` array
 * @param {string} currencyCode e.g. "CNY"
 * @returns {{ buyRate: number, sellRate: number } | null} null if the
 *   currency's row could not be located or its values could not be parsed
 */
function parseJsonRates(json, currencyCode) {
  const displayName = config.currencyDisplayNames && config.currencyDisplayNames[currencyCode];
  if (!displayName) {
    throw new Error(
      `No currencyDisplayNames entry for "${currencyCode}" in ` +
      `config/websites/merchantradeasia.json — add one before requesting this currency.`
    );
  }
  if (!json || !Array.isArray(json.data)) return null;

  const needle = displayName.toUpperCase();
  const row = json.data.find((r) => String(r.long_name || '').toUpperCase().includes(needle));
  if (!row) return null;

  const unit = parseFloat(row.unit);
  const buyRaw = parseFloat(row.counter_webuy_rate);
  const sellRaw = parseFloat(row.counter_wesell_rate);
  if (Number.isNaN(unit) || Number.isNaN(buyRaw) || Number.isNaN(sellRaw)) return null;

  // Same per-unit-then-per-project-convention scaling parseHtml() below
  // already used — see config.unitScaleMultiplier's own notes (JPY is the
  // one case today). Applying it here means every caller always sees an
  // already-correctly-scaled value, never a raw endpoint number.
  const scale = (config.unitScaleMultiplier && config.unitScaleMultiplier[currencyCode]) || 1;
  const buyRate = Math.round(buyRaw * unit * scale * 10000) / 10000;
  const sellRate = Math.round(sellRaw * unit * scale * 10000) / 10000;
  return { buyRate, sellRate };
}

/**
 * Pure parsing function: given the RENDERED HTML of liveRateUrl (i.e.
 * page.content() after JS has populated the rows, not a raw fetch()),
 * extract the buy/sell rate for the requested currency. Used by the
 * Playwright fallback path only as of Phase 55 — see file header comment.
 * Kept separate from the Playwright driving code so it can be unit-tested
 * against a captured HTML fixture without needing a browser.
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

    // Phase 44 (28-Aug-2026): this site doesn't quote every currency in
    // this app's own per-unit convention (see config.unitScaleMultiplier's
    // own notes in config/websites/merchantradeasia.json — JPY is the one
    // case today, quoted per 100 units here vs. per 1,000 everywhere else
    // in this project). Applying the multiplier here, inside parseHtml(),
    // means every caller (fetchRateViaPlaywright() below, validateRate(),
    // and backend/validation/bnmCrossCheck.js's cross-check) always sees
    // an already-correctly-scaled value — never a raw number some caller
    // might forget to convert. Rounded to 4 decimal places (this site's
    // own observed precision for every currency) purely to avoid
    // floating-point noise from the multiplication (e.g. 2.4299 * 10
    // representing as 24.299000000000003) — not a meaningful rounding of
    // real precision.
    const scale = (config.unitScaleMultiplier && config.unitScaleMultiplier[currencyCode]) || 1;
    buyRate = Math.round(buyVal * scale * 10000) / 10000;
    sellRate = Math.round(sellVal * scale * 10000) / 10000;
  });

  if (buyRate === null || sellRate === null) return null;
  return { buyRate, sellRate };
}

function buildResult({ input, branch, buyRate, sellRate, status, validationStatus, errorMessage }) {
  return {
    source: config.id,
    branch: branch ?? null,
    currency: input.currencyCode,
    buyRate: buyRate ?? null,
    sellRate: sellRate ?? null,
    retrievedAt: new Date().toISOString(),
    sourceTimestamp: null, // neither the JSON endpoint nor the rendered page publishes a per-row timestamp
    status,
    validationStatus,
    ...(errorMessage ? { errorMessage } : {}),
  };
}

/**
 * Shared validation/result-building tail for both extraction paths — same
 * parsed-or-null shape either parseJsonRates() or parseHtml() returns.
 */
function buildFromParsed(parsed, input, branchName, sourceDescription) {
  if (!parsed) {
    return buildResult({
      input,
      branch: branchName,
      status: 'EXTRACTION_ERROR',
      validationStatus: 'NOT_RUN',
      errorMessage:
        `Could not locate a "${input.currencyCode}" row (looked for display name ` +
        `"${config.currencyDisplayNames[input.currencyCode]}") in ${sourceDescription} for ` +
        `branch "${branchName}". The page's or endpoint's structure may have changed — see ` +
        `config/websites/merchantradeasia.json.`,
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
 * Primary path (Phase 55): direct GET to the same JSON endpoint the
 * page's own React app calls when its branch selector changes — see
 * config.endpoint and this file's header comment.
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
        `Refusing to guess a branch code rather than silently defaulting to the wrong branch.`,
    });
  }

  const url = config.endpoint.url.replace('{branchId}', branch.id);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let json;
  try {
    const res = await fetch(url, {
      method: config.endpoint.method || 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        Accept: 'application/json',
        Referer: config.liveRateUrl,
      },
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

  let parsed;
  try {
    parsed = parseJsonRates(json, input.currencyCode);
  } catch (err) {
    return buildResult({
      input,
      branch: branch.name,
      status: 'EXTRACTION_ERROR',
      validationStatus: 'NOT_RUN',
      errorMessage: `Parse threw: ${err.message}`,
    });
  }

  return buildFromParsed(parsed, input, branch.name, `${url}`);
}

/**
 * Fallback path: real headless browser, real page, real branch
 * <select id="branch"> — for defense against the primary (direct-GET)
 * path ever being blocked. Reuses the exact DOM selectors
 * (config.primarySelector) this adapter used as its only path before
 * Phase 55.
 *
 * @param {import('./rateAdapter.interface').RateAdapterInput} input
 * @returns {Promise<import('./rateAdapter.interface').StandardRateResult>}
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
    await page.waitForSelector(config.primarySelector.rowSelector, { timeout: NAV_TIMEOUT_MS });
    await page.waitForSelector('#branch', { timeout: NAV_TIMEOUT_MS });
    await page.selectOption('#branch', { value: branch.id });

    // Selecting fires the page's own onchange, which re-hits
    // config.endpoint itself — wait for that exact response before
    // reading the table, rather than a fixed timer alone.
    await page
      .waitForResponse((res) => res.url().includes('/api/exchange/soap') && res.url().includes(branch.id), {
        timeout: NAV_TIMEOUT_MS,
      })
      .catch(() => {});
    await page.waitForTimeout(SETTLE_WAIT_MS);

    const html = await page.content();
    let parsed;
    try {
      parsed = parseHtml(html, input.currencyCode);
    } catch (err) {
      return buildResult({
        input,
        branch: branch.name,
        status: 'EXTRACTION_ERROR',
        validationStatus: 'NOT_RUN',
        errorMessage: `Parse threw: ${err.message}`,
      });
    }
    return buildFromParsed(parsed, input, branch.name, config.primarySelector.rowSelector);
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
 * Tries the primary (direct-GET) path first; falls back to Playwright
 * only if the primary path did not produce a LIVE result. Matches every
 * other branch-aware adapter's own fetchRateWithFallback() pattern
 * exactly.
 * @param {import('./rateAdapter.interface').RateAdapterInput} input
 * @returns {Promise<import('./rateAdapter.interface').StandardRateResult>}
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
  parseJsonRates,
  parseHtml,
  resolveBranch,
  config,
};
