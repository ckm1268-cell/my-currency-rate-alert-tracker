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

/**
 * Phase 55 (02-Sep-2026) — branch selection added. This page was found,
 * during a live connected-browser session, to now have a real "Select
 * Branch" control whose value genuinely changes the Counter Exchange
 * Rates table's numbers — see config/websites/merchantradeasia.json's
 * Phase 55 notes for the full evidence. The adapter's PRIMARY path
 * switched from Playwright DOM-scraping to a direct GET against this
 * page's own confirmed JSON endpoint (config.endpoint) — see the
 * adapter's own header comment for why this mirrors
 * wawasanilham.adapter.js's precedent rather than tajmuhabath.adapter.js's
 * (that endpoint requires an auth token this project deliberately does
 * not attempt to replicate; this one does not).
 *
 * These tests exercise parseJsonRates() (the new primary path's pure
 * parsing function) against two real, live-captured JSON fixtures — one
 * per branch, captured moments apart in the same session — plus
 * resolveBranch(). parseHtml() (the DOM path, now the Playwright
 * fallback's own parser) is unchanged and already covered by every test
 * above this point.
 */

const { parseJsonRates, resolveBranch } = require('../backend/scrapers/merchantradeasia.adapter');

const PAVILION_KL_FIXTURE_PATH = path.join(
  __dirname,
  'fixtures',
  'merchantradeasia.branch.pavilionkl.sample.json'
);
const GARDENS_MALL_FIXTURE_PATH = path.join(
  __dirname,
  'fixtures',
  'merchantradeasia.branch.gardensmall.sample.json'
);
const pavilionKlJson = JSON.parse(fs.readFileSync(PAVILION_KL_FIXTURE_PATH, 'utf8'));
const gardensMallJson = JSON.parse(fs.readFileSync(GARDENS_MALL_FIXTURE_PATH, 'utf8'));

test('resolveBranch resolves a real branch code from config.branches', () => {
  const branch = resolveBranch('MY0100083');
  assert.ok(branch, 'expected MY0100083 to resolve');
  assert.equal(branch.name, 'Pavilion KL');
});

test('resolveBranch resolves by display name too, case-insensitively', () => {
  const branch = resolveBranch('the gardens mall kl');
  assert.ok(branch, 'expected a case-insensitive name match to resolve');
  assert.equal(branch.id, 'MY0100141');
});

test('resolveBranch falls back to config.defaultBranch (Pavilion KL) when no branch is requested', () => {
  const branch = resolveBranch();
  assert.ok(branch);
  assert.equal(branch.id, config.defaultBranch);
  assert.equal(branch.id, 'MY0100083');
});

test('resolveBranch returns null for an unrecognized branch rather than guessing', () => {
  assert.equal(resolveBranch('Not A Real Branch'), null);
});

test('parseJsonRates extracts the real captured CNY row from the Pavilion KL fixture', () => {
  const result = parseJsonRates(pavilionKlJson, 'CNY');
  assert.ok(result, 'expected a parsed result for CNY, got null');
  assert.equal(result.buyRate, 59.1599);
  assert.equal(result.sellRate, 61.6);
});

test('parseJsonRates produces a genuinely different CNY reading for a different branch, from real data', () => {
  // Both fixtures were captured live, moments apart, in the same session —
  // proving branch selection actually changes the number, not just that
  // two different fixture files exist.
  const pavilion = parseJsonRates(pavilionKlJson, 'CNY');
  const gardens = parseJsonRates(gardensMallJson, 'CNY');
  assert.equal(pavilion.buyRate, 59.1599);
  assert.equal(pavilion.sellRate, 61.6);
  assert.equal(gardens.buyRate, 60.35);
  assert.equal(gardens.sellRate, 60.55);
  assert.notEqual(pavilion.buyRate, gardens.buyRate);
  assert.notEqual(pavilion.sellRate, gardens.sellRate);
});

test('parseJsonRates applies the same JPY unit-scale conversion (x10) as parseHtml does', () => {
  const result = parseJsonRates(pavilionKlJson, 'JPY');
  assert.ok(result, 'expected a parsed result for JPY, got null');
  // Raw endpoint value * unit = 0.024179 * 100 = 2.4179, then x10 per
  // config.unitScaleMultiplier.JPY — same conversion parseHtml() applies,
  // same real live value observed on-page (see config/websites/
  // merchantradeasia.json's Phase 55 notes).
  assert.equal(result.buyRate, 24.179);
  assert.equal(result.sellRate, 26.4);
});

test('parseJsonRates matches ONLY the USD BIG row, never USD MEDIUM or USD SMALL, even though all three rows contain "USD"', () => {
  const result = parseJsonRates(pavilionKlJson, 'USD');
  assert.ok(result, 'expected a parsed result for USD, got null');
  assert.equal(result.buyRate, 3.9289);
  assert.equal(result.sellRate, 4.143);
});

test('parseJsonRates matches ONLY the SGD BIG row, never SGD SMALL', () => {
  const result = parseJsonRates(pavilionKlJson, 'SGD');
  assert.ok(result, 'expected a parsed result for SGD, got null');
  assert.equal(result.buyRate, 3.0689);
  assert.equal(result.sellRate, 3.283);
});

test('parseJsonRates extracts VND (quoted per 1,000,000 units) correctly', () => {
  const result = parseJsonRates(pavilionKlJson, 'VND');
  assert.ok(result, 'expected a parsed result for VND, got null');
  assert.equal(result.buyRate, 148);
  assert.equal(result.sellRate, 168.5);
});

test('parseJsonRates returns null for a currency with a configured display name but no matching row in the fixture', () => {
  // Neither fixture includes a KRW row.
  const result = parseJsonRates(pavilionKlJson, 'KRW');
  assert.equal(result, null);
});

test('parseJsonRates throws a clear error for a currency with no currencyDisplayNames config entry', () => {
  assert.throws(() => parseJsonRates(pavilionKlJson, 'ZZZ'), /No currencyDisplayNames entry/);
});

test('parseJsonRates returns null for a malformed response missing a data array', () => {
  assert.equal(parseJsonRates({}, 'CNY'), null);
  assert.equal(parseJsonRates(null, 'CNY'), null);
});

test('the extracted CNY reading (Pavilion KL) passes validateRate() against the configured expected range', () => {
  const result = parseJsonRates(pavilionKlJson, 'CNY');
  const validation = validateRate({
    currency: 'CNY',
    buyRate: result.buyRate,
    sellRate: result.sellRate,
    retrievedAt: new Date().toISOString(),
    expectedRange: config.validation.expectedRange.CNY,
  });
  assert.equal(validation.passed, true, `expected validation to pass, reasons: ${validation.reasons.join('; ')}`);
});

test('config.branchSupport is true and config.branches lists all 14 real branch codes', () => {
  assert.equal(config.branchSupport, true);
  assert.equal(config.branches.length, 14);
  assert.ok(config.branches.every((b) => typeof b.id === 'string' && typeof b.name === 'string'));
});
