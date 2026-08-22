/**
 * Test — Merchantrade Asia adapter's parsing logic (added post-Phase 10,
 * 22-Aug-2026).
 *
 * Tests parseHtml() (the pure, browser-free half of the adapter) against
 * tests/fixtures/merchantradeasia.exchange.sample.html, whose rows are real
 * markup captured live on 22-Aug-2026 after the site's own JavaScript had
 * populated them (see that file's header comment) — not invented sample
 * data.
 *
 * Deliberately does NOT test fetchRate() itself (the Playwright-driving
 * half) — same reasoning as tests/tajmuhabath.adapter.test.js: this repo's
 * dev sandbox has restricted network egress and cannot reach mtradeasia.com,
 * and even with network access, launching a real browser per test run is
 * out of scope for a fast unit suite. This adapter's live network path was
 * proven by hand, via real browser automation, during this build (see the
 * header comment in backend/scrapers/merchantradeasia.adapter.js), and will
 * be proven again end-to-end whichever environment actually runs it with
 * real internet access (GitHub Actions).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseHtml, config } = require('../backend/scrapers/merchantradeasia.adapter');
const { validateRate } = require('../backend/validation/validateRate');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'merchantradeasia.exchange.sample.html');
const html = fs.readFileSync(FIXTURE_PATH, 'utf8');

test('parseHtml extracts the real captured CNY row, not the first data row on the page', () => {
  const result = parseHtml(html, 'CNY');
  assert.ok(result, 'expected a parsed result for CNY, got null');
  assert.equal(result.buyRate, 59.2199);
  assert.equal(result.sellRate, 61.8);
});

test('parseHtml does not confuse CNY with AUD or JPY rows', () => {
  const result = parseHtml(html, 'CNY');
  assert.notEqual(result.buyRate, 2.7799);
  assert.notEqual(result.buyRate, 2.4399);
});

test('parseHtml returns null for a currency with a configured display name but no matching row in the fixture', () => {
  // GBP is a real row on the live page ("GREAT BRITAIN POUND") but is
  // deliberately not in currencyDisplayNames yet (only CNY is, matching
  // this adapter's actual scope) — add it there first if this ever needs
  // to test "configured but not in this particular fixture" more directly.
  // For now, reuse CNY's own config against a fixture that's been emptied
  // of CNY to prove a real "not found" path distinct from the
  // no-config-entry path covered by the next test.
  const noCnyHtml = html.replace(/CHINESE RENMINBI/g, 'SOMETHING ELSE');
  const result = parseHtml(noCnyHtml, 'CNY');
  assert.equal(result, null);
});

test('parseHtml throws a clear error for a currency with no currencyDisplayNames config entry', () => {
  assert.throws(() => parseHtml(html, 'ZZZ'), /No currencyDisplayNames entry/);
});

test('the extracted CNY reading passes validateRate() against the configured expected range', () => {
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

test('config.id matches the adapter module name convention used elsewhere (mymoneymaster, tajmuhabath)', () => {
  assert.equal(config.id, 'merchantradeasia');
});

// VND and TWD added 22-Aug-2026 (same day, currency-selection follow-up) —
// no adapter code changed for this, only config/websites/merchantradeasia.json's
// currencyDisplayNames + validation.expectedRange, since parseHtml() is
// already currency-agnostic. These tests exist to prove that addition
// actually works end-to-end against real captured markup, not just that
// the config file parses as valid JSON.

test('parseHtml extracts the real captured VND row (quoted per 1,000,000 units, not per 100 like CNY)', () => {
  const result = parseHtml(html, 'VND');
  assert.ok(result, 'expected a parsed result for VND, got null');
  assert.equal(result.buyRate, 150.71);
  assert.equal(result.sellRate, 158.8);
});

test('parseHtml extracts the real captured TWD row', () => {
  const result = parseHtml(html, 'TWD');
  assert.ok(result, 'expected a parsed result for TWD, got null');
  assert.equal(result.buyRate, 12.3189);
  assert.equal(result.sellRate, 12.755);
});

test('parseHtml does not confuse VND and TWD with each other or with CNY', () => {
  const vnd = parseHtml(html, 'VND');
  const twd = parseHtml(html, 'TWD');
  const cny = parseHtml(html, 'CNY');
  assert.notEqual(vnd.buyRate, twd.buyRate);
  assert.notEqual(vnd.buyRate, cny.buyRate);
  assert.notEqual(twd.buyRate, cny.buyRate);
});

test('the extracted VND and TWD readings each pass validateRate() against their OWN configured expected range', () => {
  for (const currency of ['VND', 'TWD']) {
    const result = parseHtml(html, currency);
    const validation = validateRate({
      currency,
      buyRate: result.buyRate,
      sellRate: result.sellRate,
      retrievedAt: new Date().toISOString(),
      expectedRange: config.validation.expectedRange[currency],
    });
    assert.equal(
      validation.passed,
      true,
      `expected ${currency} validation to pass, reasons: ${validation.reasons.join('; ')}`
    );
  }
});

test('VND fails validation if (incorrectly) checked against CNY\'s expected range — proving the per-currency range actually matters, not just present', () => {
  const result = parseHtml(html, 'VND');
  const validation = validateRate({
    currency: 'VND',
    buyRate: result.buyRate,
    sellRate: result.sellRate,
    retrievedAt: new Date().toISOString(),
    expectedRange: config.validation.expectedRange.CNY, // deliberately the WRONG range for this currency
  });
  // VND's real values (~150-159) fall outside CNY's [40, 80] range, so this
  // must fail — if it passed, that would mean expectedRange isn't actually
  // being enforced per-currency, which is exactly the "0.6053 instead of
  // 60.53" decimal-placement bug class this check exists to catch.
  assert.equal(validation.passed, false);
});
