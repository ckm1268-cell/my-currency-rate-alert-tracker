/**
 * Taj Muhabath adapter — Phase 3
 * ===============================
 * STATUS: implemented and unit-tested against a real, freshly re-verified
 * page structure (see config/websites/tajmuhabath.json — re-verified live
 * 21-Aug-2026 during this Phase 3 build; the table structure was found
 * UNCHANGED from the original architecture review's inspection, unlike My
 * Money Master which had drifted between Phase 1 and Phase 2).
 *
 * Unlike My Money Master, there is no HTTP-only primary path for this
 * site: a plain fetch() of liveRateUrl returns table#example1 with an
 * EMPTY <tbody> (confirmed live, again, during this build) — every
 * currency row is filled in by client-side JavaScript after page load.
 * Playwright is therefore the only extraction path, not a fallback.
 *
 * A NOTE ON THE INTERNAL API — read before "optimizing" this adapter:
 * while re-verifying branch-switching behavior live, the browser's network
 * log showed the page's branch dropdown triggers a POST to
 * https://fx.tajmuhabath.com.my/rbapi/WebRbService.svc/json/getdailyratesapi
 * which returns the actual rate data as JSON — tempting to call directly
 * instead of scraping the rendered table. That was deliberately NOT done:
 * an unauthenticated call to that endpoint returns
 * {"appError":{"ErrCode":-104,"ErrMsg":"user not authorized to access.!"}},
 * meaning the page's own JS supplies some token/session this adapter does
 * not have and should not attempt to reverse-engineer or replicate — doing
 * so would mean working around an access control, which both this
 * project's compliance rules and this assistant's own operating rules
 * prohibit. Stick to driving the real public page with a real (headless)
 * browser, exactly as the project brief specifies for this site.
 *
 * @see backend/scrapers/rateAdapter.interface.js for the required return shape
 */

const cheerio = require('cheerio');
const config = require('../../config/websites/tajmuhabath.json');
const { validateRate } = require('../validation/validateRate');

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const NAV_TIMEOUT_MS = 20_000;
const SETTLE_WAIT_MS = 4_000; // let staggered row population finish

// How old a row's own "Last Updated" timestamp can be before we flag the
// reading STALE instead of LIVE, even though it was successfully and
// freshly retrieved. See config.validation.sourceTimestampStalenessNote
// for why this is a generous, low-confidence judgment call rather than a
// precisely-derived number.
const STALENESS_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Parses this site's specific "DD-MM-YYYY hh:mm:ss AM/PM" timestamp format
 * into an ISO 8601 string. Deliberately NOT using Date.parse() directly on
 * the raw string — that format is ambiguous/locale-dependent across JS
 * engines (DD-MM vs MM-DD) and could silently misparse.
 *
 * @param {string} raw e.g. "21-08-2026 10:40:06 AM"
 * @returns {string|null} ISO timestamp, or null if unparseable
 */
