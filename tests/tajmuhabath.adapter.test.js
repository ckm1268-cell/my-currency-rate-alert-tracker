/**
 * Phase 3 test — Taj Muhabath adapter's parsing logic.
 *
 * Tests parseHtml() and parseTajTimestamp() (the pure, browser-free halves
 * of the adapter) against tests/fixtures/tajmuhabath.rates.sample.html,
 * whose rows are real markup captured live on 21-Aug-2026 after the
 * site's own JavaScript populated the table (see that file's header
 * comment) — not invented sample data.
 *
 * Deliberately does NOT test fetchRate() itself (the Playwright-driving
 * half): this repo's dev sandbox has restricted network egress and cannot
 * reach www.tajmuhabath.com.my, and even with network access, launching a
 * real browser per test run is out of scope for a fast unit suite. See the
 * header comment in backend/scrapers/tajmuhabath.adapter.js — this
 * adapter's live network path was proven by hand, via a real browser
 * session, during this Phase 3 build, and will be proven again end-to-end
 * whichever environment actually runs it with real internet access
 * (GitHub Actions).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseHtml, parseTajTimestamp } = require('../backend/scrapers/tajmuhabath.adapter');
const { validateRate } = require('../backend/validation/validateRate');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'tajmuhabath.rates.sample.html');
const html = fs.readFileSync(FIXTURE_PATH, 'utf8');

test('parseHtml extracts the real captured CNY row, not the first row on the page', () => {
  const result = parseHtml(html, 'CNY');
  assert.ok(result, 'expected a parsed result for CNY, got null');
  assert.equal(result.buyRate, 60.2);
  assert.equal(result.sellRate, 60.6);
});

test('parseHtml does not confuse CNY with USD or SGD rows', () => {
  const result = parseHtml(html, 'CNY');
  assert.notEqual(result.buyRate, 4.015);
  assert.notEqual(result.buyRate, 3.17);
});

test('parseHtml correctly locates USD by Code column (sanity check on row-matching, not just CNY)', () => {
  const result = parseHtml(html, 'USD');
  assert.ok(result, 'expected a parsed result for USD, got null');
  assert.equal(result.buyRate, 4.015);
  assert.equal(result.sellRate, 4.055);
});

test('parseHtml returns null for a currency with no matching row in the fixture', () => {
  const result = parseHtml(html, 'JPY');
  assert.equal(result, null);
});

test('parseHtml extracts and correctly parses the row\'s own "Last Updated" source timestamp', () => {
  const result = parseHtml(html, 'CNY');
  assert.ok(result.sourceTimestamp, 'expected a parsed sourceTimestamp');
  // "21-08-2026 10:40:06 AM" in Malaysia time (UTC+8) is 02:40:06 UTC.
  assert.equal(result.sourceTimestamp, '2026-08-21T02:40:06.000Z');
});

test('parseTajTimestamp handles PM correctly (12-hour to 24-hour conversion)', () => {
  // "21-08-2026 05:48:36 PM" -> 17:48:36 local (UTC+8) -> 09:48:36 UTC.
  assert.equal(parseTajTimestamp('21-08-2026 05:48:36 PM'), '2026-08-21T09:48:36.000Z');
});

test('parseTajTimestamp handles 12 AM / 12 PM edge cases correctly', () => {
  // 12:00:00 AM is midnight (00:00 local), 12:00:00 PM is noon (12:00 local).
  assert.equal(parseTajTimestamp('01-01-2026 12:00:00 AM'), '2025-12-31T16:00:00.000Z');
  assert.equal(parseTajTimestamp('01-01-2026 12:00:00 PM'), '2026-01-01T04:00:00.000Z');
});

test('parseTajTimestamp returns null for an unparseable string rather than throwing', () => {
  assert.equal(parseTajTimestamp('not a timestamp'), null);
  assert.equal(parseTajTimestamp(''), null);
  assert.equal(parseTajTimestamp(null), null);
});

test('the extracted CNY reading passes validateRate() against the configured expected range', () => {
  const { config } = require('../backend/scrapers/tajmuhabath.adapter');
  const result = parseHtml(html, 'CNY');
  const validation = validateRate({
    currency: 'CNY',
    buyRate: result.buyRate,
    sellRate: result.sellRate,
    retrievedAt: new Date().toISOString(),
    expectedRange: config.validation.expectedRange.CNY,
  });
  assert.equal(validation.passed, true, `expected validation to pass, reasons: ${validation.reasons.join('; ')}`);
});
