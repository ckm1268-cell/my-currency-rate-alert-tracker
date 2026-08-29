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
  // Phase 38 (26-Aug-2026) note: currencyDisplayNames now also covers
  // VND/TWD/HKD/EUR/GBP/AUD/THB/KRW (see config/websites/merchantradeasia.json),
  // not just CNY as when this comment was first written — but this
  // fixture only has real captured markup for CNY/VND/TWD, so reusing
  // CNY's own config against a fixture that's been emptied of CNY still
  // proves the same "configured but not present in THIS fixture" path,
  // distinct from the no-config-entry path covered by the next test.
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

// JPY and USD added 28-Aug-2026 (Phase 44), at the project owner's explicit
// direction, resolving the two currencies documented as deliberately
// excluded above (Phase 38): JPY needed a unit-scale conversion (this site
// quotes it per 100, the app convention is per 1,000), USD needed a
// standard tier picked among three real, differently-priced BIG/MEDIUM/
// SMALL rows (see config/websites/merchantradeasia.json's
// currencyDisplayNamesNotes/unitScaleMultiplierNotes for the full
// reasoning). These tests exist to prove both actually work end-to-end
// against real captured markup, not just that the config file parses.

test('parseHtml extracts the real captured JPY row AND applies the unit-scale conversion (raw site value x10)', () => {
  const result = parseHtml(html, 'JPY');
  assert.ok(result, 'expected a parsed result for JPY, got null');
  // Raw site values (fixture, per 100 JPY): Buy 2.4399 / Sell 2.6830 — this
  // page's own native convention, confirmed live. The app-wide convention
  // (frontend/app.js CURRENCIES, every other adapter, bnmCrossCheck's
  // ADAPTER_CURRENCY_UNIT) is per 1,000, i.e. x10 of this page's own unit.
  assert.equal(result.buyRate, 24.399);
  assert.equal(result.sellRate, 26.83);
});

test('the extracted JPY reading (post-conversion) passes validateRate() against the configured expected range', () => {
  const result = parseHtml(html, 'JPY');
  const validation = validateRate({
    currency: 'JPY',
    buyRate: result.buyRate,
    sellRate: result.sellRate,
    retrievedAt: new Date().toISOString(),
    expectedRange: config.validation.expectedRange.JPY,
  });
  assert.equal(validation.passed, true, `expected validation to pass, reasons: ${validation.reasons.join('; ')}`);
});

test('JPY would fail validation if the unit-scale conversion were skipped — proving the conversion is load-bearing, not cosmetic', () => {
  // The raw, unconverted site value (2.4399) is nowhere near JPY's
  // expectedRange ({min:15,max:40}, which assumes the standard per-1,000
  // convention) — if this passed, bnmCrossCheck's own gross-deviation
  // check against BNM's reference rate would also have silently accepted
  // an ~10x-wrong number as a real live rate.
  const validation = validateRate({
    currency: 'JPY',
    buyRate: 2.4399,
    sellRate: 2.683,
    retrievedAt: new Date().toISOString(),
    expectedRange: config.validation.expectedRange.JPY,
  });
  assert.equal(validation.passed, false);
});

test('parseHtml matches ONLY the USD BIG row, never USD MEDIUM or USD SMALL, even though all three rows contain "USD"', () => {
  const result = parseHtml(html, 'USD');
  assert.ok(result, 'expected a parsed result for USD, got null');
  // BIG is genuinely priced differently from MEDIUM/SMALL in this fixture
  // (real captured values) — if the matcher accidentally picked up
  // MEDIUM or SMALL instead, this specific buyRate assertion would catch it.
  assert.equal(result.buyRate, 3.9169);
  assert.equal(result.sellRate, 4.11);
});

test('the extracted USD BIG reading passes validateRate() against the configured expected range', () => {
  const result = parseHtml(html, 'USD');
  const validation = validateRate({
    currency: 'USD',
    buyRate: result.buyRate,
    sellRate: result.sellRate,
    retrievedAt: new Date().toISOString(),
    expectedRange: config.validation.expectedRange.USD,
  });
  assert.equal(validation.passed, true, `expected validation to pass, reasons: ${validation.reasons.join('; ')}`);
});

test('parseHtml does not apply the JPY unit-scale conversion to USD (or any other currency)', () => {
  const usd = parseHtml(html, 'USD');
  const cny = parseHtml(html, 'CNY');
  // Sanity check that config.unitScaleMultiplier only has a JPY entry —
  // if USD or CNY ever accidentally got a multiplier, these real captured
  // values would no longer match the assertions in their own dedicated
  // tests above, but this test makes the intent explicit rather than
  // relying on that as an indirect signal.
  assert.equal(config.unitScaleMultiplier.USD, undefined);
  assert.equal(config.unitScaleMultiplier.CNY, undefined);
  assert.ok(usd && cny);
});

// SGD added 28-Aug-2026 (Phase 46), same reasoning and same denomination-
// split shape as USD (Phase 44): the project owner picked a standard tier
// (BIG) among real, structurally-independent BIG/SMALL rows — see
// config/websites/merchantradeasia.json's currencyDisplayNamesNotes for
// the full reasoning, including why this page's own display text uses
// "SINGAPORE" rather than "SGD".

test('parseHtml extracts the real captured SGD BIG row', () => {
  const result = parseHtml(html, 'SGD');
  assert.ok(result, 'expected a parsed result for SGD, got null');
  assert.equal(result.buyRate, 3.0799);
  assert.equal(result.sellRate, 3.288);
});

test('the extracted SGD BIG reading passes validateRate() against the configured expected range', () => {
  const result = parseHtml(html, 'SGD');
  const validation = validateRate({
    currency: 'SGD',
    buyRate: result.buyRate,
    sellRate: result.sellRate,
    retrievedAt: new Date().toISOString(),
    expectedRange: config.validation.expectedRange.SGD,
  });
  assert.equal(validation.passed, true, `expected validation to pass, reasons: ${validation.reasons.join('; ')}`);
});

test('config.currencyDisplayNames.SGD ("SINGAPORE BIG") is a targeted match: it appears in the BIG row\'s display name but NOT the SMALL row\'s', () => {
  // Unlike USD's three tiers, this fixture's real captured SGD BIG/SMALL
  // values happen to be identical (3.0799/3.2880 for both, same as USD's
  // MEDIUM/SMALL coincidence) — so the buyRate/sellRate assertions above
  // can't by themselves prove the matcher is targeting the right row
  // rather than accidentally landing on SMALL. This test proves the
  // substring match is genuinely selective regardless: if the site's two
  // tiers ever diverge in price, config.currencyDisplayNames.SGD is
  // guaranteed to resolve to BIG specifically, not whichever row happens
  // to come first.
  const bigRowText = '/ SINGAPORE BIG (1000,500,100,50)';
  const smallRowText = '/ SINGAPORE SMALL (20,10,5,2)';
  const needle = config.currencyDisplayNames.SGD.toLowerCase();
  assert.ok(bigRowText.toLowerCase().includes(needle), 'expected SGD config value to match the BIG row');
  assert.ok(!smallRowText.toLowerCase().includes(needle), 'SGD config value must NOT also match the SMALL row');
});
