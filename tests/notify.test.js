/**
 * Phase 10 test — backend/notifications/notify.js.
 *
 * Only the parts of notify() that don't require a real network call are
 * exercised here: message formatting (pure), and every branch that returns
 * BEFORE ever calling sendEmail()/sendTelegramMessage() (missing
 * destination, and the 'browser'/'whatsapp'/'sms' PENDING fallback). The
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

test('notify() with channel "browser" returns PENDING — not FAILED, not DELIVERED', async () => {
  const result = await notify({ channel: 'browser' }, BASE_PAYLOAD);
  assert.equal(result.delivered, false);
  assert.equal(result.deliveryStatus, 'PENDING');
  assert.equal(result.error, null);
});

test('notify() with an unimplemented channel (whatsapp/sms) also returns PENDING, never crashes', async () => {
  const whatsapp = await notify({ channel: 'whatsapp' }, BASE_PAYLOAD);
  assert.equal(whatsapp.deliveryStatus, 'PENDING');
  const sms = await notify({ channel: 'sms' }, BASE_PAYLOAD);
  assert.equal(sms.deliveryStatus, 'PENDING');
});
