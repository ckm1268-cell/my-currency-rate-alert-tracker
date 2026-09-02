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
    { sources: ['mymoneymaster', 'tajmuhabath'], currency: 'CNY', branches: { tajmuhabath: 'LALAPORT BBCC' } },
    { sources: ['mymoneymaster'], currency: 'CNY', branches: {} }, // same mymoneymaster combo as above
    { sources: ['tajmuhabath'], currency: 'CNY', branches: { tajmuhabath: 'LALAPORT BBCC' } }, // same tajmuhabath combo as above
  ];
  const combos = getRequiredCombos(alerts);
  assert.equal(combos.length, 2); // not 4 — two alerts share both combos with the first
  const keys = combos.map(comboKey).sort();
  assert.deepEqual(keys, ['mymoneymaster::CNY::', 'tajmuhabath::CNY::LALAPORT BBCC']);
});

test('getRequiredCombos never applies a branch to a source that does not support one', () => {
  // My Money Master publishes one site-wide rate — even if an alert row
  // somehow has a stray branches entry for it, it must not leak into the combo.
  const alerts = [{ sources: ['mymoneymaster'], currency: 'CNY', branches: { mymoneymaster: 'Some Branch' } }];
  const combos = getRequiredCombos(alerts);
  assert.equal(combos.length, 1);
  assert.equal(combos[0].branch, null);
});

test('getRequiredCombos distinguishes different Taj Muhabath branches as separate combos', () => {
  const alerts = [
    { sources: ['tajmuhabath'], currency: 'CNY', branches: { tajmuhabath: 'LALAPORT BBCC' } },
    { sources: ['tajmuhabath'], currency: 'CNY', branches: { tajmuhabath: 'Econsave, Balakong' } },
  ];
  const combos = getRequiredCombos(alerts);
  assert.equal(combos.length, 2);
});

// Phase 52 (02-Sep-2026) — the actual bug this migration fixes: before this
// phase, a SINGLE alert.branch value was applied identically to EVERY
// branch-supporting source an alert selected. Once Wawasan Ilham and
// Jalinan Duta also became branch-aware, an alert comparing Taj Muhabath +
// Wawasan Ilham at once would have silently sent Taj Muhabath's branch name
// to Wawasan Ilham's adapter (or vice versa) -- wrong data, not a crash.
test('getRequiredCombos gives each branch-aware source selected on the same alert its own correct branch', () => {
  const alerts = [{
    sources: ['tajmuhabath', 'wawasanilham', 'jalinanduta'],
    currency: 'CNY',
    branches: {
      tajmuhabath: 'LALAPORT BBCC',
      wawasanilham: 'Seri Kembangan',
      jalinanduta: 'Masjid India',
    },
  }];
  const combos = getRequiredCombos(alerts);
  assert.equal(combos.length, 3);
  const byBranch = Object.fromEntries(combos.map((c) => [c.source, c.branch]));
  assert.deepEqual(byBranch, {
    tajmuhabath: 'LALAPORT BBCC',
    wawasanilham: 'Seri Kembangan',
    jalinanduta: 'Masjid India',
  });
});

test('getRequiredCombos ignores a branches entry for a source not actually selected on that alert', () => {
  // A leftover branches entry from a source the user unchecked must not
  // fabricate a combo for a source that was never actually requested.
  const alerts = [{
    sources: ['tajmuhabath'],
    currency: 'CNY',
    branches: { tajmuhabath: 'LALAPORT BBCC', wawasanilham: 'Seri Kembangan' },
  }];
  const combos = getRequiredCombos(alerts);
  assert.equal(combos.length, 1);
  assert.equal(combos[0].source, 'tajmuhabath');
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

  const alert = { sources: ['mymoneymaster', 'tajmuhabath'], currency: 'CNY', branches: { tajmuhabath: 'LALAPORT BBCC' } };
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

  const alert = { sources: ['mymoneymaster', 'tajmuhabath'], currency: 'CNY', branches: { tajmuhabath: 'LALAPORT BBCC' } };
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
  // Phase 47 (29-Aug-2026): JPY/USD/SGD are all real, live-supported
  // currencies at Merchantrade Asia as of v2.0.0 (JPY/USD) and the
  // currency-coverage audit (SGD) -- these three assertions used to say
  // `false` here with comments claiming they were "deliberately excluded",
  // which was true of an OLDER state of the code but had gone stale: this
  // exact staleness is what let the Phase 47 bug (this file's own
  // DISPLAY_NAME_MATCHED_CURRENCIES list drifting out of sync with
  // frontend/app.js's) go undetected by the test suite. See
  // comboSelection.js's own Phase 47 header-comment entry for the full
  // incident writeup.
  assert.equal(isSupportedCombo('merchantradeasia', 'JPY'), true);
  assert.equal(isSupportedCombo('merchantradeasia', 'USD'), true);
  assert.equal(isSupportedCombo('merchantradeasia', 'SGD'), true);

  // Phase 52 (02-Sep-2026) — Wawasan Ilham is display-name-matched too (its
  // rate table has no ISO-code column), same shape as Merchantrade Asia.
  assert.equal(isSupportedCombo('wawasanilham', 'CNY'), true);
  assert.equal(isSupportedCombo('wawasanilham', 'VND'), true);
  assert.equal(isSupportedCombo('wawasanilham', 'TWD'), true);
});

