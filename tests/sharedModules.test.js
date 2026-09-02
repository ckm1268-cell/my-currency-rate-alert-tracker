/**
 * Phase 49 test — verifies the two new shared frontend/*.js modules
 * introduced alongside frontend/currencySupport.js (Phase 48) are
 * genuinely the single source of truth for their backend consumers, not
 * just "matching" copies. See frontend/sourceNames.js and
 * frontend/timeFormat.js's own header comments for the full incident
 * history these replace.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

test('backend/scheduler/run.js\'s SOURCE_DISPLAY_NAMES is frontend/sourceNames.js\'s data, unmodified', () => {
  const { SOURCE_DISPLAY_NAMES } = require('../frontend/sourceNames.js');
  const run = require('../backend/scheduler/run.js');
  assert.deepEqual(run.SOURCE_DISPLAY_NAMES, SOURCE_DISPLAY_NAMES);
});

test('frontend/sourceNames.js has exactly one entry per registered adapter source', () => {
  const { SOURCE_DISPLAY_NAMES } = require('../frontend/sourceNames.js');
  // Phase 52 (02-Sep-2026): wawasanilham added, wired into production.
  assert.deepEqual(Object.keys(SOURCE_DISPLAY_NAMES).sort(), [
    'jalinanduta', 'merchantradeasia', 'mymoneymaster', 'tajmuhabath', 'wawasanilham',
  ]);
});

test('backend/notifications/notify.js\'s formatMalaysiaTime IS frontend/timeFormat.js\'s function (same reference, not a copy)', () => {
  const { formatMalaysiaTime } = require('../frontend/timeFormat.js');
  const notify = require('../backend/notifications/notify.js');
  assert.equal(notify.formatMalaysiaTime, formatMalaysiaTime);
});

test('frontend/timeFormat.js formatMalaysiaTime: explicit Asia/Kuala_Lumpur regardless of host TZ', () => {
  const { formatMalaysiaTime } = require('../frontend/timeFormat.js');
  assert.equal(formatMalaysiaTime('2026-08-26T00:09:45.000Z'), '26-Aug-2026 08:09:45 AM');
});

test('frontend/timeFormat.js formatMalaysiaTime: midnight edge case renders as 12:00:00 AM, not 00:00:00', () => {
  const { formatMalaysiaTime } = require('../frontend/timeFormat.js');
  assert.equal(formatMalaysiaTime('2026-08-25T16:00:00.000Z'), '26-Aug-2026 12:00:00 AM');
});
