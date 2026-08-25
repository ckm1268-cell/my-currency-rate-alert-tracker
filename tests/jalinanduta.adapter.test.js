/**
 * Unit tests for jalinanduta.adapter.js's parseHtml() — the header-driven
 * table/column discovery logic (see that file's header comment for why no
 * CSS selector is hardcoded, and config/websites/jalinanduta.json's
 * verificationLimitation for what is and isn't actually confirmed about
 * the real site).
 *
 * IMPORTANT — what this test does and does not prove: the fixture below
 * mirrors the real DATA VALUES observed via a text-extraction fetch of
 * jalinanduta.com on 24-Aug-2026 (see config's primarySelector.
 * liveSampleObservedAt), rendered as a plausible plain <table>. This proves
 * the PARSING LOGIC — table discovery by header text, column-index mapping,
 * row matching by currency code — is correct against that shape. It does
 * NOT prove the real site's actual HTML matches this fixture's tag
 * structure (no raw DOM capture was available when this was written — see
 * the adapter's own file header). Run backend/scripts/checkRate.js
 * jalinanduta CNY against the real live site before trusting this in
 * production; if it fails, that is the correct "structure may have
 * changed" signal (project brief section 23), not a sign this test is
 * wrong.
 */

const assert = require('node:assert');
const { parseHtml } = require('../backend/scrapers/jalinanduta.adapter');

const fixtureHtml = `
<html><body>
<table id="nav"><tr><th>Link</th><th>URL</th></tr><tr><td>Home</td><td>/</td></tr></table>
<table id="rates">
  <tr><th>Flag</th><th>Code</th><th>Currency</th><th>Unit</th><th>We Sell</th><th>We Buy</th></tr>
  <tr><td>img</td><td>USD</td><td>UNITED STATES DOLLAR</td><td>1</td><td>4.0600</td><td>4.0100</td></tr>
  <tr><td>img</td><td>CNY</td><td>CHINA YUAN RENMINBI</td><td>100</td><td>60.7000</td><td>60.0000</td></tr>
  <tr><td>img</td><td>THB</td><td>THAILAND BAHT</td><td>100</td><td>12.5000</td><td>12.2000</td></tr>
</table>
</body></html>`;

function run() {
  const cases = [
    ['CNY', { buyRate: 60.0, sellRate: 60.7 }],
    ['USD', { buyRate: 4.01, sellRate: 4.06 }],
    ['THB', { buyRate: 12.2, sellRate: 12.5 }],
    ['XYZ', null], // no such row -> null, not a thrown error or a guessed value
  ];

  for (const [code, expected] of cases) {
    const result = parseHtml(fixtureHtml, code);
    assert.deepStrictEqual(result, expected, `parseHtml() mismatch for ${code}`);
  }

  // The decoy "nav" table (no "We Sell"-like header) must never be selected,
  // even though it appears first in document order.
  const navOnlyHtml = `<table><tr><th>Link</th><th>URL</th></tr><tr><td>Home</td><td>/</td></tr></table>`;
  assert.strictEqual(parseHtml(navOnlyHtml, 'CNY'), null, 'a table with no rate-like header must not be matched');

  console.log('jalinanduta.adapter.test.js: all assertions passed');
}

run();