function parseTajTimestamp(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.trim().match(
    /^(\d{2})-(\d{2})-(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i
  );
  if (!m) return null;

  const [, dd, mm, yyyy, hh12Str, min, sec, ampm] = m;
  let hh24 = parseInt(hh12Str, 10) % 12;
  if (ampm.toUpperCase() === 'PM') hh24 += 12;

  // Site does not publish a timezone; treat as Malaysia local time (UTC+8),
  // which is the only market this site serves.
  const iso = `${yyyy}-${mm}-${dd}T${String(hh24).padStart(2, '0')}:${min}:${sec}+08:00`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Pure parsing function: given the RENDERED HTML of liveRateUrl (i.e.
 * page.content() after JS has populated the table, not a raw fetch()),
 * extract the buy/sell rate and source timestamp for the requested
 * currency. Kept separate from the Playwright driving code so it can be
 * unit-tested against a captured HTML fixture without needing a browser.
 *
 * @param {string} html
 * @param {string} currencyCode e.g. "CNY"
 * @returns {{ buyRate: number, sellRate: number, sourceTimestamp: string|null } | null}
 *   null if the currency's row could not be located or its cells could not
 *   be parsed
 */
function parseHtml(html, currencyCode) {
  const $ = cheerio.load(html);
  const { codeCellIndex, buyCellIndex, sellCellIndex, lastUpdatedCellIndex } =
    config.primarySelector;

  let result = null;

  $(config.primarySelector.tableSelector)
    .find(config.primarySelector.rowSelector)
    .each((_, row) => {
      if (result) return; // already found it

      const cells = $(row).find('td');
      if (cells.length <= Math.max(codeCellIndex, buyCellIndex, sellCellIndex, lastUpdatedCellIndex)) {
        return;
      }

      const code = $(cells[codeCellIndex]).text().trim();
      if (code !== currencyCode) return;

      const buyRaw = $(cells[buyCellIndex]).text().trim();
      const sellRaw = $(cells[sellCellIndex]).text().trim();
      const buyRate = parseFloat(buyRaw);
      const sellRate = parseFloat(sellRaw);
      if (Number.isNaN(buyRate) || Number.isNaN(sellRate)) return;

      const lastUpdatedRaw = $(cells[lastUpdatedCellIndex]).text().trim();
      const sourceTimestamp = parseTajTimestamp(lastUpdatedRaw);

      result = { buyRate, sellRate, sourceTimestamp };
    });

  return result;
}

function buildResult({ input, buyRate, sellRate, sourceTimestamp, branch, status, validationStatus, errorMessage }) {
  return {
    source: config.id,
    branch: branch ?? null,
    currency: input.currencyCode,
    buyRate: buyRate ?? null,
    sellRate: sellRate ?? null,
    retrievedAt: new Date().toISOString(),
    sourceTimestamp: sourceTimestamp ?? null,
    status,
    validationStatus,
    ...(errorMessage ? { errorMessage } : {}),
  };
}

/**
 * Primary (and only) extraction path: Playwright, real rendered DOM.
 * Optionally selects a branch first via the site's own dropdown.
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
      branch: input.branch || null,
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
    await page.waitForSelector(`${config.primarySelector.tableSelector} tbody tr`, { timeout: NAV_TIMEOUT_MS });

    let branchUsed = null;
    if (input.branch) {
      try {
        await page.selectOption(config.branchSelector, { label: input.branch });
        branchUsed = input.branch;
      } catch (err) {
        return buildResult({
          input,
          branch: input.branch,
          status: 'EXTRACTION_ERROR',
          validationStatus: 'NOT_RUN',
          errorMessage: `Could not select branch "${input.branch}" via ${config.branchSelector}: ${err.message}`,
        });
      }
    } else {
      // No branch requested — read whatever branch the page defaulted to,
      // rather than silently pretending no branch is in effect.
      try {
        branchUsed = await page.locator(`${config.branchSelector} option:checked`).first().textContent();
        branchUsed = branchUsed ? branchUsed.trim() : null;
      } catch {
        branchUsed = null; // non-fatal — proceed without a branch label
      }
    }

    // Let staggered row population (and, if we just switched branches, the
    // resulting re-fetch) settle before reading.
    await page.waitForTimeout(SETTLE_WAIT_MS);

    const html = await page.content();
    const parsed = parseHtml(html, input.currencyCode);

    if (!parsed) {
      return buildResult({
        input,
        branch: branchUsed,
        status: 'EXTRACTION_ERROR',
        validationStatus: 'NOT_RUN',
        errorMessage:
          `Could not locate a "${input.currencyCode}" row in ${config.primarySelector.tableSelector} ` +
          `(matched by the Code column, cell index ${config.primarySelector.codeCellIndex}). ` +
          `The page's structure may have changed — see config/websites/tajmuhabath.json.`,
      });
    }

    const { buyRate, sellRate, sourceTimestamp } = parsed;
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
        branch: branchUsed,
        buyRate,
        sellRate,
        sourceTimestamp,
        status: 'RATE_VALIDATION_ERROR',
        validationStatus: 'FAILED',
        errorMessage: validation.reasons.join('; '),
      });
    }

    // Reading is sane — decide LIVE vs STALE based on the SOURCE's own
    // claimed timestamp, not just how recently we fetched it (see
    // config.validation.sourceTimestampStalenessNote).
    let status = 'LIVE';
    let errorMessage;
    if (sourceTimestamp) {
      const ageMs = Date.now() - new Date(sourceTimestamp).getTime();
      if (ageMs > STALENESS_THRESHOLD_MS) {
        status = 'STALE';
        errorMessage =
          `Row was successfully retrieved and passed validation, but the source's own ` +
          `"Last Updated" timestamp (${sourceTimestamp}) is more than ` +
          `${Math.round(STALENESS_THRESHOLD_MS / 3_600_000)}h old — the underlying rate ` +
          `may simply not have moved recently rather than the scrape being broken, but ` +
          `per the project's LIVE/STALE distinction requirement this is not labeled LIVE.`;
      }
    }

    return buildResult({
      input,
      branch: branchUsed,
      buyRate,
      sellRate,
      sourceTimestamp,
      status,
      validationStatus: 'PASSED',
      ...(errorMessage ? { errorMessage } : {}),
    });
  } catch (err) {
    return buildResult({
      input,
      branch: input.branch || null,
      status: 'SOURCE_UNAVAILABLE',
      validationStatus: 'NOT_RUN',
      errorMessage: err.message,
    });
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Same entry-point name as the My Money Master adapter (fetchRateWithFallback)
 * for a uniform interface across adapters used by backend/scripts/checkRate.js
 * — but there IS no fallback here, since Playwright is already the primary
 * (and only) path. Kept as a thin alias so the caller doesn't need to know
 * which adapters have a fallback and which don't.
 *
 * @param {import('./rateAdapter.interface').RateAdapterInput} input
 * @returns {Promise<import('./rateAdapter.interface').StandardRateResult>}
 */
async function fetchRateWithFallback(input) {
  return fetchRate(input);
}

module.exports = { fetchRate, fetchRateWithFallback, parseHtml, parseTajTimestamp, config };
