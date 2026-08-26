/**
 * Phase 10 test — backend/notifications/notify.js.
 *
 * Only the parts of notify() that don't require a real network call are
 * exercised here: message formatting (pure), and every branch that returns
 * BEFORE ever calling sendEmail()/sendTelegramMessage() (missing
 * destination, and the 'browser'/'whatsapp'/'sms' NOT_APPLICABLE fallback —
 * PENDING through Phase 24, changed in Phase 25: see notify.js's own
 * comment on that branch for why PENDING was misleading here). The
 * actual DELIVERED path (a real Resend/Telegram API call succeeding) is
 * not something `node --test` can verify without live credentials and
 * network access — same category of gap already flagged honestly for the
 * scheduler's own end-to-end proof (see phase-1-status.md's Phase 8 notes):
 * the first real proof of actual delivery has to happen against a real
 * account, via a real triggered alert, not a unit test with a mocked
 * network layer this project has deliberately avoided elsewhere.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { notify, formatAlertText } = require('../backend/notifications/notify');

const BASE_PAYLOAD = {
  currency: 'CNY',
  rateType: 'SELL',
  rate: 60.5,
  targetRate: 60.5,
  source: 'My Money Master',
  retrievedAt: '2026-08-22T13:02:00.000Z',
};

test('formatAlertText matches the project brief\'s section 11 template shape', () => {
  const text = formatAlertText(BASE_PAYLOAD);
  assert.ok(text.includes('🚨 Currency Rate Alert'));
  assert.ok(text.includes('Currency: CNY'));
  assert.ok(text.includes('Rate Type: SELL'));
  assert.ok(text.includes('Current Rate: 60.5'));
  assert.ok(text.includes('Target Rate: 60.5'));
  assert.ok(text.includes('My Money Master'));
  assert.ok(text.includes('TARGET REACHED'));
  assert.ok(text.includes('Time:'));
});

test('formatAlertText falls back to the current time when retrievedAt is missing', () => {
  const { retrievedAt, ...rest } = BASE_PAYLOAD;
  const text = formatAlertText(rest);
  assert.ok(text.includes('Time:'));
});

// Bug fix (26-Aug-2026, reported): a real delivered email showed
// "8/26/2026, 8:09:45 AM" — the GitHub Actions runner's own UTC time in
// en-US format, not Malaysia time in the DD-MMM-YYYY format PROJECT
// INSTRUCTIONS section 8/11 itself uses. formatMalaysiaTime() now formats
// explicitly in Asia/Kuala_Lumpur (UTC+8) regardless of the host process's
// own timezone — this test proves the exact output for a known instant,
// not just that SOME "Time:" line exists (the two tests above already
// covered that, but neither would have caught the wrong-timezone bug).
//
// Bug fix (26-Aug-2026, reported again): switched from 24-hour to 12-hour
// clock with an AM/PM suffix — 21:02:00 becomes 09:02:00 PM.
test('formatAlertText renders the Time: line in Malaysia local time (UTC+8), DD-MMM-YYYY hh:mm:ss AM/PM, regardless of host timezone', () => {
  // BASE_PAYLOAD.retrievedAt = '2026-08-22T13:02:00.000Z' -> 13:02 UTC + 8h = 21:02 MYT = 09:02 PM.
  const text = formatAlertText(BASE_PAYLOAD);
  assert.ok(text.includes('Time:\n22-Aug-2026 09:02:00 PM'), `expected Malaysia-formatted time in:\n${text}`);
});

test('formatMalaysiaTime is exported directly and available for other channels (push) to use', () => {
  const { formatMalaysiaTime } = require('../backend/notifications/notify');
  assert.equal(formatMalaysiaTime('2026-08-26T00:09:45.000Z'), '26-Aug-2026 08:09:45 AM');
});

test('formatMalaysiaTime renders the midnight edge case as 12:00:00 AM, not 00:00:00', () => {
  const { formatMalaysiaTime } = require('../backend/notifications/notify');
  // 2026-08-25T16:00:00.000Z + 8h = 2026-08-26T00:00:00 MYT (midnight).
  assert.equal(formatMalaysiaTime('2026-08-25T16:00:00.000Z'), '26-Aug-2026 12:00:00 AM');
});

test('notify() with channel "email" and no email on file fails cleanly without attempting a send', async () => {
  const result = await notify({ channel: 'email' }, BASE_PAYLOAD);
  assert.equal(result.delivered, false);
  assert.equal(result.deliveryStatus, 'FAILED');
  assert.match(result.error, /no email address/i);
});

test('notify() with channel "telegram" and no chat id fails cleanly without attempting a send', async () => {
  const result = await notify({ channel: 'telegram' }, BASE_PAYLOAD);
  assert.equal(result.delivered, false);
  assert.equal(result.deliveryStatus, 'FAILED');
  assert.match(result.error, /no telegram chat id/i);
});

// Phase 39 (26-Aug-2026) tests — real Web Push delivery. Same "only test
// what returns before a real network call" boundary as the email/telegram
// tests above: notify.js's own upfront guard (no pushSubscription on the
// target) never reaches backend/notifications/webpush.js's actual
// webpush.sendNotification() call, so this is fully testable without
// live VAPID keys or a real browser subscription. webpush.js's own guards
// (missing VAPID keys, malformed subscription) are covered separately in
// tests/webpush.test.js.
test('notify() with channel "push" and no subscription fails cleanly without attempting a send', async () => {
  const result = await notify({ channel: 'push' }, BASE_PAYLOAD);
  assert.equal(result.delivered, false);
  assert.equal(result.deliveryStatus, 'FAILED');
  assert.match(result.error, /no push subscription/i);
});

test('notify() with channel "push" and a subscription missing its endpoint also fails cleanly', async () => {
  const result = await notify({ channel: 'push', pushSubscription: { keys: {} } }, BASE_PAYLOAD);
  assert.equal(result.delivered, false);
  assert.equal(result.deliveryStatus, 'FAILED');
  assert.match(result.error, /no push subscription/i);
});

test('notify() with channel "browser" returns NOT_APPLICABLE — not FAILED, not DELIVERED, and not the old misleading PENDING', async () => {
  const result = await notify({ channel: 'browser' }, BASE_PAYLOAD);
  assert.equal(result.delivered, false);
  assert.equal(result.deliveryStatus, 'NOT_APPLICABLE');
  assert.match(result.error, /no server-side delivery/i);
});

test('notify() with an unimplemented channel (whatsapp/sms) also returns NOT_APPLICABLE, never crashes', async () => {
  const whatsapp = await notify({ channel: 'whatsapp' }, BASE_PAYLOAD);
  assert.equal(whatsapp.deliveryStatus, 'NOT_APPLICABLE');
  const sms = await notify({ channel: 'sms' }, BASE_PAYLOAD);
  assert.equal(sms.deliveryStatus, 'NOT_APPLICABLE');
});
