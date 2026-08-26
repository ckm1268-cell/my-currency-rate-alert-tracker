/**
 * Phase 8 test — backend/scheduler/comboSelection.js's pure helpers.
 * These have no I/O, so they're tested directly against plain objects
 * rather than a live Supabase project or a real adapter call — see
 * backend/scheduler/run.js's header comment for how these fit into the
 * actual scheduled job.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  comboKey,
  getRequiredCombos,
  readingsForAlert,
  isSupportedCombo,
  getSkippedUnsupportedCombos,
  SUPPORTED_CURRENCIES,
} = require('../backend/scheduler/comboSelection');

test('comboKey is stable and treats a null/missing branch consistently', () => {
  assert.equal(comboKey({ source: 'mymoneymaster', currency: 'CNY', branch: null }), 'mymoneymaster::CNY::');
  assert.equal(comboKey({ source: 'mymoneymaster', currency: 'CNY' }), 'mymoneymaster::CNY::');
  assert.equal(
    comboKey({ source: 'tajmuhabath', currency: 'CNY', branch: 'LALAPORT BBCC' }),
    'tajmuhabath::CNY::LALAPORT BBCC'
  );
});

test('getRequiredCombos dedupes identical combos across multiple alerts', () => {
  const alerts = [
    { sources: ['mymoneymaster', 'tajmuhabath'], currency: 'CNY', branch: 'LALAPORT BBCC' },
    { sources: ['mymoneymaster'], currency: 'CNY', branch: null }, // same mymoneymaster combo as above
    { sources: ['tajmuhabath'], currency: 'CNY', branch: 'LALAPORT BBCC' }, // same tajmuhabath combo as above
  ];
  const combos = getRequiredCombos(alerts);
  assert.equal(combos.length, 2); // not 4 — two alerts share both combos with the first
  const keys = combos.map(comboKey).sort();
  assert.deepEqual(keys, ['mymoneymaster::CNY::', 'tajmuhabath::CNY::LALAPORT BBCC']);
});

test('getRequiredCombos never applies a branch to a source that does not support one', () => {
  // My Money Master publishes one site-wide rate — even if an alert row
  // somehow has a stray branch value, it must not leak into the combo.
  const alerts = [{ sources: ['mymoneymaster'], currency: 'CNY', branch: 'Some Branch' }];
  const combos = getRequiredCombos(alerts);
  assert.equal(combos.length, 1);
  assert.equal(combos[0].branch, null);
});

test('getRequiredCombos distinguishes different Taj Muhabath branches as separate combos', () => {
  const alerts = [
    { sources: ['tajmuhabath'], currency: 'CNY', branch: 'LALAPORT BBCC' },
    { sources: ['tajmuhabath'], currency: 'CNY', branch: 'Econsave, Balakong' },
  ];
  const combos = getRequiredCombos(alerts);
  assert.equal(combos.length, 2);
});

test('getRequiredCombos handles alerts with no sources/malformed input without throwing', () => {
  assert.deepEqual(getRequiredCombos([]), []);
  assert.deepEqual(getRequiredCombos(undefined), []);
  assert.deepEqual(getRequiredCombos([{ currency: 'CNY' }]), []); // sources missing entirely
});

test('readingsForAlert returns only the readings for this alert\'s selected sources', () => {
  const resultsByComboKey = new Map([
    ['mymoneymaster::CNY::', { source: 'mymoneymaster', currency: 'CNY', branch: null, sellRate: 60.60 }],
    ['tajmuhabath::CNY::LALAPORT BBCC', { source: 'tajmuhabath', currency: 'CNY', branch: 'LALAPORT BBCC', sellRate: 60.45 }],
    ['tajmuhabath::JPY::LALAPORT BBCC', { source: 'tajmuhabath', currency: 'JPY', branch: 'LALAPORT BBCC', sellRate: 23.99 }],
  ]);

  const alert = { sources: ['mymoneymaster', 'tajmuhabath'], currency: 'CNY', branch: 'LALAPORT BBCC' };
  const result = readingsForAlert(alert, resultsByComboKey);

  assert.equal(result.length, 2);
  assert.ok(result.some((r) => r.source === 'mymoneymaster'));
  assert.ok(result.some((r) => r.source === 'tajmuhabath' && r.currency === 'CNY'));
});

test('readingsForAlert silently skips a source with no corresponding combo result', () => {
  const resultsByComboKey = new Map([
    ['mymoneymaster::CNY::', { source: 'mymoneymaster', currency: 'CNY', branch: null, sellRate: 60.60 }],
    // no entry for tajmuhabath::CNY::LALAPORT BBCC — e.g. that combo failed to load an adapter this run
  ]);

  const alert = { sources: ['mymoneymaster', 'tajmuhabath'], currency: 'CNY', branch: 'LALAPORT BBCC' };
  const result = readingsForAlert(alert, resultsByComboKey);

  assert.equal(result.length, 1);
  assert.equal(result[0].source, 'mymoneymaster');
});

test('readingsForAlert returns an empty array for an alert with no sources', () => {
  assert.deepEqual(readingsForAlert({ sources: [], currency: 'CNY' }, new Map()), []);
  assert.deepEqual(readingsForAlert({ currency: 'CNY' }, new Map()), []);
});

// Phase 33 (26-Aug-2026) tests — backend scheduler must never call an
// adapter for a source+currency combo this project hasn't actually
// verified. See comboSelection.js's own header comment on
// SUPPORTED_CURRENCIES for the full root-cause writeup: this reproduces
// the reported bug (My Money Master + VND) directly against
// getRequiredCombos(), not just against isSupportedCombo() in isolation.

test('isSupportedCombo is true only for a source+currency this project has verified', () => {
  assert.equal(isSupportedCombo('mymoneymaster', 'CNY'), true);
  assert.equal(isSupportedCombo('mymoneymaster', 'VND'), false); // the reported bug
  assert.equal(isSupportedCombo('jalinanduta', 'VND'), true); // Phase 30 promotion
  assert.equal(isSupportedCombo('merchantradeasia', 'TWD'), true);
  assert.equal(isSupportedCombo('tajmuhabath', 'VND'), false);
  assert.equal(isSupportedCombo('doesnotexist', 'CNY'), false); // unknown source, not just unknown currency
});

test('SUPPORTED_CURRENCIES matches frontend/app.js\'s REAL_ADAPTER_SUPPORT exactly', () => {
  // These two lists must never drift — see comboSelection.js's own
  // comment for why they're hand-duplicated instead of shared, and
  // bnmCrossCheck.js's ADAPTER_CURRENCY_UNIT for the established pattern
  // this same check already follows elsewhere in the test suite.
  assert.deepEqual(SUPPORTED_CURRENCIES, {
    mymoneymaster: ['CNY'],
    tajmuhabath: ['CNY'],
    merchantradeasia: ['CNY', 'VND', 'TWD'],
    jalinanduta: ['CNY', 'VND'],
  });
});

test('getRequiredCombos never builds a combo for an unsupported source+currency (the reported My Money Master + VND bug)', () => {
  const alerts = [{ sources: ['mymoneymaster'], currency: 'VND', branch: null }];
  const combos = getRequiredCombos(alerts);
  assert.deepEqual(combos, []); // must not call the adapter at all
});

test('getRequiredCombos keeps a supported combo from the same alert while dropping an unsupported one', () => {
  const alerts = [{ sources: ['mymoneymaster', 'merchantradeasia'], currency: 'VND', branch: null }];
  const combos = getRequiredCombos(alerts);
  assert.equal(combos.length, 1);
  assert.equal(combos[0].source, 'merchantradeasia');
  assert.equal(combos[0].currency, 'VND');
});

test('getRequiredCombos still builds every combo as before when all requested sources are supported', () => {
  const alerts = [{ sources: ['mymoneymaster'], currency: 'CNY', branch: null }];
  const combos = getRequiredCombos(alerts);
  assert.equal(combos.length, 1);
  assert.equal(combos[0].source, 'mymoneymaster');
});

test('getSkippedUnsupportedCombos reports the reported bug\'s exact combo', () => {
  const alerts = [{ sources: ['mymoneymaster'], currency: 'VND', branch: null }];
  const skipped = getSkippedUnsupportedCombos(alerts);
  assert.deepEqual(skipped, [{ source: 'mymoneymaster', currency: 'VND' }]);
});

test('getSkippedUnsupportedCombos returns nothing when every requested combo is supported', () => {
  const alerts = [{ sources: ['mymoneymaster', 'tajmuhabath'], currency: 'CNY', branch: null }];
  assert.deepEqual(getSkippedUnsupportedCombos(alerts), []);
});

test('getSkippedUnsupportedCombos dedupes the same skipped source+currency across multiple alerts', () => {
  const alerts = [
    { sources: ['mymoneymaster'], currency: 'VND', branch: null },
    { sources: ['mymoneymaster'], currency: 'VND', branch: null }, // a second user with the same alert
  ];
  const skipped = getSkippedUnsupportedCombos(alerts);
  assert.equal(skipped.length, 1);
});

test('getSkippedUnsupportedCombos does not report a source that was skipped only because branch handling excluded it — it reports by source+currency, not by combo identity', () => {
  // Sanity check that skip detection is keyed on isSupportedCombo(source,
  // currency), independent of branch — branch has nothing to do with
  // whether an adapter exists for a currency.
  const alerts = [{ sources: ['tajmuhabath'], currency: 'CNY', branch: 'LALAPORT BBCC' }];
  assert.deepEqual(getSkippedUnsupportedCombos(alerts), []); // tajmuhabath+CNY is supported
});
