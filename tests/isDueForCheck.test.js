/**
 * Phase 14 test — backend/scheduler/run.js's isDueForCheck().
 *
 * Now that .github/workflows/monitor.yml runs on a recurring every-5-minute
 * schedule instead of only a manual click, each alert's own
 * monitoring_interval_minutes needs to actually mean something: this
 * function is what decides, on any given run, whether a specific alert has
 * waited long enough since it was last checked. Pure function, no Supabase
 * involved — `now` is passed in rather than read internally specifically so
 * it can be tested deterministically like this.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { isDueForCheck } = require('../backend/scheduler/run');

test('isDueForCheck: an alert never checked before (last_checked_at is null) is always due', () => {
  const alert = { last_checked_at: null, monitoring_interval_minutes: 30 };
  assert.equal(isDueForCheck(alert, new Date('2026-08-22T12:00:00Z')), true);
});

test('isDueForCheck: exactly at the interval boundary counts as due (>=, not only >)', () => {
  const alert = { last_checked_at: '2026-08-22T12:00:00Z', monitoring_interval_minutes: 5 };
  const now = new Date('2026-08-22T12:05:00Z'); // exactly 5 minutes later
  assert.equal(isDueForCheck(alert, now), true);
});

test('isDueForCheck: one second short of the interval is NOT due yet', () => {
  const alert = { last_checked_at: '2026-08-22T12:00:00Z', monitoring_interval_minutes: 5 };
  const now = new Date('2026-08-22T12:04:59Z');
  assert.equal(isDueForCheck(alert, now), false);
});

test('isDueForCheck: a 30-minute alert stays skipped across several 5-minute-cadence runs, then comes due', () => {
  const lastChecked = '2026-08-22T12:00:00Z';
  const alert = { last_checked_at: lastChecked, monitoring_interval_minutes: 30 };
  // Runs at :05, :10, :15, :20, :25 should all still be "not due".
  ['12:05:00Z', '12:10:00Z', '12:15:00Z', '12:20:00Z', '12:25:00Z'].forEach((t) => {
    assert.equal(isDueForCheck(alert, new Date(`2026-08-22T${t}`)), false, `should not be due yet at ${t}`);
  });
  // The run at :30 is exactly 30 minutes later — due.
  assert.equal(isDueForCheck(alert, new Date('2026-08-22T12:30:00Z')), true);
});

test('isDueForCheck: missing monitoring_interval_minutes falls back to 5, not throwing or treating as always-due', () => {
  const alert = { last_checked_at: '2026-08-22T12:00:00Z' }; // no monitoring_interval_minutes at all
  assert.equal(isDueForCheck(alert, new Date('2026-08-22T12:04:00Z')), false);
  assert.equal(isDueForCheck(alert, new Date('2026-08-22T12:05:00Z')), true);
});

test('isDueForCheck: the default 5-minute alert is due on every run of the 5-minute workflow schedule', () => {
  const alert = { last_checked_at: '2026-08-22T12:00:00Z', monitoring_interval_minutes: 5 };
  assert.equal(isDueForCheck(alert, new Date('2026-08-22T12:05:00Z')), true);
});
