/**
 * MY Currency Rate Tracker — shared money-changer display-name source of
 * truth
 * =====================================================================
 * Phase 49 (29-Aug-2026): companion to frontend/currencySupport.js
 * (Phase 48) — same problem, same fix, different data. This file
 * replaces the two independent, hand-maintained copies of "money changer
 * id -> display name" that used to live separately in frontend/app.js's
 * SOURCES array (the `name` field of each entry) and
 * backend/scheduler/run.js's own SOURCE_DISPLAY_NAMES object — flagged,
 * but deliberately not fixed yet, in frontend/currencySupport.js's own
 * Phase 48 header comment ("a separate, still-hand-duplicated allowlist
 * of the same general shape... worth the same treatment eventually").
 *
 * A drift here wouldn't silently skip a currency the way the Phase 48
 * bug did — backend/scheduler/run.js's own lookup falls back to the raw
 * id (`SOURCE_DISPLAY_NAMES[best.source] || best.source`) — but it would
 * degrade what a real user actually reads in a real alert (project
 * brief Section 11's "Money Changer:" line), e.g. showing the raw id
 * "jalinanduta" instead of "Jalinan Duta" for a 5th money changer added
 * to one file and forgotten in the other. Same root cause as Phase 48,
 * so the same fix: one file, loaded synchronously by both sides, nothing
 * left to keep in sync by hand.
 *
 *   - frontend/app.js (browser): loaded via a <script> tag in
 *     frontend/index.html, BEFORE app.js, and reads
 *     window.CKM_SOURCE_NAMES.SOURCE_DISPLAY_NAMES — SOURCES' own `name`
 *     field for each entry is sourced from here instead of being retyped.
 *   - backend/scheduler/run.js (Node): loaded via
 *     require('../../frontend/sourceNames.js') and reads
 *     module.exports.SOURCE_DISPLAY_NAMES directly, replacing its own
 *     local object literal.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CKM_SOURCE_NAMES = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SOURCE_DISPLAY_NAMES = {
    mymoneymaster: 'My Money Master',
    tajmuhabath: 'Taj Muhabath',
    merchantradeasia: 'Merchantrade Asia',
    jalinanduta: 'Jalinan Duta',
  };

  return {
    SOURCE_DISPLAY_NAMES: SOURCE_DISPLAY_NAMES,
  };
});
