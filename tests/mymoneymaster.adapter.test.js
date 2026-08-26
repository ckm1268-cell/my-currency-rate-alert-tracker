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

test('parseHtml throws for a currency this site genuinely does not list, rather than returning a silent null', () => {
  // Phase 38 (26-Aug-2026) update: this test originally used GBP, but
  // Phase 38 added a real, browser-verified currencyDisplayNames.GBP
  // entry to config/websites/mymoneymaster.json (the site does list GBP
  // as "Sterling Pound" — see that file's Phase 38 note), so GBP no
  // longer exercises the "no config entry" failure mode this test is
  // actually about. Swapped to THB, which (per the same Phase 38
  // browser session) this site genuinely does not quote at all — still a
  // real gap, not a config oversight. This should throw (missing config
  // entry), which is the correct failure mode: we want a loud config
  // error, not a silent null, when asking for a currency the adapter was
  // never told how to find.
  assert.throws(() => parseHtml(html, 'THB'), /No currencyDisplayNames entry/);
});

test('parseHtml no longer throws for JPY (config entry now exists) but correctly finds no card in this fixture', () => {
  // Phase 37 (26-Aug-2026): config/websites/mymoneymaster.json now has a
  // currencyDisplayNames.JPY entry ("Japanese Yen") — added from a
  // WebFetch-based read of the live page (Buy 25.25 / Sell 25.56
  // observed), NOT a raw HTML capture the way this fixture's real CNY
  // card was. Deliberately NOT adding a fabricated "JPY card" to this
  // fixture to make this test pass green — this file's own header
  // comment is explicit that every card in it is either real captured
  // markup or an obviously-labeled placeholder, and a guessed JPY block
  // would blur that line. This test instead proves the ONLY thing that's
  // actually verifiable from here: the config wiring itself works (no
  // more "No currencyDisplayNames entry" throw), while still correctly
  // returning null rather than fabricating a match, since no JPY card is
  // present in this small fixture. See mymoneymaster.json's
  // compliance.actionRequired for the real verification step this is
  // waiting on: a live `node backend/scripts/checkRate.js mymoneymaster
  // JPY` run, cross-checked by the project owner against the real site,
  // before JPY can be promoted to frontend/app.js's REAL_ADAPTER_SUPPORT.
  assert.doesNotThrow(() => parseHtml(html, 'JPY'));
  assert.equal(parseHtml(html, 'JPY'), null);
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
