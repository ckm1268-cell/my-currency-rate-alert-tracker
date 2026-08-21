# Tests

Phase 1 scaffold — no tests yet, since there is no live logic to test
(adapters, validation, and the target engine are all stubs that throw
"not implemented"). This folder is created now so each phase adds its
tests alongside its implementation instead of bolting testing on at the end.

Planned test coverage, per the project's Testing Requirements:

- `mymoneymaster.adapter.test.js` — Phase 2. Asserts the adapter returns a
  well-formed `StandardRateResult`, and that a broken/changed selector
  produces `EXTRACTION_ERROR`, not a silently wrong number.
- `tajmuhabath.adapter.test.js` — Phase 3. Same, plus a branch-selection case.
- `validateRate.test.js` — Phase 4. Numeric/range/buy-vs-sell/staleness cases,
  including the "0.6053 instead of 60.53" false-alert scenario from the spec.
- `compareTarget.test.js` — Phase 5. The three worked examples from the
  spec (60.53 / 60.50 / 60.45 against target 60.50) plus duplicate-alert
  suppression.
- `notify.test.js` — Phase 6/10.
- Multi-user isolation test — Phase 7 (User A cannot read/write User B's
  alerts once Supabase Row-Level Security is in place).
