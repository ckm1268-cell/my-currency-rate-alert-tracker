# Tests

Run the whole suite from `backend/` with `npm test`, or directly from the
repo root with `node --test tests/`. Each file below can also be run on its
own, e.g. `node --test tests/notify.test.js` — useful since a couple of the
adapter tests take several seconds each (they exercise real Playwright
parsing logic against saved HTML fixtures, not the live sites).

As of v1.0.0, 112 tests pass across 14 files. None of them make a real
network call to a money-changer site, a push service, Resend, or Telegram —
every adapter/notification test runs against a saved fixture or a guard
clause that returns before any network call would happen. The genuine
DELIVERED/LIVE paths (a real scrape succeeding, a real email/Telegram/push
message actually arriving) are proven separately, by hand, against the real
services — see each SETUP.md's own Troubleshooting section for how.

| File | Covers |
|---|---|
| `mymoneymaster.adapter.test.js` | Parses My Money Master's rendered DOM into a `StandardRateResult`; a broken/changed page structure produces `EXTRACTION_ERROR`, never a silently wrong number. |
| `tajmuhabath.adapter.test.js` | Same, plus branch selection. |
| `merchantradeasia.adapter.test.js` | Same, plus the per-currency display-name matching and the VND/TWD unit-scale handling (per 1,000,000 / per 100). |
| `jalinanduta.adapter.test.js` | Same, matching rows by ISO currency code rather than display-name text. |
| `compareTarget.test.js` | The target-comparison engine — the worked examples from the project brief (60.53 / 60.50 / 60.45 against target 60.50), every alert condition, and `pickBestReading()`'s best-across-sources selection. |
| `isDueForCheck.test.js` | Per-alert monitoring-interval throttling — an alert's own interval, not just the workflow's 5-minute cadence, decides whether it's actually re-checked on a given run. |
| `comboSelection.test.js` | The scheduler's pure source+currency+branch deduplication — one live check per distinct combo per run, not one per alert. |
| `bnmReference.test.js` | Fetching/caching Bank Negara Malaysia's free reference rate. |
| `bnmCrossCheck.test.js` | Using that reference rate as an additional sanity check on top of (never instead of) each adapter's own expected-range validation. |
| `notify.test.js` | Message formatting (including the Malaysia-local-time `Time:` line), and every notify() branch that returns before a real network call — missing email/Telegram/push destination, and the `browser`/`whatsapp`/`sms` `NOT_APPLICABLE` channels. |
| `webpush.test.js` | The Web Push guard clauses — missing/misconfigured VAPID keys, missing/malformed subscription — all before `web-push`'s own network call. |
| `resolveNotifyTarget.test.js` | Resolving each alert's selected notification methods into concrete delivery targets (email lookup + per-run cache, Telegram chat ID, push subscription), for any combination selected at once. |

Multi-user isolation (User A cannot read/write User B's alerts) is enforced
by Postgres Row-Level Security itself, not application code — see
`database/schema.sql`'s policies and `SUPABASE_SETUP.md`'s own note on how
that was live-tested across three separate accounts.
