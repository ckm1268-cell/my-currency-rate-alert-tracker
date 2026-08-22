/**
 * Phase 8 test — backend/scheduler/comboSelection.js's pure helpers.
 * These have no I/O, so they're tested directly against plain objects
 * rather than a live Supabase project or a real adapter call — see
 * backend/scheduler/run.js's header comment for how these fit into the
 * actual scheduled job.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { comboKey, getRequiredCombos, readingsForAlert } = require('../backend/scheduler/comboSelection');

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
