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
  CODE_MATCHED_SOURCES,
  DISPLAY_NAME_MATCHED_CURRENCIES,
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

// Phase 38 (26-Aug-2026) rewrite — the project owner asked that the old
// per-currency manual-verification ceremony no longer gate a currency
// newly selected at one of the 4 already-trusted money changers. The
// tests below replace the old human-curated-allowlist assertions with
// ones matching that architecture: a code-matched source supports ANY
// currency unconditionally, since its adapter matches a live table row
// by ISO code directly; a display-name-matched source only supports a
// currency that has an actual currencyDisplayNames config entry, since
// the parser genuinely cannot find the right row without one.
//
// Phase 42 (27-Aug-2026) rewrite — My Money Master moved from
// display-name-matched to code-matched (see comboSelection.js's own
// Phase 42 comment): the project owner reported VND permanently
// unavailable there, and it turned out to be exactly this file silently
// never even asking the adapter to check it, not a real site limitation.
// The old "mymoneymaster+VND is unsupported" assertions below — which
// were previously this test suite's own documentation of that bug — are
// replaced with assertions proving the fix: mymoneymaster now behaves
// like every other code-matched source.

test('isSupportedCombo is unconditionally true for a code-matched source, regardless of currency', () => {
  assert.equal(isSupportedCombo('tajmuhabath', 'CNY'), true);
  assert.equal(isSupportedCombo('tajmuhabath', 'VND'), true); // was false pre-Phase-38 — this source never needed a config entry to work
  assert.equal(isSupportedCombo('tajmuhabath', 'ZZZ'), true); // even a nonsense code — isSupportedCombo only gates on source type; the adapter's own live-table lookup is what actually fails honestly for a code the site doesn't list
  assert.equal(isSupportedCombo('jalinanduta', 'VND'), true);
  assert.equal(isSupportedCombo('jalinanduta', 'TWD'), true); // Phase 38 addition
  assert.equal(isSupportedCombo('mymoneymaster', 'CNY'), true);
  assert.equal(isSupportedCombo('mymoneymaster', 'VND'), true); // Phase 42 fix — was false pre-Phase-42, the originally reported bug
  assert.equal(isSupportedCombo('mymoneymaster', 'THB'), true); // Phase 42 addition
  assert.equal(isSupportedCombo('mymoneymaster', 'KRW'), true); // Phase 42 addition
  assert.equal(isSupportedCombo('mymoneymaster', 'TWD'), true); // Phase 42 addition
});

test('isSupportedCombo is true for a display-name-matched source only when currencyDisplayNames has that currency', () => {
  assert.equal(isSupportedCombo('merchantradeasia', 'TWD'), true);
  assert.equal(isSupportedCombo('merchantradeasia', 'KRW'), true); // Phase 38 addition
  assert.equal(isSupportedCombo('merchantradeasia', 'JPY'), false); // deliberately excluded — real 10x unit-scale mismatch, not a missing config entry
  assert.equal(isSupportedCombo('merchantradeasia', 'USD'), false); // deliberately excluded — ambiguous BIG/MEDIUM/SMALL denomination tiers, no single canonical rate
});

test('isSupportedCombo is false for an unknown source, not just an unknown currency', () => {
  assert.equal(isSupportedCombo('doesnotexist', 'CNY'), false);
});

test('CODE_MATCHED_SOURCES / DISPLAY_NAME_MATCHED_CURRENCIES match frontend/app.js\'s copies exactly', () => {
  // These two pairs must never drift — see comboSelection.js's own
  // comment for why they're hand-duplicated instead of shared, and
  // bnmCrossCheck.js's ADAPTER_CURRENCY_UNIT for the established pattern
  // this same check already follows elsewhere in the test suite.
  assert.deepEqual(CODE_MATCHED_SOURCES, new Set(['tajmuhabath', 'jalinanduta', 'mymoneymaster']));
  assert.deepEqual(DISPLAY_NAME_MATCHED_CURRENCIES, {
    merchantradeasia: ['CNY', 'VND', 'TWD', 'HKD', 'EUR', 'GBP', 'AUD', 'THB', 'KRW'],
  });
});

test('getRequiredCombos now builds a combo for My Money Master + VND (Phase 42 fix for the originally reported bug)', () => {
  const alerts = [{ sources: ['mymoneymaster'], currency: 'VND', branch: null }];
  const combos = getRequiredCombos(alerts);
  assert.equal(combos.length, 1);
  assert.equal(combos[0].source, 'mymoneymaster');
  assert.equal(combos[0].currency, 'VND');
});

test('getRequiredCombos never builds a combo for a source+currency the site genuinely does not support', () => {
  const alerts = [{ sources: ['merchantradeasia'], currency: 'USD', branch: null }];
  const combos = getRequiredCombos(alerts);
  assert.deepEqual(combos, []); // must not call the adapter at all
});

test('getRequiredCombos keeps a supported combo from the same alert while dropping an unsupported one', () => {
  const alerts = [{ sources: ['merchantradeasia', 'mymoneymaster'], currency: 'USD', branch: null }];
  const combos = getRequiredCombos(alerts);
  assert.equal(combos.length, 1);
  assert.equal(combos[0].source, 'mymoneymaster');
  assert.equal(combos[0].currency, 'USD');
});

test('getRequiredCombos still builds every combo as before when all requested sources are supported', () => {
  const alerts = [{ sources: ['mymoneymaster'], currency: 'CNY', branch: null }];
  const combos = getRequiredCombos(alerts);
  assert.equal(combos.length, 1);
  assert.equal(combos[0].source, 'mymoneymaster');
});

test('getSkippedUnsupportedCombos no longer reports My Money Master + VND (Phase 42 fix)', () => {
  const alerts = [{ sources: ['mymoneymaster'], currency: 'VND', branch: null }];
  assert.deepEqual(getSkippedUnsupportedCombos(alerts), []);
});

test('getSkippedUnsupportedCombos reports a genuinely unsupported combo', () => {
  const alerts = [{ sources: ['merchantradeasia'], currency: 'USD', branch: null }];
  const skipped = getSkippedUnsupportedCombos(alerts);
  assert.deepEqual(skipped, [{ source: 'merchantradeasia', currency: 'USD' }]);
});

test('getSkippedUnsupportedCombos returns nothing when every requested combo is supported', () => {
  const alerts = [{ sources: ['mymoneymaster', 'tajmuhabath'], currency: 'CNY', branch: null }];
  assert.deepEqual(getSkippedUnsupportedCombos(alerts), []);
});

test('getSkippedUnsupportedCombos dedupes the same skipped source+currency across multiple alerts', () => {
  const alerts = [
    { sources: ['merchantradeasia'], currency: 'USD', branch: null },
    { sources: ['merchantradeasia'], currency: 'USD', branch: null }, // a second user with the same alert
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
