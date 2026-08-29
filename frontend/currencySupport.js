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
 * NOTE for whoever next audits this bug class: backend/validation/
 * bnmCrossCheck.js's ADAPTER_CURRENCY_UNIT map is a separate,
 * still-hand-duplicated allowlist of the same general shape (per-source
 * unit-scale conventions, not currency support) — flagged, not folded
 * into this file yet, since it's a different kind of data with a
 * different consumer shape. Worth the same treatment eventually.
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
  };

  return {
    CODE_MATCHED_SOURCES: CODE_MATCHED_SOURCES,
    DISPLAY_NAME_MATCHED_CURRENCIES: DISPLAY_NAME_MATCHED_CURRENCIES,
  };
});
