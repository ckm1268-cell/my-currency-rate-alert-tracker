/**
 * Phase 11 test — backend/scheduler/run.js's resolveNotifyTargets().
 *
 * This file's name is unchanged from Phase 10 (resolveNotifyTarget.test.js,
 * singular) even though the function it tests was renamed to the plural
 * resolveNotifyTargets() — kept as-is deliberately to avoid an extra file
 * rename/delete step, which has been a real source of pain earlier in this
 * project's git history (see the file-mode/index.lock saga in the project
 * status notes). The content below fully covers the new plural,
 * simultaneous-multi-channel behavior.
 *
 * Uses a fake Supabase client (just the one method this function actually
 * calls, sb.auth.admin.getUserById) rather than a real project — this
 * function's own logic (which channel maps to which lookup, and the
 * per-run email cache) is what's under test here, not Supabase itself.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveNotifyTargets } = require('../backend/scheduler/run');

function fakeSupabase(getUserByIdImpl) {
  let calls = 0;
  return {
    client: {
      auth: {
        admin: {
          getUserById: async (id) => {
            calls++;
            return getUserByIdImpl(id);
          },
        },
      },
    },
    getCalls: () => calls,
  };
}

test('resolveNotifyTargets: a single-channel alert (array of one) behaves the same as the old single-value version', async () => {
  const alert = { notification_methods: ['telegram'], telegram_chat_id: '123456789', user_id: 'u1' };
  const targets = await resolveNotifyTargets({}, alert, new Map());
  assert.deepEqual(targets, [{ channel: 'telegram', telegramChatId: '123456789' }]);
});

test('resolveNotifyTargets: email + telegram selected together resolves BOTH targets, in the order selected', async () => {
  const fake = fakeSupabase(async () => ({ data: { user: { email: 'user@example.com' } }, error: null }));
  const alert = { notification_methods: ['email', 'telegram'], telegram_chat_id: '123456789', user_id: 'u1' };
  const targets = await resolveNotifyTargets(fake.client, alert, new Map());
  assert.deepEqual(targets, [
    { channel: 'email', email: 'user@example.com' },
    { channel: 'telegram', telegramChatId: '123456789' },
  ]);
});

test('resolveNotifyTargets: browser + email + telegram all at once resolves all three targets', async () => {
  const fake = fakeSupabase(async () => ({ data: { user: { email: 'user@example.com' } }, error: null }));
  const alert = { notification_methods: ['browser', 'email', 'telegram'], telegram_chat_id: '999', user_id: 'u1' };
  const targets = await resolveNotifyTargets(fake.client, alert, new Map());
  assert.deepEqual(targets, [
    { channel: 'browser' },
    { channel: 'email', email: 'user@example.com' },
    { channel: 'telegram', telegramChatId: '999' },
  ]);
});

test('resolveNotifyTargets: email lookups are cached per user_id within one run, across multiple alerts and multiple channels', async () => {
  const fake = fakeSupabase(async () => ({ data: { user: { email: 'user@example.com' } }, error: null }));
  const cache = new Map();
  const alertA = { notification_methods: ['email'], user_id: 'u1' };
  const alertB = { notification_methods: ['email', 'browser'], user_id: 'u1' }; // same user, another alert with email again

  await resolveNotifyTargets(fake.client, alertA, cache);
  await resolveNotifyTargets(fake.client, alertB, cache);

  assert.equal(fake.getCalls(), 1, 'second alert for the same user must reuse the cached email, not look it up again');
});

test('resolveNotifyTargets: a failed email lookup resolves to a null email, not a thrown error', async () => {
  const fake = fakeSupabase(async () => ({ data: null, error: new Error('user not found') }));
  const alert = { notification_methods: ['email'], user_id: 'ghost' };
  const targets = await resolveNotifyTargets(fake.client, alert, new Map());
  assert.deepEqual(targets, [{ channel: 'email', email: null }]);
});

test('resolveNotifyTargets: browser/whatsapp/sms need no lookup at all', async () => {
  const targets = await resolveNotifyTargets(
    {},
    { notification_methods: ['browser', 'whatsapp', 'sms'], user_id: 'u1' },
    new Map()
  );
  assert.deepEqual(targets, [{ channel: 'browser' }, { channel: 'whatsapp' }, { channel: 'sms' }]);
});

// Phase 39 (26-Aug-2026) tests — 'push' resolves from the alert row itself
// (alerts.push_subscription), same no-lookup shape as 'telegram' resolving
// from alerts.telegram_chat_id, and unlike 'email' which needs the Auth
// admin API + a per-run cache.

test('resolveNotifyTargets: "push" passes the alert\'s own push_subscription straight through, unchanged', async () => {
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'x', auth: 'y' } };
  const alert = { notification_methods: ['push'], push_subscription: subscription, user_id: 'u1' };
  const targets = await resolveNotifyTargets({}, alert, new Map());
  assert.deepEqual(targets, [{ channel: 'push', pushSubscription: subscription }]);
});

test('resolveNotifyTargets: "push" with no saved subscription still resolves a target (null subscription) rather than throwing — notify.js\'s own guard is what turns this into a clean FAILED', async () => {
  const alert = { notification_methods: ['push'], push_subscription: null, user_id: 'u1' };
  const targets = await resolveNotifyTargets({}, alert, new Map());
  assert.deepEqual(targets, [{ channel: 'push', pushSubscription: null }]);
});

test('resolveNotifyTargets: push + email + telegram all at once resolves all three targets, push needing no admin-API call', async () => {
  const fake = fakeSupabase(async () => ({ data: { user: { email: 'user@example.com' } }, error: null }));
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'x', auth: 'y' } };
  const alert = {
    notification_methods: ['push', 'email', 'telegram'],
    push_subscription: subscription,
    telegram_chat_id: '555',
    user_id: 'u1',
  };
  const targets = await resolveNotifyTargets(fake.client, alert, new Map());
  assert.deepEqual(targets, [
    { channel: 'push', pushSubscription: subscription },
    { channel: 'email', email: 'user@example.com' },
    { channel: 'telegram', telegramChatId: '555' },
  ]);
  assert.equal(fake.getCalls(), 1, 'push must never trigger an email-style admin API lookup');
});

test('resolveNotifyTargets: falls back to the old singular notification_method column for a pre-migration row', async () => {
  const targets = await resolveNotifyTargets({}, { notification_method: 'browser', user_id: 'u1' }, new Map());
  assert.deepEqual(targets, [{ channel: 'browser' }]);
});

test('resolveNotifyTargets: falls back to [\'browser\'] when neither column has a usable value, rather than throwing', async () => {
  const targets = await resolveNotifyTargets({}, { user_id: 'u1' }, new Map());
  assert.deepEqual(targets, [{ channel: 'browser' }]);
});
