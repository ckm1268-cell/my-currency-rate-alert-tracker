/**
 * MY Currency Rate Tracker — shared Malaysia-time formatting source of
 * truth
 * =====================================================================
 * Phase 49 (29-Aug-2026): a third instance of the same anti-pattern
 * Phase 48 fixed for currency support — this time a whole FUNCTION, not
 * just data. formatMalaysiaTime() used to be defined twice: once in
 * backend/notifications/notify.js, once in frontend/app.js's fireAlert(),
 * byte-for-byte identical on purpose (per each file's own old comment —
 * "matches ... exactly ... kept identical here so the two never drift")
 * specifically so every notification channel (browser, email, Telegram,
 * push) reports the same trigger time the same way. Both files'
 * comments explained the duplication as necessary because "this project
 * has no bundler/shared-module setup between frontend and backend" —
 * true when written (26-Aug-2026), no longer true as of Phase 48
 * (29-Aug-2026), which built exactly that for
 * frontend/currencySupport.js. This file applies the same pattern here.
 *
 *   - frontend/app.js (browser): loaded via a <script> tag in
 *     frontend/index.html, BEFORE app.js, and reads
 *     window.CKM_TIME_FORMAT.formatMalaysiaTime.
 *   - backend/notifications/notify.js (Node): loaded via
 *     require('../../frontend/timeFormat.js') and reads
 *     module.exports.formatMalaysiaTime — still re-exported from
 *     notify.js itself too, unchanged, since backend/scheduler/run.js
 *     and this project's existing tests already import it from there.
 *
 * Always formats in Asia/Kuala_Lumpur (UTC+8) regardless of the running
 * process's own timezone/locale — see the original 26-Aug-2026 bug this
 * was written to fix: without an explicit `timeZone`, a plain
 * `new Date().toLocaleString()` used whatever the host environment
 * defaulted to (the GitHub Actions runner's UTC for backend channels;
 * the browser's own locale for the in-tab channel), so the exact same
 * alert could show a different time on different channels. Formats as
 * DD-MMM-YYYY hh:mm:ss AM/PM, matching PROJECT INSTRUCTIONS section
 * 8/11's own examples ("21-Aug-2026 12:45:32") plus a later 12-hour/
 * AM-PM request — reads `dayPeriod` straight out of formatToParts()
 * rather than building it by hand (en-US's dayPeriod values are already
 * the plain "AM"/"PM" this app wants). Confirmed correct at the midnight
 * edge case (00:00 MYT -> "12:00:00 AM", not "00:00:00") — see
 * tests/notify.test.js and tests/sharedModules.test.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CKM_TIME_FORMAT = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function formatMalaysiaTime(input) {
    var d = input ? new Date(input) : new Date();
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kuala_Lumpur',
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
    }).formatToParts(d);
    var get = function (type) {
      return parts.find(function (p) { return p.type === type; }).value;
    };
    return get('day') + '-' + get('month') + '-' + get('year') + ' ' +
      get('hour') + ':' + get('minute') + ':' + get('second') + ' ' + get('dayPeriod');
  }

  return {
    formatMalaysiaTime: formatMalaysiaTime,
  };
});
