/**
 * BNM reference-rate cross-check — Phase 31 (26-Aug-2026).
 *
 * An ADDITIONAL sanity layer on top of (never instead of) each adapter's
 * own backend/validation/validateRate.js expectedRange check. Compares a
 * scraped money changer reading against Bank Negara Malaysia's own
 * published Interbank rate for the same currency (see
 * backend/reference/bnmReference.js for the API details and why this is
 * never used as a substitute rate — only a cross-check).
 *
 * Where this is called from: backend/scheduler/run.js's checkCombo(), only
 * for readings that already passed the adapter's own validation and came
 * back LIVE or STALE. If the deviation from BNM's own number is grossly
 * large (see GROSS_DEVIATION_THRESHOLD_PCT below), the scheduler downgrades
 * that reading to RATE_VALIDATION_ERROR instead of writing it as
 * LIVE/STALE — the same "prevent false alerts" outcome Section 9 of the
 * project brief describes for a decimal-placement bug, just caught by an
 * independent live benchmark instead of only a static min/max.
 */

'use strict';

const { getBnmReferenceRate: defaultGetBnmReferenceRate, toAdapterUnit } = require('../reference/bnmReference');

// Phase 49 (29-Aug-2026): this used to be a hand-typed object literal
// here, independently "matching" a convention that frontend/app.js's
// CURRENCIES list and every config/websites/*.json adapter's own notes
// only ever described in prose, never enforced in code — the same
// hand-duplication risk Phase 48 removed for CODE_MATCHED_SOURCES/
// DISPLAY_NAME_MATCHED_CURRENCIES, applied here to this project's
// per-currency unit-denomination convention instead. It's now defined
// once, in frontend/currencySupport.js's CURRENCY_UNIT export, and
// required from there — see that file's own Phase 49 note for the full
// detail on why this data belongs there and what used to be duplicated.
const { CURRENCY_UNIT: ADAPTER_CURRENCY_UNIT } = require('../../frontend/currencySupport.js');

// How far a scraped reading's middle rate ((buy+sell)/2, converted to the
// adapter's own quoted unit) is allowed to drift from BNM's own published
// reference before it's treated as suspicious rather than just "this money
// changer's normal retail spread." Deliberately generous — a real money
// changer's margin over the interbank mid rate is typically a few percent,
// not dozens — so this sits well above any legitimate spread and is
// specifically aimed at the gross-error case the project brief calls out
// by name in Section 9: a decimal-placement bug (0.6053 vs 60.53 is a
// ~99% deviation), a unit-scaling bug, or extraction landing on the wrong
// row/column entirely. Same "wide headroom now, tighten later with real
// history" approach every adapter's own expectedRange bounds already use.
const GROSS_DEVIATION_THRESHOLD_PCT = 25;

/**
 * Cross-checks a scraped reading against BNM's own published reference
 * rate for the same currency.
 *
 * Returns null whenever the check could not be meaningfully performed —
 * BNM unreachable, no data for this currency/session, the currency isn't
 * in ADAPTER_CURRENCY_UNIT, or the reading itself has no valid buy/sell
 * pair to compare. Callers MUST treat null as "skipped, leave the reading
 * alone," never as a failure signal on its own. This function never
 * throws — an unexpected error in this optional layer must never take
 * down a real scheduler run.
 *
 * @param {{currency:string, buyRate:number|null, sellRate:number|null}} reading
 * @param {{getBnmReferenceRate?: Function}} [deps] injectable for tests —
 *   defaults to the real network-calling implementation.
 * @returns {Promise<{bnmMiddleAdapterUnit:number, adapterMiddle:number,
 *   deviationPct:number, grosslyOffReference:boolean, session:string,
 *   rateDate:string, thresholdPct:number}|null>}
 */
async function crossCheckAgainstBnm(reading, deps = {}) {
  try {
    if (!reading || typeof reading !== 'object') return null;
    const { currency, buyRate, sellRate } = reading;

    const adapterUnit = ADAPTER_CURRENCY_UNIT[currency];
    if (!adapterUnit) return null; // currency not in our reference map — skip rather than guess a unit

    const buyOk = typeof buyRate === 'number' && Number.isFinite(buyRate) && buyRate > 0;
    const sellOk = typeof sellRate === 'number' && Number.isFinite(sellRate) && sellRate > 0;
    if (!buyOk || !sellOk) return null; // nothing sane to compare — validateRate() already handles this case

    const fetchFn = deps.getBnmReferenceRate || defaultGetBnmReferenceRate;
    const bnm = await fetchFn(currency);
    if (!bnm || typeof bnm.middleRate !== 'number') return null;

    const bnmMiddleAdapterUnit = toAdapterUnit(bnm.middleRate, bnm.bnmUnit, adapterUnit);
    if (!Number.isFinite(bnmMiddleAdapterUnit) || bnmMiddleAdapterUnit <= 0) return null;

    const adapterMiddle = (buyRate + sellRate) / 2;
    const deviationPct = (Math.abs(adapterMiddle - bnmMiddleAdapterUnit) / bnmMiddleAdapterUnit) * 100;

    return {
      bnmMiddleAdapterUnit,
      adapterMiddle,
      deviationPct,
      grosslyOffReference: deviationPct > GROSS_DEVIATION_THRESHOLD_PCT,
      session: bnm.session,
      rateDate: bnm.rateDate,
      thresholdPct: GROSS_DEVIATION_THRESHOLD_PCT,
    };
  } catch (e) {
    // Same "never block a real reading" contract as a null return above —
    // an unexpected bug in this optional sanity layer is not a reason to
    // fail the scheduler run.
    return null;
  }
}

module.exports = { crossCheckAgainstBnm, ADAPTER_CURRENCY_UNIT, GROSS_DEVIATION_THRESHOLD_PCT };
