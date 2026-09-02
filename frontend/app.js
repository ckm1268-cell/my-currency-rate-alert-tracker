/**
 * MY Currency Rate Tracker — Phase 3 dashboard logic
 * =====================================================
 * As of Phase 3, BOTH My Money Master CNY and Taj Muhabath CNY (branch:
 * LALAPORT BBCC) are retrieved for real: a GitHub Actions workflow
 * (.github/workflows/pages.yml) runs backend/scrapers/mymoneymaster.adapter.js
 * and backend/scrapers/tajmuhabath.adapter.js on every deploy and writes
 * the results to data/latest-rates.json, a same-origin static file this
 * page fetches in loadLiveData() below. That is the ONLY path any real
 * number reaches this file — there is still no direct network call from
 * the browser to a money-changer site anywhere here (see the project's
 * architecture: the frontend never talks to scraping targets directly).
 *
 * Every other source/currency combination (any currency other than CNY,
 * at either source) has no real adapter yet and is still generated
 * locally by simulateReading() — and is always labeled SIMULATED, never
 * LIVE, per the project's core rule. getReading() below is the dispatcher
 * that decides, per source+currency, whether a reading is real
 * (origin: "REAL") or simulated (origin: "SIMULATED") — every rendering
 * function keys off that flag so the two are never visually confused with
 * each other.
 *
 * The comparison / validation / target-condition logic is real either way
 * — it's pure and has no dependency on where the number came from.
 */

