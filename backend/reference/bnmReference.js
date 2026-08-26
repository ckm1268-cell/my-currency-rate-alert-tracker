/**
 * Bank Negara Malaysia (BNM) Open API reference rate lookup — Phase 31
 * (26-Aug-2026), added after the project owner asked how to make rate
 * validation more robust and independently confirmed (via PowerShell, since
 * this sandbox has no outbound network access to api.bnm.gov.my — same
 * constraint documented in config/websites/jalinanduta.json's
 * verificationLimitation) that BNM's public Interbank Foreign Exchange
 * Market rate is a genuine, free, official, no-key-required data feed.
 *
 * IMPORTANT — what this is NOT: this is not a money-changer rate, and it
 * is never used AS one. It is the government-published wholesale interbank
 * rate, which is always somewhat different from any specific money
 * changer's retail buy/sell rate (that's the money changer's margin). Using
 * it as a substitute "live rate" would directly violate this project's Core
 * Principle and Section 25 ("never silently substitute an alternative
 * source and label it as the original money changer's live rate"). Its
 * only job is backend/validation/bnmCrossCheck.js's sanity check: is a
 * scraped money changer reading in the same ballpark as BNM's own number,
 * or does it look like a decimal-placement/unit-scaling/extraction bug?
 * See that file for how the comparison itself is done and gated.
 *
 * Endpoint + response shape verified for real by the project owner via
 * `Invoke-RestMethod` on 26-Aug-2026 — this module is written against an
 * actual observed response, not documentation guesswork:
 *
 *   GET https://api.bnm.gov.my/public/exchange-rate/CNY?session=0900&quote=rm
 *   Header: Accept: application/vnd.BNM.API.v1+json
 *   ->
 *   {
 *     "data": {
 *       "currency_code": "CNY",
 *       "unit": 1,
 *       "rate": {
 *         "date": "2026-08-26",
 *         "buying_rate": 0.6002999999999994,
 *         "selling_rate": 0.6009999999999998,
 *         "middle_rate": 0.6006000000000002
 *       }
 *     },
 *     "meta": {
 *       "quote": "rm",
 *       "session": "0900",
 *       "last_updated": "2026-08-26 11:51:19",
 *       "total_result": 1
 *     }
 *   }
 *
 * "unit" is BNM's OWN denomination for that currency's rate (confirmed 1
 * for CNY in the response above) — this module reads it from the response
 * every time rather than assuming it's always 1, since standard forex
 * convention quotes low-value currencies (JPY, KRW, VND) per 100/1000/etc,
 * and BNM may do the same. See toAdapterUnit() below for the conversion
 * this makes possible.
 *
 * Session caveat, confirmed by hand: querying a session before it has
 * actually run today (e.g. session=1130 before 11:30am Malaysia time)
 * returns HTTP 404 {"message":"No records found.","code":404} — that
 * snapshot simply doesn't exist yet, not a malformed request. getBnmReferenceRate()
 * below tries a fixed list of sessions newest-to-oldest and uses the first
 * one that actually has data, rather than hardcoding a single session that
 * would fail for part of every day.
 */

'use strict';

const BASE_URL = 'https://api.bnm.gov.my/public/exchange-rate';
const ACCEPT_HEADER = 'application/vnd.BNM.API.v1+json';
const FETCH_TIMEOUT_MS = 8_000;

// Newest to oldest. BNM publishes intraday snapshots at these times; tried
// in this order so the cross-check uses the most recent one that actually
// exists yet today, without needing to know what time it is right now.
const SESSION_ORDER = ['1700', '1200', '1130', '0900'];

// These snapshots only change a handful of times a day, so cross-checking
// more often than this is pointless — cache each currency's result and
// reuse it across polling runs within the window.
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

const cache = new Map(); // currencyCode -> { expiresAt, result }

async function fetchOnce(currencyCode, session) {
  const url = `${BASE_URL}/${encodeURIComponent(currencyCode)}?session=${session}&quote=rm`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: ACCEPT_HEADER },
      signal: controller.signal,
    });
    if (res.status === 404) return null; // that session's snapshot doesn't exist (yet) today
    if (!res.ok) throw new Error(`BNM API HTTP ${res.status}`);
    const body = await res.json();
    const d = body && body.data;
    const r = d && d.rate;
    if (!d || !r || typeof r.middle_rate !== 'number') return null;
    return {
      currencyCode: d.currency_code,
      bnmUnit: typeof d.unit === 'number' && d.unit > 0 ? d.unit : 1,
      buyingRate: r.buying_rate,
      sellingRate: r.selling_rate,
      middleRate: r.middle_rate,
      rateDate: r.date,
      session,
      lastUpdated: body.meta && body.meta.last_updated,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches BNM's own published Interbank rate for a currency, trying each
 * session newest-first until one actually has data published for it today.
 * Returns null on ANY failure (network error, every session 404s,
 * malformed response) — never throws — because this is a best-effort
 * cross-check, not a source of truth, and must never block or fail a real
 * reading just because BNM's API is briefly unreachable.
 *
 * @param {string} currencyCode e.g. "CNY"
 * @returns {Promise<{currencyCode:string, bnmUnit:number, buyingRate:number,
 *   sellingRate:number, middleRate:number, rateDate:string, session:string,
 *   lastUpdated:string}|null>}
 */
async function getBnmReferenceRate(currencyCode) {
  const cached = cache.get(currencyCode);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  let result = null;
  for (const session of SESSION_ORDER) {
    try {
      // eslint-disable-next-line no-await-in-loop
      result = await fetchOnce(currencyCode, session);
      if (result) break;
    } catch (e) {
      // Network/timeout/parse error on this session — try the next one
      // rather than giving up on the whole cross-check for today.
    }
  }

  cache.set(currencyCode, { expiresAt: Date.now() + CACHE_TTL_MS, result });
  return result;
}

/**
 * Converts a BNM reference rate (quoted per bnmUnit, e.g. per 1 CNY) to the
 * same per-unit convention a money changer/adapter uses (e.g. per 100 CNY,
 * matching frontend/app.js's CURRENCIES convention), so the two numbers are
 * actually comparable. Pure function, no I/O — easy to unit test on its own.
 */
function toAdapterUnit(bnmRatePerBnmUnit, bnmUnit, adapterUnit) {
  if (!bnmUnit) return bnmRatePerBnmUnit;
  return (bnmRatePerBnmUnit / bnmUnit) * adapterUnit;
}

// Test-only escape hatch — lets tests/bnmCrossCheck.test.js and
// tests/bnmReference.test.js reset the module-level cache between cases
// without needing to reach into module internals.
function _clearCacheForTests() {
  cache.clear();
}

module.exports = { getBnmReferenceRate, toAdapterUnit, SESSION_ORDER, _clearCacheForTests };
