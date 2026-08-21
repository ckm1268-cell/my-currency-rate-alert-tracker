/**
 * Phase 2 test — My Money Master adapter's parsing logic.
 *
 * This tests parseHtml() (the pure, network-free half of the adapter)
 * against tests/fixtures/mymoneymaster.rate_board.sample.html, whose CNY
 * block is real markup captured live on 21-Aug-2026 (see that file's
 * header comment) — not invented sample data.
 *
 * It deliberately does NOT test fetchRate()'s live network call: this
 * repo's dev sandbox has restricted network egress and cannot reach
 * www.mymoneymaster.com.my, so that call can only be proven end-to-end in
 * an environment with real internet access (GitHub Actions, or a
 * developer's own machine). See the header comment in
 * backend/scrapers/mymoneymaster.adapter.js for the full explanation.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseHtml } = require('../backend/scrapers/mymoneymaster.adapter');
const { validateRate } = require('../backend/validation/validateRate');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'mymoneymaster.rate_board.sample.html');
const html = fs.readFileSync(FIXTURE_PATH, 'utf8');

test('parseHtml extracts the real captured CNY rate, not the first card on the page', () => {
  const result = parseHtml(html, 'CNY');
  assert.ok(result, 'expected a parsed result for CNY, got null');
  assert.equal(result.buyRate, 60.30);
  assert.equal(result.sellRate, 60.60);
});

test('parseHtml does not confuse CNY with a different currency card (USD placeholder)', () => {
  const result = parseHtml(html, 'CNY');
  assert.notEqual(result.buyRate, 4.10);
  assert.notEqual(result.sellRate, 4.25);
});

test('parseHtml returns null for a currency with no matching card', () => {
  // GBP has no config.currencyDisplayNames entry AND no card in the
  // fixture — this should throw (missing config entry), which is the
  // correct failure mode: we want a loud config error, not a silent null,
  // when asking for a currency the adapter was never told how to find.
  assert.throws(() => parseHtml(html, 'GBP'), /No currencyDisplayNames entry/);
});

test('the extracted CNY reading passes validateRate() against the configured expected range', () => {
  const { config } = require('../backend/scrapers/mymoneymaster.adapter');
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

test('validateRate rejects a buy>sell reading (parsing/column-swap bug guard)', () => {
  const validation = validateRate({
    currency: 'CNY',
    buyRate: 60.60,
    sellRate: 60.30, // swapped on purpose
    retrievedAt: new Date().toISOString(),
    expectedRange: { min: 40, max: 80 },
  });
  assert.equal(validation.passed, false);
  assert.ok(validation.reasons.some(r => r.includes('buyRate') && r.includes('greater than')));
});

test('validateRate rejects the decimal-placement false-alert scenario from the project spec (0.6053 instead of 60.53)', () => {
  const validation = validateRate({
    currency: 'CNY',
    buyRate: 0.6025,
    sellRate: 0.6053,
    retrievedAt: new Date().toISOString(),
    expectedRange: { min: 40, max: 80 },
  });
  assert.equal(validation.passed, false);
  assert.ok(validation.reasons.some(r => r.includes('outside the expected range')));
});
