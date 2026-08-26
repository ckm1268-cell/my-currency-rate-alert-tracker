/**
 * Phase 39 test — backend/notifications/webpush.js.
 *
 * Same philosophy as tests/notify.test.js's own header comment for
 * email/telegram: only the guard clauses that return/throw BEFORE ever
 * attempting a real network call to a push service are exercised here.
 * The actual DELIVERED path (a real push service accepting a real,
 * encrypted Web Push request) is not something `node --test` can verify
 * without a real subscription from a real browser and real VAPID keys —
 * same category of gap already flagged honestly for email/Telegram's own
 * DELIVERED path.
 *
 * Sets/restores process.env.VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY around
 * each test that needs a specific state, and always restores the original
 * values afterward so this file doesn't leak environment changes into
 * whatever test file node --test happens to run next in the same process.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { sendWebPush, ensureVapidConfigured } = require('../backend/notifications/webpush');

// A REAL, correctly-shaped VAPID key pair — `web-push`'s own
// setVapidDetails() validates the public key is a proper 65-byte decoded
// EC point (RFC compliant), so a made-up string fails at that validation
// step rather than reaching the guard this test file is actually about.
// Caught this exact mistake before shipping: an earlier version of this
// file used a hand-typed fake string here, which made the "missing
// subscription, keys ARE configured" test below fail on the WRONG
// assertion (a VAPID validation error, not the subscription guard).
// Pre-generated once via `web-push`'s own generateVAPIDKeys() and
// hardcoded here (rather than calling that function at test-run time)
// because `require('web-push')` only resolves from inside backend/ —
// backend/node_modules is not on Node's module path when a test file
// under tests/ requires it directly, only when backend/notifications/
// webpush.js itself does. This pair is not registered with any real push
// service and is used purely as a validly-shaped fixture — there is
// nothing to protect by keeping it secret.
const REAL_SHAPED_KEYS = {
  publicKey: 'BGYdIAVuo7eXkV7wgKhD7oO6fdEzDSMPUbEXBoYLhe-UtSrOLsrhbRErbF8nQ8Erz9LkIqDXwhrx-miNRK8tUU0',
  privateKey: 'ectC-9QNNeKqaRnmI-BdaIUW-2LHymJ8G1Ey8wTceDk',
};

const ORIGINAL_ENV = {
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
  VAPID_SUBJECT: process.env.VAPID_SUBJECT,
};

function restoreEnv() {
  for (const key of Object.keys(ORIGINAL_ENV)) {
    if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL_ENV[key];
  }
}

function clearVapidEnv() {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
}

const FAKE_SUBSCRIPTION = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/fake-endpoint-for-tests',
  keys: { p256dh: 'fake-p256dh', auth: 'fake-auth' },
};

test('ensureVapidConfigured throws a clear error when both VAPID keys are missing', () => {
  clearVapidEnv();
  try {
    assert.throws(() => ensureVapidConfigured(), /VAPID_PUBLIC_KEY.*VAPID_PRIVATE_KEY/s);
  } finally {
    restoreEnv();
  }
});

test('ensureVapidConfigured throws when only one of the two keys is set', () => {
  clearVapidEnv();
  process.env.VAPID_PUBLIC_KEY = 'BF_fake_public_key_only';
  try {
    assert.throws(() => ensureVapidConfigured(), /VAPID_PUBLIC_KEY.*VAPID_PRIVATE_KEY/s);
  } finally {
    restoreEnv();
  }
});

test('sendWebPush rejects with the VAPID guard before ever looking at the subscription, when keys are missing', async () => {
  clearVapidEnv();
  try {
    await assert.rejects(
      () => sendWebPush({ subscription: FAKE_SUBSCRIPTION, title: 't', body: 'b' }),
      /VAPID_PUBLIC_KEY/
    );
  } finally {
    restoreEnv();
  }
});

test('sendWebPush rejects cleanly for a missing subscription, once VAPID keys ARE configured', async () => {
  clearVapidEnv();
  // A real, correctly-shaped (if unregistered-anywhere) key pair is
  // required to get past ensureVapidConfigured()'s call into web-push's
  // own setVapidDetails() validation and reach the subscription guard
  // this test actually targets — see REAL_SHAPED_KEYS's own comment above.
  process.env.VAPID_PUBLIC_KEY = REAL_SHAPED_KEYS.publicKey;
  process.env.VAPID_PRIVATE_KEY = REAL_SHAPED_KEYS.privateKey;
  try {
    await assert.rejects(
      () => sendWebPush({ subscription: null, title: 't', body: 'b' }),
      /valid push subscription/
    );
    await assert.rejects(
      () => sendWebPush({ subscription: {}, title: 't', body: 'b' }),
      /valid push subscription/
    );
  } finally {
    restoreEnv();
  }
});

test('never leaves VAPID env vars mutated for later tests in this run', () => {
  // Sanity check on this file's own restoreEnv() discipline, not on
  // webpush.js itself — a real regression here would silently corrupt
  // whichever test file node --test happens to run next.
  assert.equal(process.env.VAPID_PUBLIC_KEY, ORIGINAL_ENV.VAPID_PUBLIC_KEY);
  assert.equal(process.env.VAPID_PRIVATE_KEY, ORIGINAL_ENV.VAPID_PRIVATE_KEY);
});
