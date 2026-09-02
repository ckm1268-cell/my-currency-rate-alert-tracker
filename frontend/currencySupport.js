/**
 * MY Currency Rate Tracker — shared currency-support source of truth
 * =====================================================================
 * Phase 48 (29-Aug-2026): this file replaces the two independent,
 * hand-maintained copies of CODE_MATCHED_SOURCES /
 * DISPLAY_NAME_MATCHED_CURRENCIES that used to live separately in
 * frontend/app.js and backend/scheduler/comboSelection.js, "kept in sync
 * by hand" per a comment in each file. That discipline failed twice in
 * this project's real history without either file ever raising an
 * error — a change to one copy that forgot the other just silently
 * skipped a currency in production (My Money Master + VND, Phase 42;
 * Merchantrade Asia + JPY/USD/SGD, Phase 47) until a user noticed the
 * live dashboard was wrong. A test that compared two hardcoded literals
 * against each other (tests/comboSelection.test.js's old "must never
 * drift" test) didn't catch it either, because it never actually read
 * frontend/app.js — it just asserted two copies pasted into the test
 * file agreed with each other.
 *
 * This file is now the ONLY place this data is defined. There is
 * structurally nowhere else for it to live and nothing left to keep "in
 * sync" by hand — updating a currency here updates it for both sides in
 * the same edit, because both sides load these exact same bytes:
 *   - frontend/app.js (browser): loaded via a <script> tag in
 *     frontend/index.html, BEFORE app.js, and reads
 *     window.CKM_CURRENCY_SUPPORT.
 *   - backend/scheduler/comboSelection.js (Node): loaded via
 *     require('../../frontend/currencySupport.js') and reads
 *     module.exports.
 * The UMD wrapper below exists only to make that one file work
 * unmodified in both environments — it adds no logic of its own.
 *
 * CODE_MATCHED_SOURCES: sources whose adapter matches a currency
 * generically by the ISO code the live page itself prints in each row
 * (Taj Muhabath, Jalinan Duta, My Money Master as of Phase 42). These are
 * structurally incapable of a per-currency "config gap" bug — any code a
 * site's live page lists is picked up automatically, and one it doesn't
 * list fails honestly (EXTRACTION_ERROR/SOURCE_UNAVAILABLE) rather than
 * needing an entry here first. See each adapter's own parseHtml().
 *
 * DISPLAY_NAME_MATCHED_CURRENCIES: sources that instead match by the
 * site's own display-name text (currently: Merchantrade Asia only),
 * which genuinely does need an explicit per-currency entry before a
 * combo can go LIVE — this is the only shape of source where a "config
 * gap" bug of this exact kind can occur. The matching TEXT itself still
 * lives in config/websites/merchantradeasia.json's own
 * currencyDisplayNames map (captured from the live DOM, not guessed);
 * this file only needs to agree with that config on WHICH currencies
 * exist there, so both this list and comboSelection.js/app.js's
 * consumption of it stay simple, synchronous data — no async fetch, no
 * build step, no risk of a load-order race.
 *
 * CURRENCY_UNIT (added Phase 49, 29-Aug-2026): the per-currency
 * denomination each money changer's Buy/Sell figures are quoted against
 * (e.g. CNY per 100, JPY per 1,000, VND per 1,000,000, most others per
 * 1). This used to live only in backend/validation/bnmCrossCheck.js as
 * its own ADAPTER_CURRENCY_UNIT object literal — flagged right here, in
 * this file's own Phase 48 version of this comment, as "a separate,
 * still-hand-duplicated allowlist of the same general shape... worth
 * the same treatment eventually." Every config/websites/*.json adapter's
 * own notes already describe this exact convention as something that
 * had to be manually checked against frontend/app.js and
 * bnmCrossCheck.js by a human (e.g. merchantradeasia.json's
 * unitScaleMultiplierNotes names ADAPTER_CURRENCY_UNIT directly as the
 * convention its JPY x10 correction targets) — none of that checking was
 * ever code-enforced. This file is now the one place this data is
 * defined; bnmCrossCheck.js require()s it instead of declaring its own
 * copy.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CKM_CURRENCY_SUPPORT = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CODE_MATCHED_SOURCES = ['tajmuhabath', 'jalinanduta', 'mymoneymaster'];

  var DISPLAY_NAME_MATCHED_CURRENCIES = {
    merchantradeasia: ['CNY', 'VND', 'TWD', 'HKD', 'EUR', 'GBP', 'AUD', 'THB', 'KRW', 'JPY', 'USD', 'SGD'],
    // Phase 52 (02-Sep-2026) — Wawasan Ilham matches by the rate table's own
    // currency-name cell (see config/websites/wawasanilham.json's
    // currencyDisplayNames), same shape as Merchantrade Asia, not by ISO code.
    // All 12 of this app's currencies are confirmed present in its own table.
    wawasanilham: ['CNY', 'VND', 'TWD', 'HKD', 'EUR', 'GBP', 'AUD', 'THB', 'KRW', 'JPY', 'USD', 'SGD'],
  };

  var CURRENCY_UNIT = {
    CNY: 100,
    THB: 100,
    HKD: 100,
    JPY: 1000,
    KRW: 1000,
    VND: 1_000_000,
    TWD: 100,
    USD: 1,
    SGD: 1,
    EUR: 1,
    GBP: 1,
    AUD: 1,
  };

  return {
    CODE_MATCHED_SOURCES: CODE_MATCHED_SOURCES,
    DISPLAY_NAME_MATCHED_CURRENCIES: DISPLAY_NAME_MATCHED_CURRENCIES,
    CURRENCY_UNIT: CURRENCY_UNIT,
  };
});
