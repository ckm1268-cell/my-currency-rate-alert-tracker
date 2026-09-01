/**
 * Unit tests for wawasanilham.adapter.js.
 *
 * The fixture below is a trimmed excerpt of the REAL 'table' HTML fragment
 * captured live from https://www.wawasanilham.com/site/getRateHistory/6
 * (Seri Kembangan branch) on 01-Sep-2026 — real tag structure, real class
 * names, real observed values, not an invented shape. This proves the
 * parsing logic (fixed-column extraction + name-to-ISO-code resolution)
 * against genuinely observed data. It does not by itself prove the
 * network/session-handling half of fetchRate() — that requires an actual
 * live run (see config/websites/wawasanilham.json's compliance.actionRequired).
 */

const assert = require('node:assert');
const {
  parseTableHtml,
  resolveBranch,
  resolveCurrencyCode,
} = require('../backend/scrapers/wawasanilham.adapter');

// Excerpt of the real captured 'table' field for branch_id=6 (Seri Kembangan),
// trimmed to a handful of rows for readability — whitespace/tag structure
// otherwise matches the real captured HTML exactly.
const fixtureTableHtml = `
<tr>
  <td class="currency-txt-left">
    <span class="currency-icon"><img src="usd.png" /></span>
    <span class="currency-txt">US DOLLAR</span>
  </td>
  <td>1</td>
  <td>3.950</td>
  <td>4.075</td>
  <td>12:47 PM</td>
</tr>
<tr>
  <td class="currency-txt-left">
    <span class="currency-icon"><img src="gbp.png" /></span>
    <span class="currency-txt">Sterling Pound</span>
  </td>
  <td>1</td>
  <td>5.420</td>
  <td>5.540</td>
  <td>12:47 PM</td>
</tr>
<tr>
  <td class="currency-txt-left">
    <span class="currency-icon"><img src="cny.png" /></span>
    <span class="currency-txt">Chinese Renminbi</span>
  </td>
  <td>100</td>
  <td>59.150</td>
  <td>61.950</td>
  <td>12:47 PM</td>
</tr>
<tr>
  <td class="currency-txt-left">
    <span class="currency-icon"><img src="jpy.png" /></span>
    <span class="currency-txt">Japanese Yen</span>
  </td>
  <td>1000</td>
  <td>24.300</td>
  <td>26.950</td>
  <td>12:47 PM</td>
</tr>
`;

function run() {
  // --- parseTableHtml(): fixed-column extraction + name->code resolution ---
  const cases = [
    ['USD', { buyRate: 3.95, sellRate: 4.075 }],
    ['GBP', { buyRate: 5.42, sellRate: 5.54 }],
    ['CNY', { buyRate: 59.15, sellRate: 61.95 }],
    ['JPY', { buyRate: 24.3, sellRate: 26.95 }],
  ];

  for (const [code, expected] of cases) {
    const result = parseTableHtml(fixtureTableHtml, code);
    assert.ok(result, `expected a match for ${code}`);
    assert.strictEqual(result.buyRate, expected.buyRate, `${code} buyRate mismatch`);
    assert.strictEqual(result.sellRate, expected.sellRate, `${code} sellRate mismatch`);
  }

  // A currency genuinely absent from this fixture -> null, not a guess.
  assert.strictEqual(
    parseTableHtml(fixtureTableHtml, 'AUD'),
    null,
    'a currency not present in the table must return null, not a fabricated value'
  );

  // Empty/garbage input must never throw.
  assert.strictEqual(parseTableHtml('', 'CNY'), null);
  assert.strictEqual(parseTableHtml('<tr><td></td></tr>', 'CNY'), null);

  // --- resolveCurrencyCode(): name matching is case-insensitive ---
  assert.strictEqual(resolveCurrencyCode('Chinese Renminbi'), 'CNY');
  assert.strictEqual(resolveCurrencyCode('CHINESE RENMINBI'), 'CNY');
  assert.strictEqual(resolveCurrencyCode('chinese renminbi'), 'CNY');
  assert.strictEqual(resolveCurrencyCode('USD (1$,2$,5$,10$ & 20$)'), 'USS');
  assert.strictEqual(
    resolveCurrencyCode('Not A Real Currency'),
    null,
    'an unmapped display name must return null, not guess a code'
  );

  // --- resolveBranch(): real, verified branch IDs (see config's branchNotes
  // for why these are deliberately NOT sequential/guessable from UI order) ---
  assert.strictEqual(resolveBranch('6').id, '6');
  assert.strictEqual(resolveBranch('6').name, 'Seri Kembangan');
  assert.strictEqual(resolveBranch('Chowkit').id, '5');
  assert.strictEqual(resolveBranch('chowkit').id, '5'); // case-insensitive by name
  assert.strictEqual(resolveBranch('Melawati Mall').id, '11');
  assert.strictEqual(
    resolveBranch('Some Branch That Does Not Exist'),
    null,
    'an unknown branch must return null, never a silent default to the wrong branch'
  );
  assert.ok(resolveBranch(undefined), 'no branch requested should fall back to config.defaultBranch');

  console.log('wawasanilham.adapter.test.js: all assertions passed');
}

run();
