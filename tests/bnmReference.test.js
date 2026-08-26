/**
 * Phase 31 test — backend/reference/bnmReference.js.
 *
 * toAdapterUnit() is a pure function, tested directly. getBnmReferenceRate()
 * makes a real network call to api.bnm.gov.my in production — this sandbox
 * cannot reach that host (same constraint documented throughout this
 * project's other adapters, e.g. mymoneymaster.adapter.js's own test file
 * only proves parseHtml() against a captured real response rather than the
 * live fetch() itself). Unlike an adapter's HTML structure though, this
 * module's request/response handling is fully known — it's written against
 * an ACTUAL response the project owner captured live via PowerShell on
 * 26-Aug-2026 (see the module's own header comment) — so its session
 * fallback and caching logic is tested here with global.fetch mocked to
 * return that same real shape, restored after every test.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { toAdapterUnit, getBnmReferenceRate, SESSION_ORDER, _clearCacheForTests } = require('../backend/reference/bnmReference');

function fakeBnmResponse({ session = '0900', currency = 'CNY', unit = 1 } = {}) {
  return {
    data: {
      currency_code: currency,
      unit,
      rate: {
        date: '2026-08-26',
        buying_rate: 0.6002999999999994,
        selling_rate: 0.6009999999999998,
        middle_rate: 0.6006000000000002,
      },
    },
    meta: { quote: 'rm', session, last_updated: '2026-08-26 11:51:19', total_result: 1 },
  };
}

function fakeFetchResponse(body, status = 200) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

test('toAdapterUnit: converts BNM\'s real observed CNY response (per-1, unit 1) to the per-100 adapter convention', () => {
  const result = toAdapterUnit(0.6006000000000002, 1, 100);
  assert.ok(Math.abs(result - 60.06) < 0.001, `expected ~60.06, got ${result}`);
});

test('toAdapterUnit: a currency BNM already quotes per-100 (hypothetical) needs no further scaling to match a per-100 adapter', () => {
  const result = toAdapterUnit(12.34, 100, 100);
  assert.equal(result, 12.34);
});

test('toAdapterUnit: falsy/zero bnmUnit is guarded — returns the input rate unchanged rather than dividing by zero', () => {
  assert.equal(toAdapterUnit(5, 0, 100), 5);
  assert.equal(toAdapterUnit(5, null, 100), 5);
});

test('getBnmReferenceRate: tries sessions newest-to-oldest, returns the first one with real data', async () => {
  _clearCacheForTests();
  const originalFetch = global.fetch;
  const attemptedSessions = [];
  global.fetch = async (url) => {
    const session = new URL(url).searchParams.get('session');
    attemptedSessions.push(session);
    // Simulate: today's data only exists for 0900 so far (matches the real
    // "queried 1130 before 11:30am -> 404" case the project owner hit).
    if (session === '0900') return fakeFetchResponse(fakeBnmResponse({ session: '0900' }));
    return fakeFetchResponse({ message: 'No records found.', code: 404 }, 404);
  };
  try {
    const result = await getBnmReferenceRate('CNY');
    assert.ok(result, 'expected a result once the 0900 session succeeds');
    assert.equal(result.session, '0900');
    assert.equal(result.currencyCode, 'CNY');
    assert.equal(result.bnmUnit, 1);
    assert.equal(result.middleRate, 0.6006000000000002);
    // Confirms the newest-to-oldest order from SESSION_ORDER was actually followed.
    assert.deepEqual(attemptedSessions, SESSION_ORDER);
  } finally {
    global.fetch = originalFetch;
  }
});

test('getBnmReferenceRate: every session 404s (e.g. a brand new day before 9am) returns null, not a throw', async () => {
  _clearCacheForTests();
  const originalFetch = global.fetch;
  global.fetch = async () => fakeFetchResponse({ message: 'No records found.', code: 404 }, 404);
  try {
    const result = await getBnmReferenceRate('CNY');
    assert.equal(result, null);
  } finally {
    global.fetch = originalFetch;
  }
});

test('getBnmReferenceRate: a network error on one session is swallowed and the next session is still tried', async () => {
  _clearCacheForTests();
  const originalFetch = global.fetch;
  let callCount = 0;
  global.fetch = async (url) => {
    callCount++;
    const session = new URL(url).searchParams.get('session');
    if (session === '1700') throw new Error('simulated network failure');
    if (session === '1200') return fakeFetchResponse(fakeBnmResponse({ session: '1200' }));
    return fakeFetchResponse({ message: 'No records found.', code: 404 }, 404);
  };
  try {
    const result = await getBnmReferenceRate('CNY');
    assert.ok(result);
    assert.equal(result.session, '1200');
    assert.ok(callCount >= 2, 'expected the loop to continue past the thrown session');
  } finally {
    global.fetch = originalFetch;
  }
});

test('getBnmReferenceRate: caches a successful result — a second call within the TTL does not refetch', async () => {
  _clearCacheForTests();
  const originalFetch = global.fetch;
  let callCount = 0;
  global.fetch = async () => {
    callCount++;
    return fakeFetchResponse(fakeBnmResponse({ session: '0900' }));
  };
  try {
    const first = await getBnmReferenceRate('CNY');
    const second = await getBnmReferenceRate('CNY');
    assert.ok(first && second);
    assert.equal(callCount, 1, 'expected only one real fetch — the second call should have been served from cache');
  } finally {
    global.fetch = originalFetch;
  }
});

test('getBnmReferenceRate: a malformed response (missing rate.middle_rate) is treated as no data, not a crash', async () => {
  _clearCacheForTests();
  const originalFetch = global.fetch;
  global.fetch = async () => fakeFetchResponse({ data: { currency_code: 'CNY', unit: 1, rate: {} }, meta: {} });
  try {
    const result = await getBnmReferenceRate('CNY');
    assert.equal(result, null);
  } finally {
    global.fetch = originalFetch;
  }
});
