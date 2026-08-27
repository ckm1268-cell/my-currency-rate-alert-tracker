/**
 * Phase 2 test — My Money Master adapter's parsing logic.
 * Rewritten Phase 42 (27-Aug-2026) for the migration to the
 * 'index.php?/Home/full_rate_board' page and code-based matching — see
 * backend/scrapers/mymoneymaster.adapter.js's header comment for the full
 * rationale (short version: VND was permanently stuck on SIMULATED
 * because the old '/Home/rate_board' 8-card page never listed it at all;
 * a user-supplied screenshot led to finding the real page that does).
 *
 * This tests parseHtml() (the pure, network-free half of the adapter)
 * against tests/fixtures/mymoneymaster.full_rate_board.sample.html, whose
 * rows are real markup/values captured live on 27-Aug-2026 (see that
 * file's header comment) — not invented sample data.
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

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'mymoneymaster.full_rate_board.sample.html');
const html = fs.readFileSync(FIXTURE_PATH, 'utf8');

test('parseHtml extracts the real captured VND rate — the originally reported bug', () => {
  const result = parseHtml(html, 'VND');
  assert.ok(result, 'expected a parsed result for VND, got null');
  assert.equal(result.buyRate, 155.30);
  assert.equal(result.sellRate, 157.80);
});

test('parseHtml extracts the real captured CNY rate, not the first row on the page', () => {
  const result = parseHtml(html, 'CNY');
  assert.ok(result, 'expected a parsed result for CNY, got null');
  assert.equal(result.buyRate, 60.20);
  assert.equal(result.sellRate, 60.47);
});

test('parseHtml does not confuse CNY with a different currency row (AUD placeholder)', () => {
  const result = parseHtml(html, 'CNY');
  assert.notEqual(result.buyRate, 2.886);
  assert.notEqual(result.sellRate, 2.905);
});

test('parseHtml extracts the three other currencies Phase 42 newly unlocked for this source (THB, KRW, TWD)', () => {
  const thb = parseHtml(html, 'THB');
  assert.ok(thb, 'expected a parsed result for THB, got null');
  assert.equal(thb.buyRate, 12.30);
  assert.equal(thb.sellRate, 12.40);

  const krw = parseHtml(html, 'KRW');
  assert.ok(krw, 'expected a parsed result for KRW, got null');
  assert.equal(krw.buyRate, 2.925);
  assert.equal(krw.sellRate, 2.955);

  const twd = parseHtml(html, 'TWD');
  assert.ok(twd, 'expected a parsed result for TWD, got null');
  assert.equal(twd.buyRate, 12.415);
  assert.equal(twd.sellRate, 12.495);
});

test('parseHtml matches by ISO code, not by a hand-maintained display-name list — a currency outside this app\'s own 12-currency set (CAD) still resolves', () => {
  // Proves the matching strategy itself is now generic (same as Taj
  // Muhabath/Jalinan Duta), not still secretly gated by some allowlist —
  // CAD isn't one of frontend/app.js's supported currencies, so nothing
  // upstream will ever actually request it, but parseHtml() has no way
  // to know that and shouldn't need to.
  const result = parseHtml(html, 'CAD');
  assert.ok(result, 'expected a parsed result for CAD, got null');
  assert.equal(result.buyRate, 2.89);
  assert.equal(result.sellRate, 2.935);
});

test('parseHtml returns null (not a throw) for a code genuinely absent from the page, honoring the honest-failure contract', () => {
  // Phase 42 changed the failure mode for "currency not found" from a
  // hard throw (the old "No currencyDisplayNames entry" error, back when
  // a missing config entry was the only way to fail) to a plain null —
  // matching how Taj Muhabath/Jalinan Duta's parseHtml() already behave,
  // since there's no config entry left to be "missing" once matching is
  // code-based. fetchRate() turns this null into an honest
  // EXTRACTION_ERROR, never a fabricated number.
  assert.equal(parseHtml(html, 'ZZZ'), null);
});

test('the extracted VND reading passes validateRate() against the configured expected range', () => {
  const { config } = require('../backend/scrapers/mymoneymaster.adapter');
  const result = parseHtml(html, 'VND');
  const validation = validateRate({
    currency: 'VND',
    buyRate: result.buyRate,
    sellRate: result.sellRate,
    retrievedAt: new Date().toISOString(),
    expectedRange: config.validation.expectedRange.VND,
  });
  assert.equal(validation.passed, true, `expected validation to pass, reasons: ${validation.reasons.join('; ')}`);
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

test('validateRate rejects a VND reading missing its 1,000,000-unit scaling (e.g. 0.0001553 instead of 155.30)', () => {
  const validation = validateRate({
    currency: 'VND',
    buyRate: 0.0001553,
    sellRate: 0.0001578,
    retrievedAt: new Date().toISOString(),
    expectedRange: { min: 100, max: 250 },
  });
  assert.equal(validation.passed, false);
});
