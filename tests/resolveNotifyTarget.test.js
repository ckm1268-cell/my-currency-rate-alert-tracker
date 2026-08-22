/**
 * Phase 10 test — backend/scheduler/run.js's resolveNotifyTarget().
 *
 * Uses a fake Supabase client (just the one method this function actually
 * calls, sb.auth.admin.getUserById) rather than a real project — this
 * function's own logic (which channel maps to which lookup, and the
 * per-run email cache) is what's under test here, not Supabase itself.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveNotifyTarget } = require('../backend/scheduler/run');

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

test('resolveNotifyTarget: telegram channel passes through the alert\'s own telegram_chat_id, no lookup needed', async () => {
  const alert = { notification_method: 'telegram', telegram_chat_id: '123456789', user_id: 'u1' };
  const target = await resolveNotifyTarget({}, alert, new Map());
  assert.deepEqual(target, { channel: 'telegram', telegramChatId: '123456789' });
});

test('resolveNotifyTarget: email channel resolves the user\'s real auth email via the admin API', async () => {
  const fake = fakeSupabase(async () => ({ data: { user: { email: 'user@example.com' } }, error: null }));
  const alert = { notification_method: 'email', user_id: 'u1' };
  const target = await resolveNotifyTarget(fake.client, alert, new Map());
  assert.deepEqual(target, { channel: 'email', email: 'user@example.com' });
  assert.equal(fake.getCalls(), 1);
});

test('resolveNotifyTarget: email lookups are cached per user_id within one run', async () => {
  const fake = fakeSupabase(async () => ({ data: { user: { email: 'user@example.com' } }, error: null }));
  const cache = new Map();
  const alertA = { notification_method: 'email', user_id: 'u1' };
  const alertB = { notification_method: 'email', user_id: 'u1' }; // same user, e.g. two active alerts

  await resolveNotifyTarget(fake.client, alertA, cache);
  await resolveNotifyTarget(fake.client, alertB, cache);

  assert.equal(fake.getCalls(), 1, 'second alert for the same user must reuse the cached email, not look it up again');
});

test('resolveNotifyTarget: a failed email lookup resolves to a null email, not a thrown error', async () => {
  const fake = fakeSupabase(async () => ({ data: null, error: new Error('user not found') }));
  const alert = { notification_method: 'email', user_id: 'ghost' };
  const target = await resolveNotifyTarget(fake.client, alert, new Map());
  assert.deepEqual(target, { channel: 'email', email: null });
});

test('resolveNotifyTarget: browser/whatsapp/sms need no lookup at all', async () => {
  const target = await resolveNotifyTarget({}, { notification_method: 'browser', user_id: 'u1' }, new Map());
  assert.deepEqual(target, { channel: 'browser' });
});
