/**
 * Phase 31 test — backend/validation/bnmCrossCheck.js's crossCheckAgainstBnm().
 *
 * getBnmReferenceRate() is injected via `deps` in every case here — no real
 * network call to api.bnm.gov.my is ever made by this test file. The
 * numbers used for the CNY cases below are the REAL response the project
 * owner captured live via PowerShell on 26-Aug-2026 (see
 * backend/reference/bnmReference.js's own header comment for the full
 * response this was taken from):
 *   currency_code: "CNY", unit: 1, buying_rate: 0.6002999999999994,
 *   selling_rate: 0.6009999999999998, middle_rate: 0.6006000000000002
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { crossCheckAgainstBnm, ADAPTER_CURRENCY_UNIT, GROSS_DEVIATION_THRESHOLD_PCT } = require('../backend/validation/bnmCrossCheck');

const REAL_CNY_BNM_RESPONSE = {
  currencyCode: 'CNY',
  bnmUnit: 1,
  buyingRate: 0.6002999999999994,
  sellingRate: 0.6009999999999998,
  middleRate: 0.6006000000000002,
  rateDate: '2026-08-26',
  session: '0900',
  lastUpdated: '2026-08-26 11:51:19',
};

test('crossCheckAgainstBnm: currency not in ADAPTER_CURRENCY_UNIT returns null (skipped, not failed)', async () => {
  const reading = { currency: 'ZZZ', buyRate: 10, sellRate: 11 };
  const result = await crossCheckAgainstBnm(reading, { getBnmReferenceRate: async () => REAL_CNY_BNM_RESPONSE });
  assert.equal(result, null);
});

test('crossCheckAgainstBnm: missing/invalid buyRate or sellRate returns null', async () => {
  const cases = [
    { currency: 'CNY', buyRate: null, sellRate: 60.65 },
    { currency: 'CNY', buyRate: 60.30, sellRate: null },
    { currency: 'CNY', buyRate: 0, sellRate: 60.65 },
    { currency: 'CNY', buyRate: 60.30, sellRate: NaN },
  ];
  for (const reading of cases) {
    const result = await crossCheckAgainstBnm(reading, { getBnmReferenceRate: async () => REAL_CNY_BNM_RESPONSE });
    assert.equal(result, null, `expected null for ${JSON.stringify(reading)}`);
  }
});

test('crossCheckAgainstBnm: BNM reference unavailable (null) returns null, never blocks the reading', async () => {
  const reading = { currency: 'CNY', buyRate: 60.30, sellRate: 60.65 };
  const result = await crossCheckAgainstBnm(reading, { getBnmReferenceRate: async () => null });
  assert.equal(result, null);
});

test('crossCheckAgainstBnm: a fetchFn that throws is swallowed, returns null rather than propagating', async () => {
  const reading = { currency: 'CNY', buyRate: 60.30, sellRate: 60.65 };
  const result = await crossCheckAgainstBnm(reading, {
    getBnmReferenceRate: async () => { throw new Error('network blew up'); },
  });
  assert.equal(result, null);
});

test('crossCheckAgainstBnm: a normal My Money Master-style CNY reading is well within threshold, not flagged', async () => {
  // Real observed My Money Master CNY sample: buy 60.30 / sell 60.65.
  // BNM's real CNY middle (per 1) is 0.6006 -> per adapter's own 100-unit
  // convention that's 60.06. Deviation from 60.475 is under 1%.
  const reading = { currency: 'CNY', buyRate: 60.30, sellRate: 60.65 };
  const result = await crossCheckAgainstBnm(reading, { getBnmReferenceRate: async () => REAL_CNY_BNM_RESPONSE });
  assert.ok(result, 'expected a result, not null, for a valid CNY reading with a valid BNM reference');
  assert.equal(result.grosslyOffReference, false);
  assert.ok(result.deviationPct < GROSS_DEVIATION_THRESHOLD_PCT, `deviation ${result.deviationPct} should be well under the ${GROSS_DEVIATION_THRESHOLD_PCT}% threshold`);
  assert.ok(Math.abs(result.bnmMiddleAdapterUnit - 60.06) < 0.001, `expected BNM's per-100 CNY middle to be ~60.06, got ${result.bnmMiddleAdapterUnit}`);
  assert.ok(Math.abs(result.adapterMiddle - 60.475) < 0.0001, `expected adapterMiddle ~60.475, got ${result.adapterMiddle}`);
  assert.equal(result.session, '0900');
  assert.equal(result.rateDate, '2026-08-26');
});

test('crossCheckAgainstBnm: a decimal-placement bug (0.6053-style, 100x too small) is flagged grossly off', async () => {
  // Simulates exactly the bug the project brief's Section 9 calls out by
  // name — a reading of 0.6053/0.6065 instead of 60.53/60.65.
  const reading = { currency: 'CNY', buyRate: 0.6030, sellRate: 0.6065 };
  const result = await crossCheckAgainstBnm(reading, { getBnmReferenceRate: async () => REAL_CNY_BNM_RESPONSE });
  assert.ok(result);
  assert.equal(result.grosslyOffReference, true);
  assert.ok(result.deviationPct > 90, `expected a huge deviation for a 100x decimal bug, got ${result.deviationPct}`);
});

test('crossCheckAgainstBnm: a wrong-currency-row bug (e.g. USD numbers under a CNY label) is flagged grossly off', async () => {
  // USD/MYR is roughly 4.0-4.3 — wildly different from CNY's ~60 range.
  const reading = { currency: 'CNY', buyRate: 4.01, sellRate: 4.06 };
  const result = await crossCheckAgainstBnm(reading, { getBnmReferenceRate: async () => REAL_CNY_BNM_RESPONSE });
  assert.ok(result);
  assert.equal(result.grosslyOffReference, true);
});

test('crossCheckAgainstBnm: a normal retail spread just under the threshold is NOT flagged', async () => {
  // BNM per-100 middle is 60.06. A reading ~20% above that (a wide but not
  // impossible spread for a smaller money changer) should sit just under
  // the 25% threshold and NOT be flagged.
  const bnmMiddle = 60.06;
  const target = bnmMiddle * 1.20; // +20%
  const reading = { currency: 'CNY', buyRate: target - 0.2, sellRate: target + 0.2 };
  const result = await crossCheckAgainstBnm(reading, { getBnmReferenceRate: async () => REAL_CNY_BNM_RESPONSE });
  assert.ok(result);
  assert.equal(result.grosslyOffReference, false, `20% deviation should stay under the ${GROSS_DEVIATION_THRESHOLD_PCT}% threshold`);
});

test('crossCheckAgainstBnm: a deviation just over the threshold IS flagged', async () => {
  const bnmMiddle = 60.06;
  const target = bnmMiddle * 1.30; // +30%, over the 25% threshold
  const reading = { currency: 'CNY', buyRate: target - 0.2, sellRate: target + 0.2 };
  const result = await crossCheckAgainstBnm(reading, { getBnmReferenceRate: async () => REAL_CNY_BNM_RESPONSE });
  assert.ok(result);
  assert.equal(result.grosslyOffReference, true);
});

test('ADAPTER_CURRENCY_UNIT comes from the single shared frontend/currencySupport.js file', () => {
  // Phase 49 (29-Aug-2026): this replaces the old version of this test,
  // which compared ADAPTER_CURRENCY_UNIT against a hardcoded literal
  // PASTED INTO THIS TEST FILE -- it never actually read
  // frontend/currencySupport.js (or, before Phase 48, frontend/app.js),
  // so it structurally could not have caught a real drift, the same
  // blind spot tests/comboSelection.test.js's old "must never drift"
  // test had (see that file's own Phase 48 fix). This test requires the
  // real shared file directly and asserts bnmCrossCheck.js's export is
  // that file's data, unmodified -- proving there's no local override or
  // second copy anywhere in this file.
  const { CURRENCY_UNIT } = require('../frontend/currencySupport.js');
  assert.deepEqual(ADAPTER_CURRENCY_UNIT, CURRENCY_UNIT);
});