test('isSupportedCombo is false for an unknown source, not just an unknown currency', () => {
  assert.equal(isSupportedCombo('doesnotexist', 'CNY'), false);
});

test('CODE_MATCHED_SOURCES / DISPLAY_NAME_MATCHED_CURRENCIES come from the single shared frontend/currencySupport.js file', () => {
  // Phase 48 (29-Aug-2026): this replaces the old version of this test,
  // which compared two hardcoded literals PASTED INTO THIS TEST FILE
  // against each other -- it never actually read frontend/app.js, so it
  // could not have caught (and did not catch) the Phase 42/47 drift
  // incidents it was meant to guard against. There is now only one real
  // file to check: this test requires it directly (the exact same
  // module comboSelection.js itself requires) and asserts
  // comboSelection.js's exports are that file's data, unmodified --
  // proving there's no local override or second copy anywhere in this
  // file. See frontend/currencySupport.js's own header comment for the
  // full architecture and incident history.
  const shared = require('../frontend/currencySupport.js');
  assert.deepEqual(CODE_MATCHED_SOURCES, new Set(shared.CODE_MATCHED_SOURCES));
  assert.deepEqual(DISPLAY_NAME_MATCHED_CURRENCIES, shared.DISPLAY_NAME_MATCHED_CURRENCIES);
});

test('getRequiredCombos now builds a combo for My Money Master + VND (Phase 42 fix for the originally reported bug)', () => {
  const alerts = [{ sources: ['mymoneymaster'], currency: 'VND', branch: null }];
  const combos = getRequiredCombos(alerts);
  assert.equal(combos.length, 1);
  assert.equal(combos[0].source, 'mymoneymaster');
  assert.equal(combos[0].currency, 'VND');
});

test('getRequiredCombos never builds a combo for a source+currency the site genuinely does not support', () => {
  // Phase 47 (29-Aug-2026): USD used to be this test's example of a
  // genuinely unsupported combo at Merchantrade Asia, but USD has been
  // real/LIVE there since v2.0.0 (and the DISPLAY_NAME_MATCHED_CURRENCIES
  // list this file keeps in sync was the very thing that had drifted stale
  // -- see comboSelection.js's Phase 47 comment). Merchantrade Asia's list
  // is now the app's full 12-currency set, so there is no longer any real
  // app currency it doesn't support; CAD (not one of this app's 12
  // supported currencies at all) is used here purely as a currency code
  // guaranteed absent from every DISPLAY_NAME_MATCHED_CURRENCIES list.
  const alerts = [{ sources: ['merchantradeasia'], currency: 'CAD', branch: null }];
  const combos = getRequiredCombos(alerts);
  assert.deepEqual(combos, []); // must not call the adapter at all
});

test('getRequiredCombos keeps a supported combo from the same alert while dropping an unsupported one', () => {
  // CAD used here for the same reason as the test above -- see its comment.
  // mymoneymaster is code-matched, so it supports CAD (or any code its live
  // table happens to print) unconditionally; merchantradeasia is
  // display-name-matched and has no CAD entry, so only the mymoneymaster
  // combo should survive.
  const alerts = [{ sources: ['merchantradeasia', 'mymoneymaster'], currency: 'CAD', branch: null }];
  const combos = getRequiredCombos(alerts);
  assert.equal(combos.length, 1);
  assert.equal(combos[0].source, 'mymoneymaster');
  assert.equal(combos[0].currency, 'CAD');
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
  // CAD used here for the same reason as the two tests above.
  const alerts = [{ sources: ['merchantradeasia'], currency: 'CAD', branch: null }];
  const skipped = getSkippedUnsupportedCombos(alerts);
  assert.deepEqual(skipped, [{ source: 'merchantradeasia', currency: 'CAD' }]);
});

test('getSkippedUnsupportedCombos returns nothing when every requested combo is supported', () => {
  const alerts = [{ sources: ['mymoneymaster', 'tajmuhabath'], currency: 'CNY', branch: null }];
  assert.deepEqual(getSkippedUnsupportedCombos(alerts), []);
});

test('getSkippedUnsupportedCombos dedupes the same skipped source+currency across multiple alerts', () => {
  // CAD used here for the same reason as the tests above.
  const alerts = [
    { sources: ['merchantradeasia'], currency: 'CAD', branch: null },
    { sources: ['merchantradeasia'], currency: 'CAD', branch: null }, // a second user with the same alert
  ];
  const skipped = getSkippedUnsupportedCombos(alerts);
  assert.equal(skipped.length, 1);
});

test('getSkippedUnsupportedCombos does not report a source that was skipped only because branch handling excluded it — it reports by source+currency, not by combo identity', () => {
  // Sanity check that skip detection is keyed on isSupportedCombo(source,
  // currency), independent of branch — branch has nothing to do with
  // whether an adapter exists for a currency.
  const alerts = [{ sources: ['tajmuhabath'], currency: 'CNY', branches: { tajmuhabath: 'LALAPORT BBCC' } }];
  assert.deepEqual(getSkippedUnsupportedCombos(alerts), []); // tajmuhabath+CNY is supported
});
