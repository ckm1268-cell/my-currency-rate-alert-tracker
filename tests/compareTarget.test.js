/**
 * Phase 5 test — the target comparison engine's condition logic.
 *
 * Mirrors the exact condition semantics used by frontend/app.js's own
 * isTargetMet() so both the backend module and the live in-browser demo
 * stay behaviorally identical. See backend/targetEngine/compareTarget.js's
 * header comment for why this module exists as its own tested unit.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { isTargetMet } = require('../backend/targetEngine/compareTarget');

test('AT_OR_BELOW triggers when live rate is below, at, but not above target', () => {
  assert.equal(isTargetMet({ liveRate: 60.45, targetRate: 60.50, condition: 'AT_OR_BELOW' }), true);
  assert.equal(isTargetMet({ liveRate: 60.50, targetRate: 60.50, condition: 'AT_OR_BELOW' }), true);
  assert.equal(isTargetMet({ liveRate: 60.53, targetRate: 60.50, condition: 'AT_OR_BELOW' }), false);
});

test('BELOW triggers only strictly below target, not at it', () => {
  assert.equal(isTargetMet({ liveRate: 60.49, targetRate: 60.50, condition: 'BELOW' }), true);
  assert.equal(isTargetMet({ liveRate: 60.50, targetRate: 60.50, condition: 'BELOW' }), false);
});

test('REACHES triggers only on exact equality', () => {
  assert.equal(isTargetMet({ liveRate: 60.50, targetRate: 60.50, condition: 'REACHES' }), true);
  assert.equal(isTargetMet({ liveRate: 60.4999, targetRate: 60.50, condition: 'REACHES' }), false);
  assert.equal(isTargetMet({ liveRate: 60.5001, targetRate: 60.50, condition: 'REACHES' }), false);
});

test('ABOVE triggers only strictly above target', () => {
  assert.equal(isTargetMet({ liveRate: 60.51, targetRate: 60.50, condition: 'ABOVE' }), true);
  assert.equal(isTargetMet({ liveRate: 60.50, targetRate: 60.50, condition: 'ABOVE' }), false);
  assert.equal(isTargetMet({ liveRate: 60.49, targetRate: 60.50, condition: 'ABOVE' }), false);
});

test('PCT_CHANGE triggers when the absolute percentage move meets the threshold', () => {
  // 60.50 -> 61.11 is ~1.008% — meets the default 1% threshold
  assert.equal(
    isTargetMet({ liveRate: 61.11, targetRate: 60.50, condition: 'PCT_CHANGE', prevRate: 60.50 }),
    true
  );
  // 60.50 -> 60.80 is ~0.496% — below the default 1% threshold
  assert.equal(
    isTargetMet({ liveRate: 60.80, targetRate: 60.50, condition: 'PCT_CHANGE', prevRate: 60.50 }),
    false
  );
});

test('PCT_CHANGE respects a custom pctChangeThreshold', () => {
  assert.equal(
    isTargetMet({
      liveRate: 60.80, targetRate: 60.50, condition: 'PCT_CHANGE', prevRate: 60.50, pctChangeThreshold: 0.4,
    }),
    true
  );
  assert.equal(
    isTargetMet({
      liveRate: 60.80, targetRate: 60.50, condition: 'PCT_CHANGE', prevRate: 60.50, pctChangeThreshold: 2,
    }),
    false
  );
});

test('PCT_CHANGE never triggers without a previous reading to compare against', () => {
  assert.equal(
    isTargetMet({ liveRate: 61.11, targetRate: 60.50, condition: 'PCT_CHANGE', prevRate: null }),
    false
  );
  assert.equal(
    isTargetMet({ liveRate: 61.11, targetRate: 60.50, condition: 'PCT_CHANGE' }),
    false
  );
});

test('PCT_CHANGE never triggers with a zero previous rate (avoids divide-by-zero)', () => {
  assert.equal(
    isTargetMet({ liveRate: 1, targetRate: 0.5, condition: 'PCT_CHANGE', prevRate: 0 }),
    false
  );
});

test('an unknown or missing condition fails closed (never triggers)', () => {
  assert.equal(isTargetMet({ liveRate: 60.50, targetRate: 60.50, condition: 'NOT_A_REAL_CONDITION' }), false);
  assert.equal(isTargetMet({ liveRate: 60.50, targetRate: 60.50 }), false);
});

test('non-numeric or missing liveRate/targetRate never triggers', () => {
  assert.equal(isTargetMet({ liveRate: null, targetRate: 60.50, condition: 'AT_OR_BELOW' }), false);
  assert.equal(isTargetMet({ liveRate: NaN, targetRate: 60.50, condition: 'AT_OR_BELOW' }), false);
  assert.equal(isTargetMet({ liveRate: 60.50, targetRate: undefined, condition: 'AT_OR_BELOW' }), false);
  assert.equal(isTargetMet(undefined), false);
});