(() => {
  "use strict";

  // ---------------------------------------------------------------------
  // Reference data
  // ---------------------------------------------------------------------

  const CURRENCIES = [
    { code: "CNY", name: "Chinese Yuan", base: 60.5, decimals: 2 },
    { code: "USD", name: "US Dollar", base: 4.04, decimals: 3 },
    { code: "SGD", name: "Singapore Dollar", base: 3.18, decimals: 3 },
    { code: "THB", name: "Thai Baht", base: 12.33, decimals: 2 },
    { code: "JPY", name: "Japanese Yen", base: 25.55, decimals: 2 },
    { code: "KRW", name: "Korean Won", base: 2.92, decimals: 3 },
    { code: "HKD", name: "Hong Kong Dollar", base: 51.65, decimals: 2 },
    { code: "EUR", name: "Euro", base: 4.71, decimals: 3 },
    { code: "GBP", name: "British Pound", base: 5.51, decimals: 3 },
    { code: "AUD", name: "Australian Dollar", base: 2.88, decimals: 3 },
    // VND and TWD added 22-Aug-2026. Unlike every currency above, these two
    // are quoted per a specific unit denomination rather than per-1 (see
    // config/websites/merchantradeasia.json's validation.notes) — "base"
    // here is deliberately scaled to match Merchantrade Asia's own real
    // quoted unit for each (VND per 1,000,000; TWD per 100), since that's
    // currently the only real source for either, and a simulated reading
    // at a mismatched scale would break the multi-source "best rate"
    // comparison the moment Merchantrade Asia is one of the selected
    // sources.
    { code: "VND", name: "Vietnamese Dong (per 1,000,000)", base: 154.5, decimals: 2 },
    { code: "TWD", name: "New Taiwan Dollar (per 100)", base: 12.5, decimals: 3 },
  ];

  // Verified 21-Aug-2026 by opening the live branch dropdown on
  // tajmuhabath.com.my/web/rates.html — real branch names, not invented.
  const TM_BRANCHES = [
    "THE EXCHANGE TRX", "Econsave, Balakong", "Leisure Mall, Cheras",
    "Terminal One, Seremban", "Aeon Big, Tun Hussein Onn", "CS Bangi, Bangi",
    "PETRONAS,GP", "IOI City Mall, Putrajaya", "Jalan Bunus, Masjid India",
    "R&R,Gelang Patah-NB", "R&R,Gelang Patah-SB", "LARKIN SENTRAL",
    "PETRON GELANG PATAH", "LALAPORT BBCC", "SEMUA HOUSE",
    "AEON MALL CHERAS SELATAN",
  ];

  // Phase 52 (02-Sep-2026) — real branch names, verified from
  // config/websites/wawasanilham.json's own branches array (captured
  // directly from the site's live <select id="branch_id"> during the
  // project owner's own browser session, 01-Sep-2026). Index 0 (NSK Trade
  // City, Kuchai Lama = branch_id "1") matches the adapter's own
  // config.defaultBranch, so it's the sensible default here too.
  const WI_BRANCHES = [
    "NSK Trade City, Kuchai Lama", "Chowkit", "Seri Kembangan",
    "Bandar Puteri", "Melawati Mall",
  ];

  // Phase 52 (02-Sep-2026) — real branch names, verified live 02-Sep-2026
  // by fetching jalinanduta.com's homepage and all 3 branch subpages and
  // confirming their CNY/USD rates genuinely differ (see
  // config/websites/jalinanduta.json's branchNotes for the actual
  // numbers). "Bukit Bintang" is first/default because the homepage's own
  // rates match Bukit Bintang's subpage exactly.
  const JD_BRANCHES = ["Bukit Bintang", "Masjid India", "Nu Sentral"];

  // Phase 52 — which BRANCHES list backs each branch-aware source's own
  // dropdown (see renderBranchFields() below). One place to add a 4th
  // branch-aware source later, instead of a new hardcoded if/else.
  const BRANCHES_BY_SOURCE = {
    tajmuhabath: TM_BRANCHES,
    wawasanilham: WI_BRANCHES,
    jalinanduta: JD_BRANCHES,
  };

  // checkboxId added 25-Aug-2026 (bug fix, see loadAlertIntoForm() below): each
  // source's money-changer checkbox <input id>, so state.sources can be
  // rebuilt and every checkbox re-synced by looping over this ONE list
  // instead of a second hand-written copy of "mymoneymaster/tajmuhabath/
  // merchantradeasia/jalinanduta" that has to be remembered and kept in sync
  // by hand every time a source is added — exactly the kind of drift that
  // let loadAlertIntoForm() silently forget about Jalinan Duta when it was
  // added (Phase 24) and never noticed.
  //
  // Phase 49 (29-Aug-2026): each entry's `name` used to be typed here AND,
  // separately, in backend/scheduler/run.js's own SOURCE_DISPLAY_NAMES
  // object — flagged in frontend/currencySupport.js's Phase 48 comment as
  // the same hand-duplication risk, not fixed yet at the time. Both now
  // read from frontend/sourceNames.js's single SOURCE_DISPLAY_NAMES map
  // (loaded here via a <script> tag, immediately before this file) instead
  // of each typing its own copy of the same four names.
  const SOURCES = [
    { id: "mymoneymaster", name: window.CKM_SOURCE_NAMES.SOURCE_DISPLAY_NAMES.mymoneymaster, supportsBranch: false, spreadBias: 0, checkboxId: "srcMMM" },
    { id: "tajmuhabath", name: window.CKM_SOURCE_NAMES.SOURCE_DISPLAY_NAMES.tajmuhabath, supportsBranch: true, spreadBias: 0.06, checkboxId: "srcTM" },
    { id: "merchantradeasia", name: window.CKM_SOURCE_NAMES.SOURCE_DISPLAY_NAMES.merchantradeasia, supportsBranch: false, spreadBias: 0.03, checkboxId: "srcMTA" },
    // Phase 52 (02-Sep-2026): supportsBranch flipped false -> true — real,
    // confirmed-different per-branch rates (see JD_BRANCHES above and
    // config/websites/jalinanduta.json's branchNotes).
    { id: "jalinanduta", name: window.CKM_SOURCE_NAMES.SOURCE_DISPLAY_NAMES.jalinanduta, supportsBranch: true, spreadBias: 0.02, checkboxId: "srcJD" },
    // Phase 52 (02-Sep-2026) — newest real source, unchecked by default,
    // same "opt-in until it's earned some track record" precedent Jalinan
    // Duta itself launched under.
    { id: "wawasanilham", name: window.CKM_SOURCE_NAMES.SOURCE_DISPLAY_NAMES.wawasanilham, supportsBranch: true, spreadBias: 0.04, checkboxId: "srcWI" },
  ];

  const RATE_TYPE_EXPLAINERS = {
    SELL: "You're buying foreign currency with MYR — you want the money changer's SELL rate (what they sell the currency to you for). A lower SELL rate is better for you.",
    BUY: "You're selling foreign currency for MYR — you want the money changer's BUY rate (what they pay you for it). A higher BUY rate is better for you.",
  };

  // Phase 38 (26-Aug-2026) — replaces the old REAL_ADAPTER_SUPPORT
  // allowlist, which required a human to manually run checkRate.js and
  // cross-check each new currency against the live site before it could
  // ever be attempted (the "promotion" ceremony CNY/VND/TWD each went
  // through). Reported: the project owner has already verified all 4
  // registered money changers' real sites directly, repeatedly, and does
  // not want that per-currency ceremony repeated for a currency newly
  // selected at one of these 4 — only for an actual 5th money changer
  // added later.
  //
  // The underlying adapters split into two genuinely different matching
  // strategies, which is what actually decides whether a new currency
  // needs any config at all — Taj Muhabath/Jalinan Duta/My Money Master
  // match a row by its ISO CODE directly (nothing to configure per
  // currency), while Merchantrade Asia matches by the site's own DISPLAY
  // NAME text, which does need an explicit per-currency entry. See
  // frontend/currencySupport.js's own header comment for the full detail
  // on both, including the SGD/USD/JPY denomination-tier decisions and
  // the Phase 42/47 incident history.
  //
  // Phase 48 (29-Aug-2026): CODE_MATCHED_SOURCES and
  // DISPLAY_NAME_MATCHED_CURRENCIES used to be defined right here, with a
  // second, independent copy hand-duplicated in
  // backend/scheduler/comboSelection.js — "kept in sync by hand" per a
  // comment that used to sit where this one now does. That discipline
  // failed twice (Phase 42, Phase 47) without either copy ever raising
  // an error. Both lists now live in exactly one file,
  // frontend/currencySupport.js (loaded via a <script> tag in
  // frontend/index.html, immediately before this file), and this file
  // reads from window.CKM_CURRENCY_SUPPORT instead of defining its own
  // copy — there is no longer a second copy anywhere to drift out of
  // sync with.
  const CODE_MATCHED_SOURCES = new Set(window.CKM_CURRENCY_SUPPORT.CODE_MATCHED_SOURCES);
  const DISPLAY_NAME_MATCHED_CURRENCIES = window.CKM_CURRENCY_SUPPORT.DISPLAY_NAME_MATCHED_CURRENCIES;

  const LIVE_DATA_URL = "data/latest-rates.json";
  const LIVE_DATA_POLL_MS = 60_000; // re-check the static file every minute
  const LIVE_DATA_FRESHNESS_MS = 30 * 60 * 1000; // 30 min — see README for why

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------

  const state = {
    currency: "CNY",
    rateType: "SELL",
    targetRate: 60.5,
    pctChange: 1,
    sources: { mymoneymaster: true, tajmuhabath: true, merchantradeasia: true, jalinanduta: false, wawasanilham: false },
    // Phase 52 (02-Sep-2026): `branch` (a single string) replaced with
    // `branches` — an object keyed by source id, one entry per
    // branch-aware source, since more than one can now be selected on the
    // same alert at once (Taj Muhabath, Wawasan Ilham, Jalinan Duta) and
    // each source's branch names mean nothing to any other source. See
    // database/schema.sql's Phase 52 migration and renderBranchFields()
    // below for the full picture.
    branches: {
      tajmuhabath: TM_BRANCHES[13], // LALAPORT BBCC — the branch the Phase 3 backend job explicitly
      // requests via checkRate.js (see .github/workflows/pages.yml). NOT the page's own
      // natural default when no branch is selected (that's "THE EXCHANGE TRX", confirmed
      // live during the Phase 3 build) — LALAPORT BBCC was chosen here specifically to
      // exercise the branch-selection code path in backend/scrapers/tajmuhabath.adapter.js.
      wawasanilham: WI_BRANCHES[0], // NSK Trade City, Kuchai Lama — matches config.defaultBranch
      jalinanduta: JD_BRANCHES[0], // Bukit Bintang — matches the homepage's own default numbers
    },
    condition: "AT_OR_BELOW",
    interval: 5,
    // Phase 11 — an object of booleans, not one selected value: any
    // combination of channels may be checked at once, and all of them fire
    // simultaneously when the target is reached (see fireAlert() below and
    // backend/scheduler/run.js's resolveNotifyTargets()/Promise.all for the
    // server-side equivalent). browser has no checkbox in the UI (Phase 11.1)
    // — it always fires automatically whenever this tab is open and
    // monitoring, so it stays true unconditionally rather than being read
    // from a form field. email now defaults to checked (Phase 11.1); the
    // user must still add RESEND_API_KEY (see NOTIFICATIONS_SETUP.md) and be
    // signed in for it to actually deliver.
    notifications: { browser: true, email: true, telegram: false, push: false },
    telegramChatId: "", // Phase 10 — only meaningful when notifications.telegram is true
    pushSubscription: null, // Phase 39 — the browser's PushSubscription (as JSON), set by
                             // frontend/push.js once subscribe() succeeds; only meaningful
                             // when notifications.push is true. Written via the SAME state
                             // object push.js reads through window.CKM.getState() — see
                             // that file's own header comment for why no extra plumbing
                             // is needed to get it into saveCurrentAlert()'s row.

    monitoring: false,
    triggered: false,
    forcedMode: null, // null | "TRIGGER" | "SOURCE_DOWN" | "VALIDATION_ERROR"

    // Phase 15 bug fix (23-Aug-2026) — true the moment the user has
    // actually typed/clicked into any of this form's own fields this page
    // load (see the on(...) handlers in wireForm() below, each of which
    // sets this true). auth.js's loadMyAlerts() checks this: as long as
    // it's still false, it's safe to silently load the signed-in user's
    // most recent saved alert into this form so the hero card reflects
    // real saved data instead of sitting on the hardcoded demo default
    // forever — see that function's own comment for the bug this fixes.
    // The moment the user touches anything, this flips true and that
    // auto-sync stops, so it never clobbers an in-progress edit.
    userEditedForm: false,

    walk: {}, // per source+currency running mock value, seeded lazily
    // (DEFAULT_ALERT_ROW below is derived from the state values above,
    // captured once, before wireForm()/loadAlertIntoForm() can ever change
    // them — see that constant's own comment.)
    history: [], // { t: Date, value: number } for the currently selected series
    log: [],

    liveData: { generatedAt: null, results: [] }, // from data/latest-rates.json
    liveDataFetchFailed: false,
  };

  // Phase 15 bug fix (23-Aug-2026), part 2 — a "row" shaped exactly like a
  // real Supabase alerts row, but built from the plain demo defaults just
  // above (captured here, once, before anything can mutate them). Lets
  // auth.js reset the form/hero back to a neutral, honest starting point by
  // calling window.CKM.loadAlertIntoForm(DEFAULT_ALERT_ROW) — the exact
  // same function/DOM-sync path "Edit" already uses — for the case where a
  // signed-in user's saved alerts count drops to zero (e.g. they delete
  // their only alert) while they haven't touched the form themselves. Without
  // this, the hero card would keep silently showing that now-deleted
  // alert's stale numbers forever, indistinguishable from a real, current
  // alert — the same category of bug as the original hero/saved-alert
  // mismatch, just triggered by a delete instead of a fresh sign-in.
  const DEFAULT_ALERT_ROW = {
    currency: state.currency,
    rate_type: state.rateType,
    target_rate: state.targetRate,
    sources: Object.keys(state.sources).filter((k) => state.sources[k]),
    branches: { ...state.branches }, // Phase 52 — snapshot, not a live reference
    condition: state.condition,
    pct_change_threshold: state.pctChange,
    monitoring_interval_minutes: state.interval,
    notification_methods: Object.keys(state.notifications).filter((k) => state.notifications[k]),
    telegram_chat_id: state.telegramChatId,
    push_subscription: state.pushSubscription,
  };

  const $ = (id) => document.getElementById(id);
  // Safe listener-binding helper (Phase 11.2). $("id").addEventListener(...)
  // throws a TypeError if "id" doesn't exist in the DOM, and because
  // wireForm() below runs as one long synchronous list of these calls, a
  // single missing/renamed id silently kills every listener AFTER it in the
  // list too — exactly what happened when the Browser-notification checkbox
  // was removed from index.html (Phase 11.1) but an old cached copy of this
  // file (or vice versa) still expected it: the throw on that one line meant
  // notifTelegram's own listener a few lines down never got attached, so
  // checking Telegram silently did nothing. on() logs a console warning and
  // skips that one binding instead of aborting the rest of the form.
  const on = (id, event, handler) => {
    const el = $(id);
    if (!el) {
      console.warn(`[wireForm] #${id} not found in the page — its "${event}" listener was skipped. This usually means index.html and app.js are out of sync (e.g. a stale cached copy of one of them) — hard-refresh (Ctrl/Cmd+Shift+R) and confirm both files are the latest pushed version.`);
      return;
    }
    el.addEventListener(event, handler);
  };

  // ---------------------------------------------------------------------
  // Phase 7 integration bridge
  // ---------------------------------------------------------------------
  // frontend/auth.js (loaded after this file) wires the dashboard to
  // Supabase for per-user saved alerts. Rather than reaching into this
  // IIFE's closed-over `state` directly, auth.js reads it through this
  // tiny, deliberately narrow public surface, and sets the hook callbacks
  // below to learn about events it cares about (a target being reached,
  // monitoring starting/resetting) without this file needing to know
  // Supabase exists at all. Every hook call is wrapped in try/catch so a
  // Phase 7 failure (e.g. not signed in, network error) can never break
  // the Phase 1-6 behavior this file is responsible for.
  window.CKM = window.CKM || {};
  window.CKM.getState = () => state;
  window.CKM.onAlertTriggered = null; // (reading, value) => void
  window.CKM.onMonitoringStarted = null; // () => void
  window.CKM.onAlertReset = null; // () => void
  // Phase 18 — fires whenever state.currency changes for ANY reason (the
  // currency <select>, loadAlertIntoForm, resetFormToDefaults), not just
  // when a saved-currency chip was clicked. Lets auth.js's chip row keep
  // its aria-pressed highlighting correct even when the user switches
  // currency the "old" way, via the form dropdown, instead of via a chip.
  window.CKM.onCurrencyChanged = null; // () => void
  // Phase 10 — frontend/rateHistory.js sets this to a function that draws a
  // REAL, Supabase-backed history chart (signed-in users only — see that
  // file's own header comment) and returns true when it did. renderChart()
  // below always checks this first; when it's unset or returns false (not
  // signed in, or Supabase isn't configured), renderChart() falls back to
  // its own default in-session chart — see renderDefaultChart, exposed
  // below the function so rateHistory.js can also explicitly restore that
  // default the moment a user signs out.
  window.CKM.renderRealHistory = null; // (canvas) => boolean
  // Lets rateHistory.js explicitly restore the default in-session chart the
  // moment a user signs out, rather than waiting for the next tick()/resize/
  // range-click to notice renderRealHistory now returns false. Safe to
  // reference renderSimulatedChart here even though it's declared further
  // down this file — function declarations are hoisted, so it already
  // exists by the time this line runs.
  window.CKM.renderDefaultChart = renderSimulatedChart;

  // Phase 18 — lets auth.js's saved-currency chips show a full, unit-aware
  // name (e.g. "Vietnamese Dong (per 1,000,000)") as a hover tooltip on a
  // compact "VND" chip, without duplicating the CURRENCIES list in a
  // second file. Falls back to the bare code for anything not in the list.
  window.CKM.getCurrencyName = (code) => (CURRENCIES.find((c) => c.code === code) || {}).name || code;
  // Phase 18 — same bridge pattern as the rest of this section: lets
  // auth.js reuse this file's one toast implementation (see showToast()
  // below) instead of building a second one, e.g. to warn before a saved-
  // currency chip click overwrites unsaved edits in the form.
  window.CKM.showToast = (msg) => showToast(msg);
  // Phase 25 (25-Aug-2026) bug fix — lets auth.js's describeAlert() attach
  // a saved alert's branch to the SPECIFIC source that actually has one,
  // reading it from SOURCES' own supportsBranch field (the same source of
  // truth backend/scheduler/comboSelection.js was fixed to read from
  // config/websites/*.json's branchSupport, this session) instead of
  // hardcoding 'tajmuhabath' a 3rd time in a completely different file.
  window.CKM.getBranchSupportedSourceIds = () => SOURCES.filter((s) => s.supportsBranch).map((s) => s.id);
  // Phase 52 (02-Sep-2026) — order-independent equality for two
  // {sourceId: branchName} maps, used everywhere a "does this saved
  // alert's branch selection match the current form/hero" check used to
  // just compare two single `branch` strings (auth.js's
  // getAlertDisplayReading() and resolveLoadedAlertId()). null/undefined
  // and a missing key are treated the same, matching how `branch || null`
  // already normalized a single value before this phase.
  window.CKM.branchesEqual = (a, b) => {
    const ka = Object.keys(a || {}).filter((k) => (a[k] ?? null) !== null);
    const kb = Object.keys(b || {}).filter((k) => (b[k] ?? null) !== null);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => (a[k] ?? null) === ((b || {})[k] ?? null));
  };
  // Phase 25 (25-Aug-2026) bug fix — found while fixing the branch-mislabel
  // bug above: auth.js kept its OWN hardcoded copy of source display names
  // (SOURCE_LABELS), which was never updated when merchantradeasia (Phase
  // 14) or jalinanduta (Phase 24) were added — both showed up as raw
  // lowercase ids in "My saved alerts" ("...+ merchantradeasia +
  // jalinanduta" instead of "...+ Merchantrade Asia + Jalinan Duta"),
  // visible in the very screenshot that reported the branch bug. Same root
  // cause as that bug: a second hardcoded list that had to independently
  // stay in sync with SOURCES and quietly didn't. Exposing this bridge
  // instead lets auth.js stop keeping its own copy at all.
  window.CKM.getSourceName = (id) => (SOURCES.find((s) => s.id === id) || {}).name || id;
  // Phase 22 — lets auth.js re-render the Activity Log's empty-state text
  // (see renderActivityLog() below) the moment sign-in state or the saved-
  // alerts list changes, rather than that text sitting stale until the
  // next unrelated log entry — see that function's own comment for why
  // this needed fixing at all.
  window.CKM.renderActivityLog = () => renderActivityLog();

  // Phase 13 — lets auth.js's new "Edit" button on a saved alert push that
  // alert's saved settings back into this form (currency, rate type, target,
  // sources, branch, condition, interval, notification methods, Telegram
  // chat ID), so the user can change them and save over the SAME alert
  // instead of only ever being able to Disable/Delete and start over. Both
  // updates the closed-over `state` this file's own tick()/startMonitoring()
  // read AND writes the visible form controls directly — updating state
  // alone would leave the on-screen selects/checkboxes showing stale values
  // until the user happened to touch each one.
  window.CKM.loadAlertIntoForm = function (row) {
    if (!row) return;

    state.currency = row.currency;
    if ($("currency")) $("currency").value = row.currency;
    state.history = [];
    lastSelectedValue = null;
    // Phase 35 (26-Aug-2026) bug fix: reported — switching between saved
    // currencies via the comparison-table chips (JPY → VND → CNY) kept
    // showing "🔴 REACHED" on My Money Master's row even when its own
    // SELL rate was clearly sitting ABOVE that currency's target (e.g.
    // VND: SELL 154.30 vs target 153.50 — should read WAITING, exactly
    // like Taj Muhabath's row right below it with an almost identical
    // rate). Root cause: state.triggered and state.forcedMode are BOTH
    // single, page-wide flags — set once by startMonitoring()/the hidden
    // test panel's "Force trigger" button and never cleared again until
    // "Reset alert" is clicked — but renderCompareTable()'s REACHED badge
    // (app.js line ~1016) and renderHero()'s pill both read state.triggered
    // directly with no idea it might describe a DIFFERENT currency's alert
    // than the one currently on screen. Every other per-row field this
    // function loads (currency, target, condition, sources...) already
    // gets freshly overwritten from `row` on every call — these two didn't,
    // so they silently kept whatever a previously-viewed/tested alert had
    // left behind. Worse than a cosmetic mislabel: while state.triggered
    // stays incorrectly true, tick()'s own `met && !state.triggered` guard
    // (line ~919) would also SUPPRESS a genuinely new trigger for the
    // now-active alert, since it looks like one already fired.
    // Fixed by syncing both from this row instead of leaving them stale:
    // state.triggered now mirrors the row's own real status (the same
    // per-alert "TRIGGERED" the backend scheduler and auth.js's own
    // updateAlertStatus() already write to Supabase — see auth.js's
    // alerts.status column), so a chip switch shows this alert's actual
    // state, not whichever alert was looked at last. row.status is
    // undefined for DEFAULT_ALERT_ROW (resetFormToDefaults()'s plain demo
    // object has no such field), which correctly resolves to false there.
    state.triggered = row.status === "TRIGGERED";
    state.forcedMode = null;

    // Bug fix (26-Aug-2026, reported): a saved, signed-in alert required a
    // manual "Start monitoring" click in THIS TAB before it would even be
    // locally tracked/displayed as live or fire the in-tab browser
    // notification — even though the real, authoritative monitoring (the
    // backend's every-5-minute scheduled check, which is what actually
    // evaluates the target and sends email/Telegram/push) has been running
    // the whole time regardless of any button here. That's backwards from
    // the user's own expectation and from how this app is described
    // everywhere else: a saved ACTIVE/TRIGGERED alert is already being
    // watched, full stop — this tab shouldn't need a separate "did you also
    // press a button" condition layered on top just to keep up locally.
    // Auto-engage local monitoring the instant a REAL saved alert loads —
    // row.id only ever exists on an actual Supabase row; DEFAULT_ALERT_ROW
    // (the signed-out/no-saved-alerts demo state resetFormToDefaults()
    // uses) never has one, so that quick/unsaved-alert flow still requires
    // its own explicit "Start monitoring" click, unchanged.
    //
    // Deliberately NOT calling startMonitoring() itself here: that function
    // also resets state.triggered/state.history/lastSelectedValue to a
    // fresh start, which would either wipe the real TRIGGERED state just
    // set two lines above back to "waiting" (a worse bug than this one) or
    // cause an immediate spurious re-fire of the in-tab notification on
    // every single page load/reload for an alert that's already past
    // target. Only state.monitoring itself, plus the button's own label, are
    // set here — everything else this row needs was already synced above.
    if (row.id != null) {
      state.monitoring = true;
      if ($("startBtn")) {
        $("startBtn").textContent = "✓ Monitoring active";
        $("startBtn").dataset.active = "true";
      }
    }

    callHook("onCurrencyChanged");
    loadSupabaseRates(); // Phase 20 — don't wait out the poll interval after a currency switch

    state.rateType = row.rate_type;
    document.querySelectorAll("#rateTypeSeg button").forEach((b) => {
      b.setAttribute("aria-pressed", b.dataset.value === row.rate_type ? "true" : "false");
    });
    if ($("rateTypeHint")) $("rateTypeHint").textContent = RATE_TYPE_EXPLAINERS[state.rateType] || "";

    const cur = CURRENCIES.find((c) => c.code === row.currency);
    const decimals = cur ? cur.decimals : 4;
    const target = Number(row.target_rate);
    if (Number.isFinite(target) && target > 0) {
      state.targetRate = target;
      if ($("targetRate")) $("targetRate").value = target.toFixed(decimals);
    }

    // Bug fix (25-Aug-2026): this used to be a hand-written object literal
    // listing only mymoneymaster/tajmuhabath/merchantradeasia, plus a 4th
    // "if ($('srcJD'))..." line bolted on separately when Jalinan Duta was
    // added (Phase 24) — but the object literal itself was never updated to
    // include it. Every saved alert's real jalinanduta selection was
    // therefore silently discarded here: state.sources.jalinanduta ended up
    // undefined regardless of what row.sources actually said, and the
    // checkbox always unchecked itself. Looping over SOURCES (this file's
    // one canonical source list, checkboxId included) instead of a second
    // hardcoded copy means a 5th source added later can't repeat this same
    // bug — there is no second list left to forget.
    const sourceList = Array.isArray(row.sources) ? row.sources : [];
    state.sources = {};
    SOURCES.forEach((s) => {
      const selected = sourceList.includes(s.id);
      state.sources[s.id] = selected;
      if ($(s.checkboxId)) $(s.checkboxId).checked = selected;
    });
    // Phase 52 — row.branches is a per-source map; fall back to the legacy
    // singular row.branch (a pre-migration row, or a frontend that shipped
    // before database/schema.sql's Phase 52 migration ran) by treating it
    // as Taj Muhabath's own branch, the only source a bare `branch` value
    // could ever have meant.
    const incomingBranches = row.branches && typeof row.branches === "object" && !Array.isArray(row.branches)
      ? row.branches
      : (row.branch ? { tajmuhabath: row.branch } : {});
    Object.keys(incomingBranches).forEach((sourceId) => {
      if (incomingBranches[sourceId] != null) state.branches[sourceId] = incomingBranches[sourceId];
    });
    renderBranchFields(); // must run after state.sources/state.branches are both set above

    state.condition = row.condition || state.condition;
    if ($("condition")) $("condition").value = state.condition;
    if ($("pctChangeField")) $("pctChangeField").style.display = state.condition === "PCT_CHANGE" ? "block" : "none";
    if (state.condition === "PCT_CHANGE" && row.pct_change_threshold != null) {
      const pct = Number(row.pct_change_threshold);
      if (Number.isFinite(pct) && pct > 0) {
        state.pctChange = pct;
        if ($("pctChange")) $("pctChange").value = pct;
      }
    }

    if (row.monitoring_interval_minutes) {
      state.interval = row.monitoring_interval_minutes;
      if ($("interval")) $("interval").value = String(state.interval);
    }

    // browser stays permanently on (Phase 11.1 — no checkbox for it); only
    // email/telegram/push reflect what this saved alert actually had checked.
    const methods = Array.isArray(row.notification_methods)
      ? row.notification_methods
      : (row.notification_method ? [row.notification_method] : ["browser"]);
    state.notifications.email = methods.includes("email");
    state.notifications.telegram = methods.includes("telegram");
    if ($("notifEmail")) $("notifEmail").checked = state.notifications.email;
    if ($("notifTelegram")) $("notifTelegram").checked = state.notifications.telegram;
    if ($("telegramChatIdField")) $("telegramChatIdField").style.display = state.notifications.telegram ? "block" : "none";

    state.telegramChatId = row.telegram_chat_id || "";
    if ($("telegramChatId")) $("telegramChatId").value = state.telegramChatId;

    // Phase 39 — Push restores exactly like telegram_chat_id just above:
    // trust whatever this saved alert's own row already has, rather than
    // requiring a fresh PushManager.subscribe() call every time an
    // unrelated field (target rate, interval, etc.) gets edited and saved.
    // Bug caught before shipping this: an earlier version of this comment
    // deliberately left state.pushSubscription untouched on restore,
    // reasoning that only a live subscribe() should ever set it — but
    // setting a checkbox's `.checked` property directly does not fire a
    // "change" event, so frontend/push.js's own listener (which is what
    // would normally populate state.pushSubscription) never ran, and
    // saveCurrentAlert()'s "push selected but no subscription" guard then
    // incorrectly blocked saving an edit to an alert that was already a
    // perfectly valid, previously-subscribed Push alert. Restoring the
    // stored value directly here — same as every other field on this
    // form — fixes that: editing and re-saving no longer requires
    // re-subscribing, and a user who genuinely wants to move Push to a
    // different device still can, by unchecking and re-checking the box
    // (which DOES fire "change", and DOES call subscribe() for real).
    state.notifications.push = methods.includes("push");
    if ($("notifPush")) $("notifPush").checked = state.notifications.push;
    state.pushSubscription = row.push_subscription || null;

    // Bug fix (23-Aug-2026), found while testing the fix above: everything
    // up to this point updates `state` and the plain form INPUT controls
    // correctly and instantly, but the hero card / compare table / chart
    // are all rendered by tick(), which otherwise only runs once every 4
    // seconds (setInterval in init()) or when the user explicitly interacts
    // with monitoring. Without this call, a caller of loadAlertIntoForm —
    // including the pre-existing "Edit" button, not just the new auto-sync
    // above — could show the OLD hero numbers for up to ~4 seconds after
    // the form/state have already switched to a different alert. tick() is
    // safe to call here: it's a pure re-render unless state.monitoring is
    // already true (never set by this function), so it can't spuriously
    // fire an alert or log activity for a user who hasn't clicked "Start
    // monitoring".
    tick();
  };

  // Phase 15 bug fix (23-Aug-2026), part 2 — see DEFAULT_ALERT_ROW's own
  // comment above. Reuses loadAlertIntoForm's exact DOM-sync logic, just
  // with the plain demo defaults instead of a real saved row, so "reset to
  // a neutral state" and "load a specific alert" can never drift apart
  // into two subtly different code paths.
  window.CKM.resetFormToDefaults = function () {
    window.CKM.loadAlertIntoForm(DEFAULT_ALERT_ROW);
  };

  function callHook(name, ...args) {
    const fn = window.CKM && window.CKM[name];
    if (typeof fn !== "function") return;
    try { fn(...args); } catch (err) { /* a Phase 7 hook must never break core monitoring */ }
  }

  // ---------------------------------------------------------------------
  // Real live data — two sources, checked in priority order.
  //
  // Phase 20 (24-Aug-2026) bug fix: through Phase 19, this file only ever
  // read data/latest-rates.json, a static snapshot regenerated ONCE per
  // deploy by .github/workflows/pages.yml — completely disconnected from
  // backend/scheduler/run.js, which has separately been writing a fresh
  // reading to Supabase's `rates` table every 5 minutes since Phase 14
  // (.github/workflows/monitor.yml), independent of any deploy. Reported
  // 24-Aug-2026: CNY showing STALE/UNAVAILABLE across all 3 real sources
  // on the dashboard despite the backend having checked successfully many
  // times since the last deploy — the real, fresh data was sitting in
  // Supabase the whole time, just never read by this file.
  //
  // Fix: query `rates` directly (loadSupabaseRates() below), polled at the
  // same LIVE_DATA_POLL_MS cadence as the old static-file path — plenty
  // fast relative to the backend's own 5-minute write cadence, so this
  // frontend poll is never the bottleneck. The static-file path is NOT
  // removed: it's the automatic fallback for a source+currency combo with
  // no `rates` row at all, or if Supabase is unreachable/misconfigured —
  // matching the "fails soft, never fake LIVE" pattern already used
  // throughout this file and rateHistory.js's real-history chart.
  //
  // Unlike rateHistory.js's chart (deliberately signed-in-only, per that
  // file's own comment), this read is meant to work for signed-out
  // visitors too — the project brief requires the dashboard itself to be
  // publicly accessible — so it needs `rates`' SELECT policy to allow
  // `public`, not just `authenticated`; see database/schema.sql and
  // RUN_THIS_IN_SUPABASE.sql for that one-time migration. Before that
  // migration is applied, every query below simply fails (RLS denies
  // anon), gets caught, and falls back to the static-file path — so this
  // code is safe to deploy in either order relative to the SQL step.
  //
  // Phase 21 (24-Aug-2026) follow-up: Phase 20 scoped the cache to ONLY
  // whichever currency was currently active in the form/comparison table.
  // That correctly fixed the reported bug (the active currency's
  // comparison table and its OWN hero row), but left every OTHER row in
  // "My saved alerts" — a currency you have a saved alert for but aren't
  // currently viewing — still falling back to the old, deploy-time-only
  // static JSON, since computeAlertReading() (used only for those other
  // rows; see auth.js's getAlertDisplayReading()) calls getReading() with
  // THAT alert's own currency, not necessarily the active one.
  //
  // Fix: `watchedCurrencies` below is a set of extra currencies to keep
  // fresh alongside the active one — auth.js populates it via
  // window.CKM.setWatchedCurrencies() with every distinct currency across
  // the signed-in user's saved alerts (getSavedCurrencies(), the same
  // Phase 18 helper the saved-currency chips already use), refreshed at
  // the exact same points myAlertsCache itself refreshes so the two can
  // never drift apart. The cache itself is now keyed by currency (a Map)
  // instead of a single {currency, rows} pair, so multiple currencies'
  // rows can be held fresh simultaneously without one query's results
  // overwriting another's.
  // ---------------------------------------------------------------------

  function hasRealAdapter(sourceId, currencyCode) {
    if (CODE_MATCHED_SOURCES.has(sourceId)) return true;
    const supported = DISPLAY_NAME_MATCHED_CURRENCIES[sourceId];
    return Array.isArray(supported) && supported.includes(currencyCode);
  }

  let sbRatesClient = null;
  // currency code -> { rows, failed } — see this section's Phase 21 note.
  const supabaseRatesCache = new Map();
  // Extra currencies (beyond whichever is currently active) to keep
  // fresh — set by auth.js via window.CKM.setWatchedCurrencies() below.
  let watchedCurrencies = [];

  window.CKM.setWatchedCurrencies = function (codes) {
    watchedCurrencies = Array.isArray(codes) ? codes.filter(Boolean) : [];
    loadSupabaseRates(); // refresh immediately with the new set, don't wait for the poll
  };

  function supabaseConfigured() {
    return (
      typeof window.CKM_SUPABASE_URL === "string" && window.CKM_SUPABASE_URL &&
      window.CKM_SUPABASE_URL !== "YOUR_SUPABASE_PROJECT_URL" &&
      typeof window.CKM_SUPABASE_ANON_KEY === "string" && window.CKM_SUPABASE_ANON_KEY &&
      window.CKM_SUPABASE_ANON_KEY !== "YOUR_SUPABASE_ANON_KEY" &&
      typeof window.supabase !== "undefined" && typeof window.supabase.createClient === "function"
    );
  }

  /** One query per currency in play (the active one + every watched one),
   *  run in parallel, each written into its own slot in supabaseRatesCache
   *  — so a slow/failed query for one currency can never block or
   *  overwrite another's already-fresh data. A currency switch or a
   *  myAlertsCache refresh calls this again immediately (see the two call
   *  sites below and setWatchedCurrencies() above) rather than waiting out
   *  the poll interval. */
  async function loadSupabaseRates() {
    if (!supabaseConfigured()) return;
    if (!sbRatesClient) sbRatesClient = window.supabase.createClient(window.CKM_SUPABASE_URL, window.CKM_SUPABASE_ANON_KEY);

    const currencies = Array.from(new Set([state.currency, ...watchedCurrencies]));

    await Promise.all(currencies.map(async (code) => {
      try {
        // limit(40) comfortably covers every source+branch combo that
        // could exist for one currency today (3 sources, at most one
        // branched) with headroom for more being added later (see
        // config/websites/).
        const { data, error } = await sbRatesClient
          .from("rates")
          .select("source, branch, currency, buy_rate, sell_rate, retrieved_at, source_timestamp, status, validation_status, error_message, created_at")
          .eq("currency", code)
          .order("created_at", { ascending: false })
          .limit(40);
        if (error) throw error;
        supabaseRatesCache.set(code, { rows: data || [], failed: false });
      } catch (err) {
        // Covers RLS denying anon before RUN_THIS_IN_SUPABASE.sql has been
        // run, a network error, or Supabase being down — any of these is a
        // real reason to fall back to the static-file path below, not to
        // pretend nothing's wrong.
        supabaseRatesCache.set(code, { rows: [], failed: true });
      }
    }));
    tick();
    // Phase 28 (26-Aug-2026) fix — see renderActivityLog()'s own comment:
    // the Activity Log now shows real rows from this same cache for a
    // signed-in user with saved alerts, so it needs to re-render every time
    // fresh rows arrive here (initial load, the 60s poll, a currency
    // switch, or setWatchedCurrencies() firing early) — not just wait for
    // an unrelated tick()/logActivity() call to happen to touch it next.
    renderActivityLog();
  }

  /** Latest row for this exact source+branch, from that currency's slot in
   *  the cache above. One row per source+branch, since the query already
   *  ordered newest-first and this takes the first match — null if
   *  nothing's ever been checked for this combo, or this currency hasn't
   *  been fetched yet (a fresh loadSupabaseRates() call is already in
   *  flight after any currency switch or watch-list change). */
  function findSupabaseResult(sourceId, currencyCode, branch) {
    const cached = supabaseRatesCache.get(currencyCode);
    if (!cached) return null;
    return cached.rows.find((r) =>
      r.source === sourceId && (r.branch || null) === (branch || null)
    ) || null;
  }

  async function loadLiveData() {
    try {
      const res = await fetch(LIVE_DATA_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      state.liveData = { generatedAt: data.generatedAt || null, results: Array.isArray(data.results) ? data.results : [] };
      state.liveDataFetchFailed = false;
    } catch (err) {
      // Fetch itself failing (404 before the first workflow run, network
      // error, malformed JSON) is a real, honest SOURCE_UNAVAILABLE
      // condition for every real-adapter source — never silently ignored.
      state.liveDataFetchFailed = true;
    }
    tick();
  }

  function findLiveResult(sourceId, currencyCode, branch) {
    return state.liveData.results.find((r) =>
      r.source === sourceId && r.currency === currencyCode && (r.branch || null) === (branch || null)
    );
  }

  /**
   * Shared by both the Supabase path and the static-JSON path below: given
   * an entry already normalized to {status, buyRate, sellRate, retrievedAt
   * (Date|null), sourceTimestamp, validationStatus, errorMessage}, applies
   * the exact same freshness recheck either source needs — a row written
   * as `status: 'LIVE'` five minutes ago by the backend is still honestly
   * LIVE right now, but the same row read three hours from now, with no
   * newer one behind it, must be recomputed as STALE at READ time, not
   * trusted at its original write-time status forever. Never upgrades a
   * stale or failed check to look LIVE — the false-freshness bug the
   * project's Error Handling section warns against.
   */
  function buildRealReadingFromEntry(base, entry, now) {
    if (entry.status !== "LIVE") {
      // Pass through whatever was actually recorded (EXTRACTION_ERROR,
      // RATE_VALIDATION_ERROR, SOURCE_UNAVAILABLE) rather than reinterpreting it.
      return { ...base, buyRate: entry.buyRate ?? null, sellRate: entry.sellRate ?? null,
        retrievedAt: entry.retrievedAt, sourceTimestamp: entry.sourceTimestamp || null,
        status: entry.status, validationStatus: entry.validationStatus,
        errorMessage: entry.errorMessage };
    }

    const ageMs = entry.retrievedAt ? now.getTime() - entry.retrievedAt.getTime() : Infinity;
    if (ageMs > LIVE_DATA_FRESHNESS_MS) {
      return { ...base, buyRate: entry.buyRate, sellRate: entry.sellRate,
        retrievedAt: entry.retrievedAt, sourceTimestamp: entry.sourceTimestamp || null,
        status: "STALE", validationStatus: entry.validationStatus,
        errorMessage: `Last successful check was ${Math.round(ageMs / 60000)} min ago (freshness window is ${LIVE_DATA_FRESHNESS_MS / 60000} min).` };
    }

    return { ...base, buyRate: entry.buyRate, sellRate: entry.sellRate,
      retrievedAt: entry.retrievedAt, sourceTimestamp: entry.sourceTimestamp || null,
      status: "LIVE", validationStatus: entry.validationStatus };
  }

  /**
   * Real counterpart to simulateReading(): builds a StandardRateResult-
   * shaped reading from live data instead of the random walk. Checks
   * Supabase's `rates` table first (fresh as of the backend's last 5-
   * minute run — see this section's header comment), falling back to
   * data/latest-rates.json (fresh as of the last deploy) only when no
   * Supabase row exists for this combo yet, or Supabase couldn't be
   * reached at all.
   *
   * Phase 16 (23-Aug-2026): `currencyCode` is now an explicit parameter
   * (defaulting to `state.currency`, so every existing call site behaves
   * exactly as before) rather than always reading `state.currency` — this
   * lets computeAlertReading() below compute a reading for a saved alert
   * whose currency differs from whatever is currently loaded in the form.
   */
  function getRealReading(sourceId, branch, currencyCode = state.currency) {
    const now = new Date();
    const base = { source: sourceId, branch: branch || null, currency: currencyCode, origin: "REAL" };

    const sbRow = findSupabaseResult(sourceId, currencyCode, branch);
    if (sbRow) {
      return buildRealReadingFromEntry(base, {
        status: sbRow.status,
        buyRate: sbRow.buy_rate,
        sellRate: sbRow.sell_rate,
        retrievedAt: sbRow.retrieved_at ? new Date(sbRow.retrieved_at) : null,
        sourceTimestamp: sbRow.source_timestamp || null,
        validationStatus: sbRow.validation_status,
        errorMessage: sbRow.error_message,
      }, now);
    }

    if (state.liveDataFetchFailed) {
      return { ...base, buyRate: null, sellRate: null, retrievedAt: null, sourceTimestamp: null,
        status: "SOURCE_UNAVAILABLE", validationStatus: "NOT_RUN",
        errorMessage: `Could not load ${LIVE_DATA_URL} — the site may not have completed its first deploy yet.` };
    }

    const entry = findLiveResult(sourceId, currencyCode, branch);
    if (!entry) {
      return { ...base, buyRate: null, sellRate: null, retrievedAt: null, sourceTimestamp: null,
        status: "SOURCE_UNAVAILABLE", validationStatus: "NOT_RUN",
        errorMessage: "No live check has completed for this currency yet." };
    }

    return buildRealReadingFromEntry(base, {
      status: entry.status,
      buyRate: entry.buyRate,
      sellRate: entry.sellRate,
      retrievedAt: entry.retrievedAt ? new Date(entry.retrievedAt) : null,
      sourceTimestamp: entry.sourceTimestamp || null,
      validationStatus: entry.validationStatus,
      errorMessage: entry.errorMessage,
    }, now);
  }

  /** Dispatcher: real reading if this source+currency has a real adapter, simulated otherwise.
   *  Phase 16: currencyCode is optional, defaulting to state.currency. */
  function getReading(sourceId, branch, currencyCode = state.currency) {
    return hasRealAdapter(sourceId, currencyCode)
      ? getRealReading(sourceId, branch, currencyCode)
      : simulateReading(sourceId, branch, currencyCode);
  }

  // ---------------------------------------------------------------------
  // Mock rate simulation (clearly separated from everything else)
  // ---------------------------------------------------------------------

  function walkKey(sourceId, branch, currencyCode = state.currency) {
    return `${sourceId}::${currencyCode}::${branch || ""}`;
  }

  function seedWalk(sourceId, branch, currencyCode = state.currency) {
    const cur = CURRENCIES.find((c) => c.code === currencyCode);
    const src = SOURCES.find((s) => s.id === sourceId);
    const key = walkKey(sourceId, branch, currencyCode);
    if (!state.walk[key]) {
      const branchJitter = branch ? (hashString(branch) % 40) / 1000 : 0; // small per-branch offset
      state.walk[key] = cur.base + src.spreadBias + branchJitter;
    }
    return state.walk[key];
  }

  function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h;
  }

  function stepWalk(sourceId, branch, currencyCode = state.currency) {
    const key = walkKey(sourceId, branch, currencyCode);
    const current = seedWalk(sourceId, branch, currencyCode);
    const drift = (Math.random() - 0.5) * 0.06;
    const next = Math.max(0.01, current + drift);
    state.walk[key] = next;
    return next;
  }

  /**
   * Produces one simulated reading for a source (+branch). Shape mirrors
   * the real StandardRateResult contract in
   * backend/scrapers/rateAdapter.interface.js on purpose, so swapping this
   * out for a real backend call in Phase 2/3 is a drop-in change.
   *
   * Phase 16 (23-Aug-2026): `currencyCode` is now an explicit parameter
   * (defaulting to `state.currency`) for the same reason as
   * getRealReading() above — see that function's comment. `state.forcedMode`
   * (the ?debug=1 test-controls panel) intentionally still applies
   * regardless of currencyCode: it's a manual override for whatever is
   * currently being demoed, and a tester flipping it on expects every
   * reading on screen — including other saved alerts' own live-rate display
   * — to reflect it, not just the currently loaded alert.
   */
  function simulateReading(sourceId, branch, currencyCode = state.currency) {
    const now = new Date();
    const src = SOURCES.find((s) => s.id === sourceId);

    if (state.forcedMode === "SOURCE_DOWN") {
      return { source: sourceId, branch: branch || null, currency: currencyCode, origin: "SIMULATED",
        buyRate: null, sellRate: null, retrievedAt: now, sourceTimestamp: null,
        status: "SOURCE_UNAVAILABLE", validationStatus: "NOT_RUN" };
    }
    if (state.forcedMode === "VALIDATION_ERROR") {
      // deliberately return an out-of-range value, e.g. missing the /100 unit scale
      const bad = seedWalk(sourceId, branch, currencyCode) / 100;
      return { source: sourceId, branch: branch || null, currency: currencyCode, origin: "SIMULATED",
        buyRate: bad, sellRate: bad, retrievedAt: now, sourceTimestamp: now,
        status: "RATE_VALIDATION_ERROR", validationStatus: "FAILED" };
    }

    const sellBase = stepWalk(sourceId, branch, currencyCode);
    const spread = 0.28 + (src.spreadBias * 0.5);
    const sellRate = round(sellBase, decimalsFor(currencyCode));
    const buyRate = round(sellBase - spread, decimalsFor(currencyCode));

    return {
      source: sourceId, branch: branch || null, currency: currencyCode, origin: "SIMULATED",
      buyRate, sellRate, retrievedAt: now, sourceTimestamp: now,
      status: "SIMULATED", validationStatus: "PASSED",
    };
  }

  function decimalsFor(code) {
    return (CURRENCIES.find((c) => c.code === code) || {}).decimals ?? 2;
  }
  function round(n, d) { const f = 10 ** d; return Math.round(n * f) / f; }

  // ---------------------------------------------------------------------
  // Validation (real logic — see backend/validation/validateRate.js for the
  // eventual server-side twin of this; kept intentionally simple here)
  // ---------------------------------------------------------------------

  // Phase 16 (23-Aug-2026): rateType/currencyCode are now optional explicit
  // parameters (each defaulting to the matching `state.*` value, so every
  // existing call site — which never passes them — behaves exactly as
  // before) rather than always reading off `state`. Lets
  // computeAlertReading() below validate a reading for a saved alert whose
  // rate type/currency differ from whatever is currently loaded in the form.
  function validateReading(reading, rateType = state.rateType, currencyCode = state.currency) {
    if (reading.status === "SOURCE_UNAVAILABLE") return { passed: false, reason: reading.errorMessage || "Source unavailable" };
    if (reading.status === "EXTRACTION_ERROR") return { passed: false, reason: reading.errorMessage || "Extraction error" };
    if (reading.status === "RATE_VALIDATION_ERROR" && reading.origin === "REAL") return { passed: false, reason: reading.errorMessage || "Rate failed validation" };
    if (reading.status === "STALE") return { passed: false, reason: reading.errorMessage || "Last successful check is too old to treat as current" };
    const value = rateType === "SELL" ? reading.sellRate : reading.buyRate;
    if (typeof value !== "number" || Number.isNaN(value)) return { passed: false, reason: "Non-numeric value" };
    if (value <= 0) return { passed: false, reason: "Value not greater than zero" };
    const cur = CURRENCIES.find((c) => c.code === currencyCode);
    const lowGuard = cur.base * 0.5;
    const highGuard = cur.base * 2;
    if (value < lowGuard || value > highGuard) return { passed: false, reason: "Outside expected range — possible decimal/unit error" };
    if (reading.buyRate != null && reading.sellRate != null && reading.buyRate > reading.sellRate) {
      return { passed: false, reason: "BUY greater than SELL — implausible" };
    }
    return { passed: true, reason: null };
  }

  // ---------------------------------------------------------------------
  // Target comparison (real logic — mirrors backend/targetEngine/compareTarget.js)
  // ---------------------------------------------------------------------

  function isTargetMet(liveRate, targetRate, condition, prevRate) {
    switch (condition) {
      case "AT_OR_BELOW": return liveRate <= targetRate;
      case "BELOW": return liveRate < targetRate;
      case "REACHES": return liveRate === targetRate;
      case "ABOVE": return liveRate > targetRate;
      case "PCT_CHANGE": {
        if (prevRate == null || prevRate === 0) return false;
        const pct = Math.abs((liveRate - prevRate) / prevRate) * 100;
        return pct >= state.pctChange;
      }
      default: return false;
    }
  }

  /**
   * pickBestReading() — Phase 8 fix (22-Aug-2026)
   * =================================================
   * Mirrors backend/targetEngine/compareTarget.js's pickBestReading()
   * exactly, same relationship isTargetMet() above already has with its
   * own backend twin. Added to fix a real inconsistency found while
   * building Phase 8: renderCompareTable() below already computed "the
   * best row" purely for display (the "Best"/"REACHED" badge), but tick()
   * separately picked a hardcoded "primary" source (My Money Master if
   * selected, else Taj Muhabath) for the actual alerting decision — so a
   * multi-source alert could show 🔴 REACHED on Taj Muhabath's row while
   * never firing, because the primary-source logic was checking My Money
   * Master. Confirmed with the user (an explicit choice, not assumed)
   * that alerting should follow the best rate across every selected
   * source, matching what the badge already visually promised. tick(),
   * renderHero(), and renderCompareTable() below now all share this one
   * function instead of computing "best" three different ways.
   *
   * @param {object[]} readings - annotated readings (StandardRateResult
   *   shape + sourceName/valid/invalidReason, as tick() below builds them)
   * @param {"BUY"|"SELL"} rateType
   * @returns {object|null} the best valid reading, or the first reading in
   *   the list (still useful for showing *an* error state) if none are
   *   valid — never null when readings is non-empty, so callers can
   *   render an honest error state for whichever reading is returned.
   */
  function pickBestReading(readings, rateType) {
    const validReadings = readings.filter((r) => r.valid);
    if (!validReadings.length) return readings[0] || null;

    // Bug fix (26-Aug-2026, reported: KRW/JPY/VND showing a SIM badge and
    // a fabricated-looking number on the dashboard even though 2-3 of
    // their selected sources DO have real adapter support for that
    // currency — see hasRealAdapter()/CODE_MATCHED_SOURCES above).
    //
    // Root cause: this function used to pick the numerically best reading
    // across ALL valid readings regardless of origin — real and simulated
    // mixed together. simulateReading()'s random walk (stepWalk()) has no
    // reason to land close to the real rate, so on any given tick a
    // simulated number can easily out-rank (be lower, for SELL) the real
    // ones purely by chance, silently winning "best" and getting displayed
    // — and origin-tagged — as if it were the live figure. Confirmed via
    // this project's own source-support tables: My Money Master has no
    // real KRW/VND card and Merchantrade Asia excludes JPY (unit
    // mismatch) — so an alert selecting all four sources for KRW mixes
    // 3 real readings (Taj Muhabath, Jalinan Duta, Merchantrade Asia) with
    // 1 simulated one (My Money Master), and the simulated one was
    // sometimes winning.
    //
    // This isn't just a cosmetic mislabel: tick() (above) feeds this same
    // function's return value straight into isTargetMet()/fireAlert() for
    // the in-tab client-side alert, so a mixed real+simulated alert could
    // fire — or fail to fire — off a fabricated number. That's exactly
    // the class of false alert PROJECT INSTRUCTIONS section 9 requires
    // guarding against, and section 25 requires never silently
    // substituting an alternative source for the real one.
    //
    // Fix: only ever fall back to a simulated reading when NO valid real
    // reading exists among the currently selected sources for this
    // currency. Whenever at least one real source produced a valid
    // reading, simulated readings are excluded from the pool entirely —
    // "best" is always the best REAL reading in that case, never a
    // fabricated number that merely happened to look better.
    const realReadings = validReadings.filter((r) => r.origin === "REAL");
    const pool = realReadings.length ? realReadings : validReadings;

    const key = rateType === "SELL" ? "sellRate" : "buyRate";
    const better = (a, b) => (rateType === "SELL" ? a[key] < b[key] : a[key] > b[key]);
    let best = pool[0];
    pool.forEach((r) => { if (better(r, best)) best = r; });
    return best;
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------

  function activeSourceList() {
    const list = [];
    SOURCES.forEach((s) => {
      if (!state.sources[s.id]) return;
      // Phase 52 — each branch-aware source reads its OWN entry from
      // state.branches, not a single shared value.
      if (s.supportsBranch) list.push({ ...s, branch: (state.branches && state.branches[s.id]) || null });
      else list.push({ ...s, branch: null });
    });
    return list;
  }

  let lastSelectedValue = null;
  let lastHeroReading = null; // see the comment where this is set, below

  function tick() {
    const now = new Date();
    $("clockLabel").textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

    const active = activeSourceList();
    if (active.length === 0) {
      lastHeroReading = null;
      renderEmptyState();
      return;
    }

    const readings = active.map((s) => {
      const r = getReading(s.id, s.branch);
      const v = validateReading(r);
      return { ...r, sourceName: s.name, valid: v.passed, invalidReason: v.reason };
    });

    // Best rate across every currently selected source drives both the
    // hero display and the actual alerting decision — see
    // pickBestReading()'s comment above for why this replaced a
    // hardcoded "primary source" pick (Phase 8 fix, 22-Aug-2026).
    const best = pickBestReading(readings, state.rateType);

    // Phase 16 (23-Aug-2026): stash this tick's own best reading so
    // updateAlertLiveRates() (auth.js's per-saved-alert-card live rate,
    // see window.CKM.computeAlertReading()'s comment) can reuse it for
    // whichever saved alert happens to be the one currently loaded into
    // this form/hero, instead of computing a second, independent reading
    // for it. That matters for SIMULATED sources specifically: each call
    // to getReading() advances that source+currency's random walk one
    // step (see stepWalk()) — computing a second reading for the same
    // currency/source/branch combo on the same 4-second cadence would
    // silently double-advance the walk shared with the hero, making it
    // visibly jumpier than every other currency's alert card. Reusing this
    // tick's own result keeps the hero and that one matching card always
    // in perfect agreement, with only one walk step per tick either way.
    lastHeroReading = {
      currency: state.currency, rateType: state.rateType,
      branches: { ...state.branches }, // Phase 52 — was a single `branch` value
      sourceIds: active.map((s) => s.id).slice().sort(),
      best, valid: !!best.valid,
      value: best.valid ? (state.rateType === "SELL" ? best.sellRate : best.buyRate) : null,
      formatted: best.valid ? formatRate(state.rateType === "SELL" ? best.sellRate : best.buyRate) : null,
    };

    renderCompareTable(readings, best);
    renderHero(best, readings);

    if (state.monitoring && best.valid) {
      const value = state.rateType === "SELL" ? best.sellRate : best.buyRate;
      const met = isTargetMet(value, state.targetRate, state.condition, lastSelectedValue);
      lastSelectedValue = value;

      pushHistory(value);
      renderChart();

      if (met && !state.triggered) {
        state.triggered = true;
        fireAlert(best, value);
      } else if (!met && state.triggered && state.condition !== "PCT_CHANGE") {
        // condition no longer met after a reset — nothing to do, suppression
        // only matters while state.triggered stays true until user resets.
      }
      logActivity(`${best.sourceName} ${state.currency} ${state.rateType} = ${formatRate(value)} — ${met ? (state.triggered ? "TARGET REACHED" : "target check") : "waiting"}`);
    } else if (state.monitoring && !best.valid) {
      logActivity(`${best.sourceName} ${state.currency} — ${best.status === "SOURCE_UNAVAILABLE" ? "SOURCE UNAVAILABLE" : "VALIDATION ERROR (" + best.invalidReason + ")"}`);
    }
  }

  function renderEmptyState() {
    $("statusPill").className = "status-pill error";
    $("statusPill").textContent = "⚠ No source selected";
    $("heroRateValue").textContent = "--.--";
    $("compareBody").innerHTML = `<tr><td colspan="6" style="color:var(--ink-faint);">Select at least one money changer.</td></tr>`;
  }

  function renderHero(best, allReadings) {
    const cur = CURRENCIES.find((c) => c.code === state.currency);
    const isReal = best.origin === "REAL";
    $("heroPair").textContent = `${state.currency} / MYR`;

    const diffEl = $("heroDiff");
    let pillClass = "mock", pillText = isReal ? "⚠ SOURCE UNAVAILABLE" : "🧪 SIMULATED";
    let rateText = "--.--";
    let rateLabel = isReal ? `${state.rateType} RATE` : `SIMULATED ${state.rateType} RATE`;

    if (best.status === "SOURCE_UNAVAILABLE" || best.status === "EXTRACTION_ERROR") {
      pillClass = "error";
      const reason = best.status === "EXTRACTION_ERROR" ? "EXTRACTION ERROR" : "SOURCE UNAVAILABLE";
      pillText = isReal ? `⚠ ${reason}` : `⚠ SIMULATED: ${reason}`;
      diffEl.textContent = "—"; diffEl.className = "hero-metric-value tabular";
      // If we have a prior successful value cached (only possible for real
      // sources, from an earlier — now overwritten — entry) we still don't
      // show it here on purpose: the current live-data file has no prior
      // value to fall back to, so honestly there's nothing to show.
    } else if (best.status === "STALE") {
      pillClass = "error"; pillText = "🟠 STALE";
      rateLabel = `${state.rateType} RATE — last successful check`;
      const value = state.rateType === "SELL" ? best.sellRate : best.buyRate;
      rateText = value != null ? formatRate(value) : "--.--";
      diffEl.textContent = "—"; diffEl.className = "hero-metric-value tabular";
    } else if (!best.valid) {
      pillClass = "error";
      pillText = isReal ? "⚠ VALIDATION ERROR" : "⚠ SIMULATED: VALIDATION ERROR";
      diffEl.textContent = "—"; diffEl.className = "hero-metric-value tabular";
    } else {
      const value = state.rateType === "SELL" ? best.sellRate : best.buyRate;
      rateText = formatRate(value);
      if (isReal) rateLabel = `LIVE ${state.rateType} RATE — retrieved directly from source`;
      // Bug fix (26-Aug-2026, reported): state.triggered was only ever
      // checked INSIDE the `state.monitoring` branch, so loading a saved
      // alert that the BACKEND had already marked TRIGGERED (state.triggered
      // set from row.status in loadAlertIntoForm, independent of this tab's
      // own "Start Monitoring" toggle) still showed "🟢 LIVE (not
      // monitoring)" here — directly contradicting the alert card right
      // next to it, which correctly reads TRIGGERED from the database. This
      // hero pill and that card were describing the exact same alert with
      // opposite-looking colors. Fix: check state.triggered FIRST,
      // regardless of state.monitoring — it's already a reliable flag
      // either way (set live by tick() during monitoring, or set from the
      // database when a saved alert is loaded) — and only use
      // state.monitoring to distinguish the two non-triggered cases.
      if (state.triggered) {
        pillClass = "reached"; pillText = (isReal ? "🔴 " : "🔴 SIMULATED: ") + "TARGET REACHED";
      } else if (state.monitoring) {
        pillClass = isReal ? "live" : "waiting"; pillText = isReal ? "🟢 LIVE — WAITING" : "🟡 SIMULATED: WAITING";
      } else {
        pillClass = isReal ? "live" : "mock";
        pillText = isReal ? "🟢 LIVE (not monitoring)" : "🧪 SIMULATED (not monitoring)";
      }

      const diff = value - state.targetRate;
      diffEl.textContent = (diff >= 0 ? "+" : "") + diff.toFixed(cur.decimals);
      diffEl.className = "hero-metric-value tabular " + (diff <= 0 ? "diff-up" : "diff-down");
    }

    $("statusPill").className = "status-pill " + pillClass;
    $("statusPill").textContent = pillText;
    $("heroRateLabel").textContent = rateLabel;
    $("heroRateValue").textContent = rateText;
    $("heroTarget").textContent = state.targetRate ? formatRate(state.targetRate) : "—";
    // "Best available" only when there's genuinely a valid rate to call
    // best — when nothing validated this run, this is just showing
    // whichever selected source happens to be first, so it says so
    // plainly rather than mislabeling it as "best" (Phase 8 fix).
    const sourceLabel = best.valid ? "Best available source" : "Source";
    $("heroSourceLabel").textContent = `${sourceLabel}: ${best.sourceName}${best.branch ? " — " + best.branch : ""}`;
    $("lastChecked").textContent = best.retrievedAt ? "Last checked: " + best.retrievedAt.toLocaleTimeString() : "Last checked: —";
  }

  function renderCompareTable(readings, best) {
    const bestIdx = best ? readings.indexOf(best) : -1;

    $("compareBody").innerHTML = readings.map((r, i) => {
      const originTag = r.origin === "REAL"
        ? '<span class="origin-tag origin-live">LIVE SOURCE</span>'
        : '<span class="origin-tag origin-sim">SIMULATED</span>';
      // The REACHED badge now reads directly off state.triggered — the
      // same flag that actually decided whether fireAlert() ran — instead
      // of a separately recomputed "<= target" check that didn't know
      // about the alert's real condition (ABOVE, PCT_CHANGE, etc.) or
      // duplicate-suppression state. One source of truth for "did this
      // fire," not two that could disagree (Phase 8 fix).
      //
      // Bug fix (26-Aug-2026, reported): this used to also require
      // `state.monitoring` — this tab's own local "Start Monitoring"
      // toggle — before showing REACHED. That's wrong for a SAVED alert:
      // loadAlertIntoForm() already sets state.triggered from the
      // database's own status column the moment the alert loads, entirely
      // independent of whether this browser tab has ever clicked "Start
      // Monitoring." So simply viewing a saved alert that the backend had
      // already marked TRIGGERED showed a plain green "🟢 LIVE" badge here
      // — directly contradicting the "TRIGGERED" pill on the alert card
      // immediately above this table, for the exact same alert. Dropping
      // the state.monitoring requirement makes state.triggered alone the
      // one source of truth this comment already promised, in both cases.
      const statusBadge = r.status === "SOURCE_UNAVAILABLE" ? `<span class="status-pill error" style="font-size:.72rem;">⚠ UNAVAILABLE</span>`
        : r.status === "EXTRACTION_ERROR" ? `<span class="status-pill error" style="font-size:.72rem;">⚠ EXTRACTION ERROR</span>`
        : r.status === "STALE" ? `<span class="status-pill error" style="font-size:.72rem;">🟠 STALE</span>`
        : !r.valid ? `<span class="status-pill error" style="font-size:.72rem;">⚠ INVALID</span>`
        : i === bestIdx && state.triggered ? `<span class="status-pill reached" style="font-size:.72rem;">🔴 REACHED</span>`
        : r.origin === "REAL" ? `<span class="status-pill live" style="font-size:.72rem;">🟢 LIVE</span>`
        : `<span class="status-pill waiting" style="font-size:.72rem;">🟡 WAITING</span>`;
      return `<tr class="${i === bestIdx ? "is-best" : ""}">
        <td>${r.sourceName}${i === bestIdx ? '<span class="best-badge">Best</span>' : ""}<br>${originTag}</td>
        <td>${r.branch || "—"}</td>
        <td class="num">${r.buyRate != null ? formatRate(r.buyRate) : "—"}</td>
        <td class="num">${r.sellRate != null ? formatRate(r.sellRate) : "—"}</td>
        <td class="num">${formatRate(state.targetRate)}</td>
        <td>${statusBadge}</td>
      </tr>`;
    }).join("");
  }

  function formatRate(v, currencyCode = state.currency) {
    const d = decimalsFor(currencyCode);
    return Number(v).toFixed(d);
  }

  /**
   * Phase 16 (23-Aug-2026): computes a live/simulated reading for an
   * ARBITRARY saved alert — not just whichever one is currently loaded into
   * the form on the left. Added after user feedback: with two saved alerts
   * for two different currencies (e.g. VND and CNY), "Best Available Rate
   * For Your Alert" could only ever show ONE of them live at a time (the
   * one auto-synced into the form, or whichever was last clicked "Edit")
   * even though "My Saved Alerts" correctly showed both alerts' real
   * ACTIVE/TRIGGERED status (that status comes straight from the database,
   * kept current by the independent backend scheduler — see
   * backend/scheduler/run.js — regardless of what's loaded in this tab).
   * This reuses the exact same getReading() / validateReading() /
   * pickBestReading() pipeline tick() already uses for the hero, just
   * parameterized by THIS alert's own currency/rateType/sources/branch
   * instead of reading them off the shared `state` object, so each saved
   * alert's card can show its own current number without disturbing
   * whichever alert is actually loaded into the form/hero/chart.
   */
  function computeAlertReading(alertRow) {
    const currencyCode = alertRow.currency;
    const rateType = alertRow.rate_type;
    const sourceIds = Array.isArray(alertRow.sources) ? alertRow.sources : [];
    if (!currencyCode || !rateType || sourceIds.length === 0) return null;

    const readings = sourceIds.map((sourceId) => {
      const src = SOURCES.find((s) => s.id === sourceId);
      // Phase 52 — alertRow.branches is a per-source map now, not a single
      // alertRow.branch value.
      const branch = src && src.supportsBranch ? (alertRow.branches && alertRow.branches[sourceId]) || null : null;
      const r = getReading(sourceId, branch, currencyCode);
      const v = validateReading(r, rateType, currencyCode);
      return { ...r, sourceName: src ? src.name : sourceId, valid: v.passed, invalidReason: v.reason };
    });

    const best = pickBestReading(readings, rateType);
    if (!best) return null;
    const value = best.valid ? (rateType === "SELL" ? best.sellRate : best.buyRate) : null;

    return {
      best,
      value,
      valid: !!best.valid,
      formatted: value != null ? formatRate(value, currencyCode) : null,
      origin: best.origin, // "REAL" | "SIMULATED"
      invalidReason: best.invalidReason || null,
    };
  }
  window.CKM.computeAlertReading = computeAlertReading;
  // See the comment where `lastHeroReading` is set inside tick() above.
  window.CKM.getLastHeroReading = () => lastHeroReading;
  // Phase 17 (23-Aug-2026): lets auth.js format a number to the correct
  // number of decimals for an arbitrary currency (matching formatRate()'s
  // own rule) without duplicating decimalsFor()'s lookup table itself —
  // used by the new per-alert "Best available rate" rows.
  window.CKM.formatRateFor = (v, currencyCode) => formatRate(v, currencyCode);

  // ---------------------------------------------------------------------
  // History chart (hand-drawn canvas, no charting library needed)
  // ---------------------------------------------------------------------

  function pushHistory(value) {
    state.history.push({ t: new Date(), value });
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    state.history = state.history.filter((p) => p.t.getTime() >= cutoff).slice(-500);
  }

  /**
   * Public dispatcher — always the function every internal call site here
   * (tick(), the chart-range buttons, window resize) calls. Phase 10 adds a
   * real, Supabase-backed history chart (frontend/rateHistory.js) that
   * should win whenever it's available (signed in, Supabase configured);
   * this function is the single place that decides which chart actually
   * gets drawn, so neither implementation has to guess about the other or
   * fight over the shared <canvas> element.
   */
  function renderChart() {
    const canvas = $("historyChart");
    if (typeof window.CKM.renderRealHistory === "function" && window.CKM.renderRealHistory(canvas)) {
      return;
    }
    renderSimulatedChart(canvas);
  }

  /**
   * The original Phase 1 hand-drawn chart: this browser tab's own in-memory
   * `state.history` (real or simulated readings recorded since monitoring
   * started in THIS session — never persisted, lost on reload). Still the
   * correct fallback when a user isn't signed in or Supabase isn't
   * configured, since frontend/rateHistory.js's real chart needs a signed-
   * in session to read the `rates` table at all (see database/schema.sql's
   * RLS policy — `to authenticated`, not `anon`).
   */
  function renderSimulatedChart(canvas) {
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 900, h = 180;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const styles = getComputedStyle(document.body);
    const line = styles.getPropertyValue("--line").trim();
    const inkFaint = styles.getPropertyValue("--ink-faint").trim();
    const accent = styles.getPropertyValue("--accent").trim();
    const down = styles.getPropertyValue("--down").trim();

    const pts = state.history;
    const pad = { l: 44, r: 12, t: 12, b: 22 };
    const plotW = w - pad.l - pad.r, plotH = h - pad.t - pad.b;

    if (pts.length < 2) {
      ctx.fillStyle = inkFaint;
      ctx.font = "13px 'IBM Plex Sans', sans-serif";
      ctx.fillText("Start monitoring to begin recording rate history…", pad.l, h / 2);
      return;
    }

    const values = pts.map((p) => p.value).concat([state.targetRate]);
    const min = Math.min(...values) - 0.05, max = Math.max(...values) + 0.05;
    const x = (i) => pad.l + (i / (pts.length - 1)) * plotW;
    const y = (v) => pad.t + (1 - (v - min) / (max - min)) * plotH;

    // gridlines
    ctx.strokeStyle = line; ctx.lineWidth = 1;
    for (let g = 0; g <= 3; g++) {
      const gy = pad.t + (g / 3) * plotH;
      ctx.beginPath(); ctx.moveTo(pad.l, gy); ctx.lineTo(w - pad.r, gy); ctx.stroke();
    }

    // target line
    ctx.strokeStyle = down; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(pad.l, y(state.targetRate)); ctx.lineTo(w - pad.r, y(state.targetRate)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = down; ctx.font = "11px 'IBM Plex Mono', monospace";
    ctx.fillText("target " + formatRate(state.targetRate), pad.l + 4, y(state.targetRate) - 4);

    // area fill
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + plotH);
    grad.addColorStop(0, accent + "55");
    grad.addColorStop(1, accent + "00");
    ctx.beginPath();
    ctx.moveTo(x(0), y(pts[0].value));
    pts.forEach((p, i) => ctx.lineTo(x(i), y(p.value)));
    ctx.lineTo(x(pts.length - 1), pad.t + plotH);
    ctx.lineTo(x(0), pad.t + plotH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // line
    ctx.beginPath();
    pts.forEach((p, i) => { const px = x(i), py = y(p.value); i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); });
    ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.stroke();

    // endpoint
    const lastPt = pts[pts.length - 1];
    ctx.beginPath();
    ctx.arc(x(pts.length - 1), y(lastPt.value), 4, 0, Math.PI * 2);
    ctx.fillStyle = accent; ctx.fill();

    // y-axis labels
    ctx.fillStyle = inkFaint; ctx.font = "11px 'IBM Plex Mono', monospace";
    ctx.fillText(max.toFixed(2), 4, pad.t + 8);
    ctx.fillText(min.toFixed(2), 4, pad.t + plotH);
  }

  // ---------------------------------------------------------------------
  // Activity log
  // ---------------------------------------------------------------------

  function logActivity(msg) {
    state.log.unshift({ t: new Date(), msg });
    state.log = state.log.slice(0, 40);
    renderActivityLog();
  }

  // Phase 22 (24-Aug-2026) bug fix: the fixed empty-state text below (added
  // in the Phase 23-Aug-2026 fix noted above) told EVERY visitor to "click
  // Start monitoring... or sign in above" — including someone who is
  // ALREADY signed in with active saved alerts. Reported: a signed-in user
  // with 2 ACTIVE saved alerts saw this generic message, read "or sign in
  // above" as evidence nothing was happening yet, and had no way to tell,
  // from this card alone, that their alerts were in fact already being
  // checked every 5 minutes by the backend. The backend and notification
  // delivery were never the bug (see backend/scheduler/run.js and
  // backend/notifications/notify.js — both real, both running); this
  // card's copy just never accounted for that being possible.
  //
  // Fix: ask auth.js (via window.CKM.getMonitoringContext(), which it sets
  // up during init — see that file) whether the person is signed in and
  // how many saved alerts are currently ACTIVE, and tailor the message to
  // what's actually true for them, instead of one static string for
  // everyone.
  // Phase 28 (26-Aug-2026) fix: a signed-in user with saved alerts previously
  // saw this card explain, correctly but unhelpfully, that real checks were
  // happening "independent of this tab" — with nothing to actually look at.
  // Reported: "The Activity Log should be running as long as there is
  // currency in My Saved Alerts." The scheduled backend job (Phase 8/14,
  // backend/scheduler/run.js) has been writing every real check it makes
  // into Supabase's `rates` table all along — and this file has already been
  // reading those exact rows since Phase 20/21 (loadSupabaseRates() above,
  // one query per currency across every saved alert, kept fresh on a 60s
  // poll) to drive the comparison table and hero card. buildBackendActivityEntries()
  // below just turns that SAME already-fetched data into log lines too, so
  // this card shows the real backend job's own recent checks — source,
  // currency, buy/sell, and status, newest first — instead of only
  // explaining that they exist somewhere you can't see. Local, in-tab
  // checks (state.log, from "Start monitoring") still take priority when
  // present, unchanged from before.
  function buildBackendActivityEntries() {
    const entries = [];
    supabaseRatesCache.forEach((cached, currencyCode) => {
      if (!cached || cached.failed) return;
      cached.rows.forEach((r) => {
        const src = SOURCES.find((s) => s.id === r.source);
        const sourceName = src ? src.name : r.source;
        const branchSuffix = r.branch ? ` (${r.branch})` : "";
        const when = r.created_at || r.retrieved_at;
        const t = when ? new Date(when) : null;

        let text;
        if (r.status === "LIVE") {
          const buy = r.buy_rate != null ? formatRate(Number(r.buy_rate), currencyCode) : "—";
          const sell = r.sell_rate != null ? formatRate(Number(r.sell_rate), currencyCode) : "—";
          // Phase 29 (26-Aug-2026) fix: reported — Jalinan Duta's VND row
          // showed here as "LIVE" while the Multi-source comparison table
          // showed the exact same source+currency as SIMULATED, directly
          // contradicting each other. Root cause: the backend adapter is
          // generic (no hardcoded currency) and will happily return LIVE
          // for any currency it finds a table row for, and
          // backend/validation/validateRate.js only range-checks a
          // currency when config/websites/*.json defines an
          // expectedRange for it — Jalinan Duta's config only has one for
          // CNY (Phase 24 deliberately verified CNY only, same rollout
          // pattern as Merchantrade Asia), so a VND row sails through
          // validation with no range check at all and gets written to
          // Supabase as status: 'LIVE'. Every OTHER real/simulated split
          // on this dashboard (comparison table, hero, saved-alert cards,
          // currency chips) is decided by hasRealAdapter() (see that
          // function's own Phase 38 comment for how it decides this today
          // — no longer the human-curated REAL_ADAPTER_SUPPORT allowlist
          // this Phase 29 fix originally described, but the same
          // principle: one shared gate, not a second copy reading the raw
          // DB status column directly, which is what this fix actually
          // changed) — this was the one place reading the raw DB status column
          // directly instead. Applying the same gate here means the log
          // can never again claim a combo is LIVE that the rest of the
          // app still — correctly and deliberately — treats as
          // unverified, while still surfacing that a real check happened
          // (rather than silently hiding the row, which would look like
          // its own inconsistency).
          if (hasRealAdapter(r.source, currencyCode)) {
            text = `${sourceName}${branchSuffix} — ${currencyCode} buy ${buy} / sell ${sell} · LIVE`;
          } else {
            text = `${sourceName}${branchSuffix} — ${currencyCode} buy ${buy} / sell ${sell} · extracted OK, but ${currencyCode} isn't verified for this source yet — shown as SIMULATED elsewhere until confirmed`;
          }
        } else {
          // Honestly pass through whatever the adapter actually recorded
          // (SOURCE_UNAVAILABLE, EXTRACTION_ERROR, RATE_VALIDATION_ERROR) —
          // never relabel a real failed check as if it succeeded.
          const reason = r.error_message ? `: ${String(r.error_message).slice(0, 90)}` : "";
          text = `${sourceName}${branchSuffix} — ${currencyCode} · ${r.status || "UNKNOWN"}${reason}`;
        }
        entries.push({ t, text, sortKey: t ? t.getTime() : 0 });
      });
    });
    entries.sort((a, b) => b.sortKey - a.sortKey);
    return entries.slice(0, 15); // most recent 15 across every watched currency — plenty for a glance, not a full history dump
  }

  function renderActivityLog() {
    const el = $("activityLog");
    if (!el) return;
    if (state.log.length > 0) {
      el.innerHTML = state.log.map((e) =>
        `<li><span class="log-time">${e.t.toLocaleTimeString()}</span><span class="log-msg">${escapeHtml(e.msg)}</span></li>`
      ).join("");
      return;
    }

    const ctx = (typeof window.CKM.getMonitoringContext === "function")
      ? window.CKM.getMonitoringContext()
      : { signedIn: false, totalSavedAlerts: 0, active: 0, triggered: 0, disabled: 0 };

    if (ctx.signedIn && ctx.totalSavedAlerts > 0) {
      const backendEntries = buildBackendActivityEntries();
      if (backendEntries.length > 0) {
        const note = `<li class="log-empty">Showing the ${backendEntries.length} most recent check${backendEntries.length === 1 ? "" : "s"} from the scheduled backend job (every 5 minutes) — not just this tab.</li>`;
        const rows = backendEntries.map((e) =>
          `<li><span class="log-time">${e.t ? e.t.toLocaleTimeString() : "—"}</span><span class="log-msg">${escapeHtml(e.text)}</span></li>`
        ).join("");
        el.innerHTML = note + rows;
        return;
      }
    }

    let msg;
    if (ctx.signedIn && ctx.totalSavedAlerts > 0) {
      const parts = [];
      if (ctx.active > 0) parts.push(`${ctx.active} active — still being checked every 5 minutes`);
      if (ctx.triggered > 0) parts.push(`${ctx.triggered} already triggered — paused until you reset ${ctx.triggered === 1 ? "it" : "them"}`);
      if (ctx.disabled > 0) parts.push(`${ctx.disabled} disabled`);
      const breakdown = parts.join(", ");
      const n = ctx.totalSavedAlerts;
      // Reaching this branch means buildBackendActivityEntries() above
      // found nothing yet (the backend job's rows for your saved
      // currencies haven't finished loading, or none has ever run) — not
      // that this log can never show them. Once loadSupabaseRates() gets a
      // real row back (it retries every 60s), this message is replaced by
      // the actual checks automatically — see the branch above.
      msg = `Loading recent checks for your ${n} saved alert${n === 1 ? "" : "s"} (${breakdown}) from the scheduled backend job — this refreshes every 60 seconds. If nothing appears shortly, the backend job hasn't completed its first check yet, or hasn't run at all: it runs every 5 minutes independent of this tab, and you'll still be notified by whichever method you chose when saving (email/Telegram) even with this page closed.`;
    } else if (ctx.signedIn) {
      msg = `No activity yet, and no saved alerts to check in the background. Click "Start monitoring" below to watch a rate live in this tab, or save an alert above so the scheduled backend job checks it automatically, even after you close this page.`;
    } else {
      msg = `No activity yet — click "Start monitoring" below to begin locally, or sign in above and save an alert so the scheduled backend job checks it automatically, even when this tab is closed.`;
    }
    el.innerHTML = `<li class="log-empty">${escapeHtml(msg)}</li>`;
  }

  function escapeHtml(s) { return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

  // Bug fix (26-Aug-2026, reported): fireAlert()'s "Time:" line used
  // `new Date().toLocaleString()`, which formats using the BROWSER's own
  // locale/timezone setting — usually fine if the user's OS is correctly
  // set to Malaysia time, but not guaranteed (a traveling user, a
  // misconfigured OS clock, or simply a non-en-MY locale would silently
  // show a different format/timezone than the rest of the app). Matches
  // backend/notifications/notify.js's formatMalaysiaTime() exactly — same
  // explicit Asia/Kuala_Lumpur timezone, same DD-MMM-YYYY hh:mm:ss AM/PM
  // shape — so every channel (browser, email, Telegram, push) reports the
  // exact same time for the exact same trigger, regardless of where each
  // one happens to run.
  //
  // Phase 49 (29-Aug-2026): this used to be a second, independent copy of
  // notify.js's function, "duplicated rather than shared because this
  // project has no bundler/shared-module setup between frontend and
  // backend" — true when that reasoning was written, no longer true as of
  // Phase 48's frontend/currencySupport.js. Now reads from
  // frontend/timeFormat.js's single implementation (loaded here via a
  // <script> tag, immediately before this file) instead of keeping its
  // own copy — there is no longer a second implementation anywhere for
  // the two to drift apart from.
  const formatMalaysiaTime = window.CKM_TIME_FORMAT.formatMalaysiaTime;

  // ---------------------------------------------------------------------
  // Alerts / notifications (in-tab browser notifications; wired to both
  // real and simulated readings — see fireAlert()'s origin check below.
  // Additional server-side channels — email, Telegram (Phase 10), and
  // real Web Push (Phase 39, frontend/push.js) — are delivered by
  // backend/scheduler/run.js, not from here; this function's own
  // `new Notification(...)` call only ever fires while this specific tab
  // is open, which is exactly why Push exists as a separate channel.)
  // ---------------------------------------------------------------------

  function fireAlert(reading, value) {
    // reading.origin was already real ("REAL") or simulated ("SIMULATED")
    // by the time it reaches here — never guess or assume: label the alert
    // exactly as honestly as the reading itself was labeled everywhere else
    // on the dashboard. Getting this wrong in either direction (claiming a
    // real trigger is simulated, or vice versa) breaks the project's core
    // "never mislabel data" rule just as much as showing fabricated data as
    // LIVE would.
    const isReal = reading.origin === "REAL";
    const tag = isReal ? "LIVE" : "SIMULATED";
    const msg = `🚨 ${state.currency} RATE ALERT (${tag}) — ${reading.sourceName} ${state.rateType}: ${formatRate(value)}, target ${formatRate(state.targetRate)}. Target reached.`;
    logActivity(msg);
    showToast(msg);
    playBeep();
    if (state.notifications.browser && "Notification" in window && Notification.permission === "granted") {
      new Notification(`Currency Rate Alert${isReal ? "" : " (Simulated)"}`, {
        body: `${state.currency} ${state.rateType} = ${formatRate(value)} — target ${formatRate(state.targetRate)} reached.\n` +
          `Money changer: ${reading.sourceName}${reading.branch ? ` (${reading.branch})` : ""}\n` +
          `Time: ${formatMalaysiaTime()}\n` +
          (isReal
            ? "Retrieved directly from the live source."
            : "This is simulated data, not a live rate."),
      });
    }
    callHook("onAlertTriggered", reading, value);
  }

  function showToast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(showToast._h);
    showToast._h = setTimeout(() => t.classList.remove("show"), 4200);
  }

  let audioCtx = null;
  function playBeep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = "sine"; o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.15, audioCtx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.5);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + 0.5);
    } catch (e) { /* audio not available — non-fatal */ }
  }

  // ---------------------------------------------------------------------
  // Form wiring
  // ---------------------------------------------------------------------

  function populateSelects() {
    const currencySel = $("currency");
    currencySel.innerHTML = CURRENCIES.map((c) => `<option value="${c.code}">${c.code} — ${c.name}</option>`).join("");
    currencySel.value = state.currency;
  }

  // Phase 52 (02-Sep-2026) replaces updateBranchAvailability(): the old
  // single, static <select id="branch"> only ever had to handle ONE
  // branch-aware source (Taj Muhabath). With Wawasan Ilham and Jalinan
  // Duta also branch-aware, more than one such source can be checked at
  // once (comparing money changers is this app's own core feature), and
  // each needs its own dropdown with its own branch list — a shared
  // dropdown can't represent two sources' branches at the same time. This
  // rebuilds #branchFieldsContainer's contents from scratch on every call
  // (checkbox toggle, or a saved alert loading) — one <div class="field">
  // block per currently-selected branch-aware source, each wired straight
  // to its own state.branches[sourceId] entry.
  function renderBranchFields() {
    const container = $("branchFieldsContainer");
    if (!container) return;

    const branchSources = SOURCES.filter((s) => s.supportsBranch && state.sources[s.id]);

    if (branchSources.length === 0) {
      container.innerHTML =
        '<label>Branch</label>' +
        '<p class="hint">Enable a branch-aware money changer (Taj Muhabath, Wawasan Ilham, or Jalinan Duta) to choose a branch. ' +
        'My Money Master and Merchantrade Asia each publish one site-wide rate — no branch selection applies to them.</p>';
      return;
    }

    container.innerHTML = branchSources.map((s) => {
      const selId = `branch__${s.id}`;
      return (
        `<div class="field">` +
        `<label for="${selId}">Branch <span style="text-transform:none; font-weight:400;">(${s.name})</span></label>` +
        `<select id="${selId}" name="${selId}"></select>` +
        `</div>`
      );
    }).join("");

    branchSources.forEach((s) => {
      const branches = BRANCHES_BY_SOURCE[s.id] || [];
      const sel = $(`branch__${s.id}`);
      if (!sel) return;
      sel.innerHTML = branches.map((b) => `<option value="${b}">${b}</option>`).join("");
      sel.value = (state.branches && state.branches[s.id]) || branches[0] || "";
      sel.addEventListener("change", (e) => {
        state.userEditedForm = true;
        state.branches[s.id] = e.target.value;
      });
    });
  }

  function wireForm() {
    populateSelects();
    renderBranchFields();
    if ($("rateTypeHint")) $("rateTypeHint").textContent = RATE_TYPE_EXPLAINERS[state.rateType];

    on("currency", "change", (e) => {
      state.userEditedForm = true;
      state.currency = e.target.value;
      const cur = CURRENCIES.find((c) => c.code === state.currency);
      $("targetRate").value = cur.base.toFixed(cur.decimals);
      state.targetRate = cur.base;
      state.history = [];
      lastSelectedValue = null;
      callHook("onCurrencyChanged");
      loadSupabaseRates(); // Phase 20 — don't wait out the poll interval after a currency switch
    });

    document.querySelectorAll("#rateTypeSeg button").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.userEditedForm = true;
        document.querySelectorAll("#rateTypeSeg button").forEach((b) => b.setAttribute("aria-pressed", "false"));
        btn.setAttribute("aria-pressed", "true");
        state.rateType = btn.dataset.value;
        if ($("rateTypeHint")) $("rateTypeHint").textContent = RATE_TYPE_EXPLAINERS[state.rateType];
      });
    });

    on("targetRate", "input", (e) => {
      state.userEditedForm = true;
      const v = parseFloat(e.target.value);
      state.targetRate = Number.isFinite(v) && v > 0 ? v : state.targetRate;
    });

    on("srcMMM", "change", (e) => { state.userEditedForm = true; state.sources.mymoneymaster = e.target.checked; });
    on("srcTM", "change", (e) => { state.userEditedForm = true; state.sources.tajmuhabath = e.target.checked; renderBranchFields(); });
    on("srcMTA", "change", (e) => { state.userEditedForm = true; state.sources.merchantradeasia = e.target.checked; });
    // Phase 52: srcJD and srcWI now also re-render the branch fields —
    // both are branch-aware sources as of this phase.
    on("srcJD", "change", (e) => { state.userEditedForm = true; state.sources.jalinanduta = e.target.checked; renderBranchFields(); });
    on("srcWI", "change", (e) => { state.userEditedForm = true; state.sources.wawasanilham = e.target.checked; renderBranchFields(); });

    on("condition", "change", (e) => {
      state.userEditedForm = true;
      state.condition = e.target.value;
      $("pctChangeField").style.display = state.condition === "PCT_CHANGE" ? "block" : "none";
    });
    on("pctChange", "input", (e) => {
      state.userEditedForm = true;
      const v = parseFloat(e.target.value);
      state.pctChange = Number.isFinite(v) && v > 0 ? v : state.pctChange;
    });

    on("interval", "change", (e) => { state.userEditedForm = true; state.interval = parseInt(e.target.value, 10); });
    // No notifBrowser checkbox (Phase 11.1) — state.notifications.browser stays true unconditionally, set at init above.
    on("notifEmail", "change", (e) => { state.userEditedForm = true; state.notifications.email = e.target.checked; });
    on("notifTelegram", "change", (e) => {
      state.userEditedForm = true;
      state.notifications.telegram = e.target.checked;
      $("telegramChatIdField").style.display = state.notifications.telegram ? "block" : "none";
    });
    on("telegramChatId", "input", (e) => { state.userEditedForm = true; state.telegramChatId = e.target.value.trim(); });

    on("alertForm", "submit", (e) => {
      e.preventDefault();
      // Bug fix (26-Aug-2026, reported): now that a saved alert auto-engages
      // monitoring on load (see loadAlertIntoForm() above), the button
      // almost always already reads "✓ Monitoring active" by the time
      // anyone could click it. But this handler still called the full
      // startMonitoring() unconditionally — which resets state.triggered to
      // false regardless of the alert's real status — so clicking an
      // already-active button on an alert that was genuinely already past
      // target immediately looked like a fresh trigger: the in-tab
      // notification and toast fired again right there. That's real,
      // correct 'browser'-channel behavior (it only ever runs client-side,
      // in this tab, the instant this tab evaluates it), not a bug on its
      // own — but resetting an already-correct state to produce it was.
      // Real email/Telegram/push are dispatched exclusively by the backend
      // scheduled job, never by anything in this file — no button here can
      // make those fire early or explains their absence; they simply run on
      // their own schedule, unaffected by this click either way. Only
      // start fresh (reset triggered/history) on a genuine OFF -> ON
      // transition — a resubmit while already monitoring just reaffirms it.
      if (state.monitoring) {
        $("formStatus").textContent = "Monitoring is already active for this alert — no need to click again.";
        return;
      }
      startMonitoring();
    });

    on("resetBtn", "click", () => {
      state.monitoring = false;
      state.triggered = false;
      state.forcedMode = null;
      state.history = [];
      lastSelectedValue = null;
      $("startBtn").textContent = "Start monitoring";
      $("startBtn").dataset.active = "false";
      $("formStatus").textContent = "Alert reset. Configure and start again whenever you're ready.";
      logActivity("Alert reset by user.");
      callHook("onAlertReset");
      tick();
    });

    // test controls
    on("testForceTrigger", "click", () => {
      if (!state.monitoring) startMonitoring();
      const cur = CURRENCIES.find((c) => c.code === state.currency);
      const key = walkKey("mymoneymaster", null);
      state.walk[key] = state.targetRate - 0.01;
      const key2 = walkKey("tajmuhabath", state.branches.tajmuhabath);
      state.walk[key2] = state.targetRate - 0.01;
      state.forcedMode = null;
      tick();
    });
    on("testSourceDown", "click", () => { state.forcedMode = "SOURCE_DOWN"; tick(); });
    on("testValidationError", "click", () => { state.forcedMode = "VALIDATION_ERROR"; tick(); });
    on("testResume", "click", () => { state.forcedMode = null; tick(); });
  }

  function startMonitoring() {
    state.monitoring = true;
    state.triggered = false;
    state.forcedMode = null;
    state.history = [];
    lastSelectedValue = null;
    $("startBtn").textContent = "✓ Monitoring active";
    $("startBtn").dataset.active = "true";
    // Same rule as tick()'s own best-source pick (see pickBestReading()) and
    // fireAlert()'s origin check: never claim "simulated" when a real source
    // is in play, or vice versa. Checks every currently selected source,
    // not just one hardcoded "primary" — a Phase 8 fix alongside the
    // best-rate change, since a single fixed source no longer reflects
    // which reading might actually end up driving the alert.
    const isRealAny = activeSourceList().some((s) => hasRealAdapter(s.id, state.currency));
    $("formStatus").textContent = isRealAny
      ? "Monitoring live data — see the Activity log below."
      : "Simulated monitoring is running — see the Activity log below.";
    logActivity(`Monitoring started: ${state.currency} ${state.rateType}, target ${formatRate(state.targetRate)}, condition ${state.condition}.`);

    if (state.notifications.browser && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
    callHook("onMonitoringStarted");
    tick();
  }

  // ---------------------------------------------------------------------
  // Chart range buttons (cosmetic in Phase 1 — history is short either way)
  // ---------------------------------------------------------------------

  function wireChartRange() {
    document.querySelectorAll(".chart-range button").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".chart-range button").forEach((b) => b.setAttribute("aria-pressed", "false"));
        btn.setAttribute("aria-pressed", "true");
        renderChart();
      });
    });
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  function init() {
    const cur = CURRENCIES.find((c) => c.code === state.currency);
    $("targetRate").value = cur.base.toFixed(cur.decimals);
    wireForm();
    wireChartRange();
    renderActivityLog(); // show the empty-state placeholder immediately, before any activity happens

    // Phase 12 tidy-up: the "Test controls" card (force-trigger, simulate
    // source-down, etc.) is QA/demo tooling, not something a real user
    // monitoring their own alert should see or be tempted to click. Hidden
    // by default in index.html; reveal it only for whoever explicitly asks
    // for it via ?debug=1 in the URL (e.g. for a live demo).
    if (new URLSearchParams(window.location.search).get("debug") === "1" && $("testControlsSection")) {
      $("testControlsSection").style.display = "block";
    }

    loadLiveData(); // also calls tick() once it resolves (or fails)
    loadSupabaseRates(); // Phase 20 — same pattern, preferred source when it has data
    tick();
    setInterval(tick, 4000);
    setInterval(loadLiveData, LIVE_DATA_POLL_MS);
    setInterval(loadSupabaseRates, LIVE_DATA_POLL_MS);
    setInterval(() => { $("clockLabel").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }, 1000);
    window.addEventListener("resize", renderChart);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
