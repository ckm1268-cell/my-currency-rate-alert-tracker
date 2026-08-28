/**
 * Account / multi-user alerts — Phase 7
 * =========================================
 * STATUS: implemented (21-Aug-2026), integrated with the existing dashboard
 * (frontend/app.js) through the small `window.CKM` bridge that file exposes
 * — see the "Phase 7 integration bridge" comment near the top of app.js.
 * This file is loaded AFTER app.js and AFTER frontend/supabaseConfig.js in
 * index.html, and is entirely additive: if Supabase isn't configured yet
 * (supabaseConfig.js still has its placeholder values) or the Supabase JS
 * library fails to load, this file disables itself and shows a small notice
 * — it never breaks the Phase 1-6 dashboard, which works completely fine
 * signed out.
 *
 * AUTH METHOD: email + password (switched 22-Aug-2026, replacing the
 * original magic-link-only flow). A user's account IS their email address;
 * they set their own password at sign-up. This still runs entirely through
 * Supabase Auth (auth.signUp / auth.signInWithPassword) — Supabase hashes
 * and stores the password server-side, this app never sees or stores a
 * plaintext password anywhere, and no user table lives in this repo. See
 * the "why not a repo-stored user table" note further down for the
 * reasoning: a public GitHub repo has no real access control, so storing
 * credentials as a committed file would defeat the point of having a
 * password at all.
 *
 * What this file does:
 *   - Renders a log-in / sign-up / signed-in panel in the "accountCard"
 *     markup in index.html, using Supabase Auth's email+password flow
 *     (auth.signUp, auth.signInWithPassword, auth.resetPasswordForEmail /
 *     auth.updateUser for the "forgot password" round trip).
 *   - Once signed in, lets the user save the CURRENT form configuration (the
 *     panel on the left — same fields app.js already reads into its own
 *     `state`) as a persistent, per-user row in the `alerts` table.
 *   - Lists, disables/re-enables, and deletes the signed-in user's own saved
 *     alerts. Row-Level Security (see database/schema.sql) is what actually
 *     enforces "own" here — this file just calls the Supabase client the
 *     same way for every user; the database guarantees isolation.
 *   - Bridges the existing in-browser trigger detection (app.js's
 *     fireAlert(), which already works correctly for both real and
 *     simulated sources as of Phase 5/6) to the most recently saved alert:
 *     when a trigger fires while a saved alert matching the current session
 *     is being monitored, this file logs a `notifications` row and marks
 *     that alert TRIGGERED. This is a best-effort client-side bridge, NOT
 *     the real Phase 8 server-side evaluation — see the header comment on
 *     backend/db/supabaseClient.js and SUPABASE_SETUP.md for why a saved
 *     alert only actually gets checked while this specific browser tab has
 *     the matching configuration open and monitoring, same limitation the
 *     project brief itself notes for Phase 1 browser notifications
 *     ("a fully closed browser won't receive Phase 1 alerts").
 */

(() => {
  "use strict";

  const CONDITION_LABELS = {
    AT_OR_BELOW: "At or below target",
    BELOW: "Below target",
    REACHES: "Reaches target exactly",
    ABOVE: "Above target",
    PCT_CHANGE: "Changes by X%",
  };

  const NOTIFICATION_LABELS = {
    browser: "🔔 Browser (this tab only)",
    email: "✉️ Email",
    telegram: "📨 Telegram",
    push: "📲 Push (works even closed)",
    whatsapp: "WhatsApp",
    sms: "SMS",
  };

  const $ = (id) => document.getElementById(id);
  // Mirrors app.js's own escapeHtml() exactly — not exposed via window.CKM,
  // so duplicated here rather than reaching into that file's closure.
  const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  let sb = null; // Supabase client, once configured
  let currentSession = null;
  // Desktop-only "form hidden until requested" mode (28-Aug-2026,
  // requested) -- true once the auto-collapse below has run once for
  // this page load, so a later updateAuthUI() call (a token refresh,
  // etc.) never re-hides a form panel the user already revealed.
  let formPanelAutoCollapseApplied = false;
  let activeTab = "login"; // "login" | "signup" — which form is showing when signed out
  let awaitingPasswordReset = false; // true between a PASSWORD_RECOVERY event and a successful updateUser({password})
  // Phase 13 — the alert (row id) currently loaded into the form for
  // editing, or null when "Save current alert" would create a NEW alert.
  // myAlertsCache holds the last list loaded from Supabase so the Edit
  // button can hand a full row straight to loadAlertIntoForm() without an
  // extra round trip.
  let editingAlertId = null;
  let myAlertsCache = [];
  // Phase 16 (23-Aug-2026) — the alert (row id) currently loaded into the
  // form/hero/chart, whether that happened via startEditingAlert() (the
  // user clicked "Edit") or the loadMyAlerts() auto-sync (see that
  // function's own comment). Lets updateAlertLiveRates() below recognize
  // "this saved-alert card IS the one driving the hero right now" and
  // reuse the hero's own already-computed reading for it instead of
  // independently re-computing one — see that function's comment for why.
  let loadedAlertId = null;

  function isConfigured() {
    const url = window.CKM_SUPABASE_URL;
    const key = window.CKM_SUPABASE_ANON_KEY;
    return (
      typeof url === "string" && url && url !== "YOUR_SUPABASE_PROJECT_URL" &&
      typeof key === "string" && key && key !== "YOUR_SUPABASE_ANON_KEY" &&
      typeof window.supabase !== "undefined" && typeof window.supabase.createClient === "function"
    );
  }

  function showConfigNotice(message) {
    const notice = $("authConfigNotice");
    const pill = $("authStatusPill");
    if (notice) { notice.style.display = "block"; notice.textContent = message; }
    ["authTabs", "loginForm", "signupForm", "resetPasswordForm"].forEach((id) => {
      const el = $(id);
      if (el) el.style.display = "none";
    });
    if (pill) { pill.className = "status-pill mock"; pill.textContent = "Not configured"; }
  }

  function setLoginStatus(msg) {
    const el = $("loginFormStatus");
    if (el) el.textContent = msg || "";
  }

  function setSignupStatus(msg) {
    const el = $("signupFormStatus");
    if (el) el.textContent = msg || "";
  }

  function setResetStatus(msg) {
    const el = $("resetPasswordStatus");
    if (el) el.textContent = msg || "";
  }

  function setSaveStatus(msg) {
    const el = $("saveAlertStatus");
    if (el) el.textContent = msg || "";
  }

  // -------------------------------------------------------------------------
  // Auth UI
  // -------------------------------------------------------------------------

  function showActiveTab() {
    const loginForm = $("loginForm");
    const signupForm = $("signupForm");
    const tabLogin = $("authTabLogin");
    const tabSignup = $("authTabSignup");
    if (loginForm) loginForm.style.display = activeTab === "login" ? "block" : "none";
    if (signupForm) signupForm.style.display = activeTab === "signup" ? "block" : "none";
    if (tabLogin) tabLogin.setAttribute("aria-pressed", activeTab === "login" ? "true" : "false");
    if (tabSignup) tabSignup.setAttribute("aria-pressed", activeTab === "signup" ? "true" : "false");
  }

  // Empties every email/password input across all three auth forms. Needed
  // because switching which form is visible (showActiveTab) only ever
  // toggled CSS display — the actual <input> elements stayed in the DOM
  // the whole time with whatever was last typed into them, so a password
  // typed once would silently keep reappearing after sign-out or after
  // flipping back to a tab, with nothing having actually cleared it.
  function clearAuthForms() {
    ["loginEmail", "loginPassword", "signupEmail", "signupPassword", "signupPasswordConfirm", "newPassword"]
      .forEach((id) => {
        const el = $(id);
        if (el) el.value = "";
      });
  }

  function switchTab(tab) {
    activeTab = tab === "signup" ? "signup" : "login";
    setLoginStatus("");
    setSignupStatus("");
    clearAuthForms();
    showActiveTab();
  }

  function updateAuthUI(session) {
    currentSession = session || null;
    const pill = $("authStatusPill");
    const authTabs = $("authTabs");
    const loginForm = $("loginForm");
    const signupForm = $("signupForm");
    const resetForm = $("resetPasswordForm");
    const signedInPanel = $("signedInPanel");
    // Phase 13.1 — lives in the form panel now (right below "Reset alert"),
    // not in this account card, but it's only meaningful once signed in, so
    // it's shown/hidden in lockstep with signedInPanel everywhere below.
    const saveAlertSection = $("saveAlertSection");

    // Password-recovery takes over the card regardless of session state —
    // Supabase issues a real (temporary) session as part of the recovery
    // link, which would otherwise make this function think the user is
    // just normally signed in and show the alerts panel instead of letting
    // them actually set a new password.
    if (awaitingPasswordReset) {
      if (pill) { pill.className = "status-pill mock"; pill.textContent = "Set new password"; }
      if (authTabs) authTabs.style.display = "none";
      if (loginForm) loginForm.style.display = "none";
      if (signupForm) signupForm.style.display = "none";
      if (resetForm) resetForm.style.display = "block";
      if (signedInPanel) signedInPanel.style.display = "none";
      if (saveAlertSection) saveAlertSection.style.display = "none";
      return;
    }

    if (currentSession && currentSession.user) {
      if (pill) { pill.className = "status-pill live"; pill.textContent = "🟢 Signed in"; }
      if (authTabs) authTabs.style.display = "none";
      if (loginForm) loginForm.style.display = "none";
      if (signupForm) signupForm.style.display = "none";
      if (resetForm) resetForm.style.display = "none";
      if (signedInPanel) signedInPanel.style.display = "block";
      if (saveAlertSection) saveAlertSection.style.display = "block";
      const emailEl = $("authUserEmail");
      if (emailEl) emailEl.textContent = currentSession.user.email || "(no email on session)";
      loadMyAlerts();

      // Desktop-only "form hidden until requested" mode: above 880px the
      // form panel is a persistent sticky sidebar (see styles.css) -- for
      // a signed-in returning desktop user who already has saved alerts,
      // collapse it by default the first time we learn this page load is
      // signed in, revealed again only via the "+ Build Your Alert" link
      // (see wireForm() below). Deliberately gated on being signed in:
      // that link only exists inside signedInPanel, so a signed-OUT
      // visitor must never have the form collapsed with no way to bring
      // it back -- the anonymous build-a-preview-alert flow stays exactly
      // as it was. Mobile is untouched: the class below only does
      // anything under the existing min-width: 881px rule in styles.css.
      if (!formPanelAutoCollapseApplied) {
        formPanelAutoCollapseApplied = true;
        if (window.matchMedia && window.matchMedia("(min-width: 881px)").matches) {
          const layoutEl = document.querySelector(".layout");
          if (layoutEl) layoutEl.classList.add("form-panel-hidden");
        }
      }
    } else {
      if (pill) { pill.className = "status-pill mock"; pill.textContent = "Not signed in"; }
      if (authTabs) authTabs.style.display = "flex";
      if (resetForm) resetForm.style.display = "none";
      showActiveTab();
      if (signedInPanel) signedInPanel.style.display = "none";
      if (saveAlertSection) saveAlertSection.style.display = "none";
      stopEditingAlert(); // signed out mid-edit shouldn't leave a stale "Editing..." banner for the next sign-in

      // Bug fix (23-Aug-2026, Phase 17): this is the ONE place that runs
      // whenever the session becomes null, for ANY reason — the user
      // clicking "Sign out" (signOut() below ALSO does this immediately,
      // for instant UI feedback without waiting on the round trip), a token
      // expiring, or another tab signing the same account out. Before this
      // fix, myAlertsCache/loadedAlertId only got cleared inside signOut()
      // itself — so any OTHER path to a null session left the "Best
      // available rate" rows and "My Saved Alerts" list showing the
      // PREVIOUS account's stale data even though the page now correctly
      // says "Not signed in" everywhere else. Clearing it here instead
      // closes that gap for every cause, not just the one button.
      if (myAlertsCache.length > 0 || loadedAlertId !== null) {
        myAlertsCache = [];
        loadedAlertId = null;
        renderAlertsList([]);
        renderHeroRows();
        syncSavedCurrencyUI();
      }
    }
  }

  // Clean base URL (origin + path only) — deliberately excludes any
  // hash/query from the current address bar. Using window.location.href
  // directly here was a real bug: once a callback ever lands on this page
  // with #error=... (e.g. an expired/already-used link), that hash stays
  // in the address bar (nothing was clearing it — see clearAuthHash()
  // below, added at the same time as this fix). If a *second* email is
  // then requested from the same tab without a manual reload,
  // window.location.href at that moment already contains the old
  // "#error=..." fragment, so it gets sent to Supabase as emailRedirectTo /
  // redirectTo. Supabase's own redirect then appends ITS
  // "#access_token=..." (or "#error=...") onto a URL that already has a
  // "#" in it — a URL can only have one real fragment, so everything after
  // the second "#" is not parsed the way the Supabase JS client expects,
  // and the callback can fail even on a click made within seconds of a
  // genuinely fresh link. Used both by sign-up's confirmation email and by
  // "forgot password"'s reset email.
  function cleanRedirectUrl() {
    return window.location.origin + window.location.pathname;
  }

  // Strip any leftover #access_token=... / #error=... from the address bar
  // after we've handled it, so it can never be picked up by a later
  // emailRedirectTo/redirectTo: window.location.href-style call (see above)
  // or simply confuse the user into thinking a fresh attempt already failed.
  function clearAuthHash() {
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }

  // Surface a Supabase auth callback error (e.g. #error=access_denied&
  // error_code=otp_expired&error_description=...) in the log-in form
  // instead of leaving the user staring at a raw URL fragment with no
  // explanation in the UI. Applies to both an expired email-confirmation
  // link and an expired password-reset link.
  function reportHashError() {
    const hash = window.location.hash;
    if (!hash || hash.indexOf("error=") === -1) return false;
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    const code = params.get("error_code");
    const description = params.get("error_description");
    const friendly = code === "otp_expired"
      ? "That link expired or was already used — request a new one below."
      : `Sign-in failed: ${description ? description.replace(/\+/g, " ") : code || "unknown error"}.`;
    setLoginStatus(friendly);
    return true;
  }

  async function logIn(email, password) {
    setLoginStatus("Signing in…");
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      // Supabase returns the SAME generic "Invalid login credentials" for
      // both a wrong password and an account that hasn't clicked its
      // confirmation-email link yet — it deliberately doesn't say which,
      // so a wrong guess here can't be used to probe whether an email is
      // registered. Cover both real causes in one message rather than
      // wrongly telling someone their password is bad when the actual
      // issue is an unconfirmed account.
      const friendly = /invalid login credentials/i.test(error.message)
        ? "Incorrect email or password — or, if you just signed up, your account may still need email confirmation first (check your inbox)."
        : /email not confirmed/i.test(error.message)
          ? "Please confirm your email first — check your inbox for the confirmation link we sent when you signed up."
          : error.message;
      setLoginStatus(friendly);
      return;
    }
    setLoginStatus("");
    // No further action needed here — onAuthStateChange (wired in init())
    // fires on a successful sign-in and calls updateAuthUI() itself.
  }

  // Why this is a plain Supabase Auth signUp() and NOT a user table stored
  // as a file in this repo: a public GitHub repo has no real access
  // control — anyone can read any committed file — so a repo-stored
  // credentials table would be visible to the entire internet, which
  // defeats the point of having a password at all and directly
  // contradicts this project's own "never expose credentials" rule.
  // Supabase Auth hashes and stores the password server-side, behind its
  // own access controls; this app never sees or persists a plaintext
  // password anywhere, in the repo or otherwise.
  async function signUp(email, password, confirmPassword) {
    if (password !== confirmPassword) {
      setSignupStatus("Passwords don't match.");
      return;
    }
    if (password.length < 6) {
      setSignupStatus("Password must be at least 6 characters.");
      return;
    }
    setSignupStatus("Creating account…");
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: cleanRedirectUrl() },
    });
    if (error) {
      const friendly = /already registered|already exists|user already/i.test(error.message)
        ? "An account with that email already exists — switch to the Log in tab instead."
        : error.message;
      setSignupStatus(friendly);
      return;
    }
    if (data && data.session) {
      // This Supabase project has "Confirm email" turned off, so signUp()
      // already returns a live session — the account is immediately usable.
      setSignupStatus("Account created — you're signed in.");
      return;
    }
    // switchTab() clears both forms' status messages as its first step (so
    // stale text from one form never lingers when you flip to the other) —
    // that means setting this message BEFORE switching tabs got wiped out
    // immediately, and the user landed on a blank Log in form with no
    // explanation of why signing in right away wouldn't work yet. Setting
    // it on the login form's own status line, after the switch, is what
    // actually keeps it on screen.
    switchTab("login");
    setLoginStatus(`Account created. Check ${email} for a confirmation link, then log in.`);
  }

  async function forgotPassword(email) {
    if (!email) {
      setLoginStatus('Enter your email above first, then click "Forgot password?".');
      return;
    }
    setLoginStatus("Sending password reset link…");
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: cleanRedirectUrl(),
    });
    if (error) {
      setLoginStatus(`Could not send reset link: ${error.message}`);
      return;
    }
    setLoginStatus(`Password reset link sent to ${email} — check your inbox.`);
  }

  async function submitNewPassword(password) {
    if (password.length < 6) {
      setResetStatus("Password must be at least 6 characters.");
      return;
    }
    setResetStatus("Saving new password…");
    const { error } = await sb.auth.updateUser({ password });
    if (error) {
      setResetStatus(`Could not update password: ${error.message}`);
      return;
    }
    awaitingPasswordReset = false;
    clearAuthHash();
    updateAuthUI(currentSession);
  }

  async function signOut() {
    await sb.auth.signOut();
    setSaveStatus("");
    activeTab = "login";
    clearAuthForms();
    showActiveTab();
    myAlertsCache = [];
    loadedAlertId = null;
    renderHeroRows(); // switches "Best available rate" back to the single-alert view now that myAlertsCache is empty
    syncSavedCurrencyUI(); // empties and collapses both chip rows, and clears the Supabase watch list, for the same reason
    stopEditingAlert(); // clears editingAlertId and resets the Save button/banner for the next sign-in
    // Bug fix (23-Aug-2026): without this, state.userEditedForm stays true
    // for the rest of the browser tab's life once any field has ever been
    // touched, which would silently disable the loadMyAlerts() auto-sync
    // fix above for whichever account signs in next in this same tab —
    // reintroducing the exact hero/saved-alert mismatch this fix exists to
    // prevent, just for the next user instead of the first.
    if (typeof window.CKM !== "undefined" && typeof window.CKM.getState === "function") {
      window.CKM.getState().userEditedForm = false;
    }
  }

  // -------------------------------------------------------------------------
  // Alerts CRUD
  // -------------------------------------------------------------------------

  function describeAlert(a) {
    // Phase 25 (25-Aug-2026) bug fix — reported: "My Money Master + Taj
    // Muhabath + merchantradeasia + jalinanduta (AEON MALL CHERAS
    // SELATAN)" — a Taj Muhabath branch appearing to belong to Jalinan
    // Duta, which has no branches at all. Root cause: this function used
    // to join every source name into one string FIRST, then blindly
    // append " (branch)" to the end of that whole string — correct only
    // by coincidence, back when Taj Muhabath (the only source that has
    // ever had a branch) always happened to be the LAST item in
    // a.sources. Adding Jalinan Duta after it (Phase 24) broke that
    // coincidence. Fixed by attaching the branch to the specific source
    // token it actually belongs to — via window.CKM.getBranchSupportedSourceIds()
    // (app.js, reading each source's own supportsBranch flag) — so this is
    // correct regardless of array order or how many more sources get
    // added later.
    const branchSupportedIds = (typeof window.CKM !== "undefined" && typeof window.CKM.getBranchSupportedSourceIds === "function")
      ? window.CKM.getBranchSupportedSourceIds()
      : ["tajmuhabath"]; // conservative fallback matching today's only branch-supporting source, if the bridge is ever unavailable

    const sources = Array.isArray(a.sources)
      ? a.sources.map((s) => {
          const label = (typeof window.CKM !== "undefined" && typeof window.CKM.getSourceName === "function")
            ? window.CKM.getSourceName(s)
            : s;
          return (a.branch && branchSupportedIds.includes(s)) ? `${label} (${a.branch})` : label;
        }).join(" + ")
      : "—";
    const cond = CONDITION_LABELS[a.condition] || a.condition;
    // Phase 11: notification_methods is an array — any combination may be
    // selected, all delivered simultaneously (see backend/scheduler/run.js's
    // resolveNotifyTargets()). Falls back to the old singular
    // notification_method column so a row saved before the Phase 11 DB
    // migration ran still displays something sensible instead of "—".
    const methods = Array.isArray(a.notification_methods)
      ? a.notification_methods
      : (a.notification_method ? [a.notification_method] : []);
    const notif = methods.length
      ? methods.map((m) => NOTIFICATION_LABELS[m] || m).join(" + ")
      : "—";
    return { sources, cond, notif };
  }

  function statusPillClass(status) {
    if (status === "TRIGGERED") return "status-pill reached";
    if (status === "DISABLED") return "status-pill error";
    return "status-pill live";
  }

  function renderAlertsList(alerts) {
    const list = $("myAlertsList");
    if (!list) return;
    if (!alerts || alerts.length === 0) {
      list.innerHTML = `<li class="alert-empty">No saved alerts yet — build one on the left, then click "Save current alert to my account" above.</li>`;
      return;
    }
    list.innerHTML = alerts.map((a) => {
      const { sources, cond, notif } = describeAlert(a);
      return `
        <li class="alert-item" data-id="${a.id}">
          <div class="alert-item-main">
            <div class="alert-item-title">${a.currency} ${a.rate_type} <span class="tabular">${Number(a.target_rate).toFixed(4).replace(/0+$/,"").replace(/\.$/,"")}</span></div>
            <div class="alert-item-sub">${cond} · ${sources}</div>
            <div class="alert-item-sub">${notif}</div>
            <div class="alert-item-live" data-live-for="${a.id}">Checking live rate…</div>
          </div>
          <div class="alert-item-side">
            <span class="${statusPillClass(a.status)}" style="font-size:.7rem;">${a.status}</span>
            <div class="alert-item-actions">
              <button type="button" class="alert-action" data-action="edit" data-id="${a.id}">Edit</button>
              ${a.status === "DISABLED"
                ? `<button type="button" class="alert-action" data-action="enable" data-id="${a.id}">Enable</button>`
                : `<button type="button" class="alert-action" data-action="disable" data-id="${a.id}">Disable</button>`}
              <button type="button" class="alert-action alert-action-danger" data-action="delete" data-id="${a.id}">Delete</button>
            </div>
          </div>
        </li>`;
    }).join("");
    // NOTE: updateAlertLiveRates() is deliberately NOT called here. It's
    // called at the end of loadMyAlerts() instead, AFTER the auto-sync
    // block below has had a chance to set `loadedAlertId` and load this
    // alert's config into `state` — calling it this early would run before
    // that happens on a fresh sign-in, so the alert that's ABOUT to become
    // the hero's alert would briefly be treated as "not the loaded one" and
    // get an extra, independent (walk-diverging) reading computed for it.

    list.querySelectorAll(".alert-action").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        const action = btn.dataset.action;

        // Edit is a pure client-side form-fill — no network call, so it
        // doesn't go through the disable/try/catch dance below (and must
        // NOT disable the button, since nothing async happens to re-enable
        // it afterwards).
        if (action === "edit") {
          startEditingAlert(id);
          return;
        }

        btn.disabled = true;
        try {
          if (action === "delete") {
            if (!window.confirm("Delete this saved alert? This can't be undone.")) { btn.disabled = false; return; }
            await sb.from("alerts").delete().eq("id", id);
            // Editing an alert that just got deleted (e.g. from another tab,
            // or the user deleted the very one they had open) would leave
            // the form silently pointed at a row that no longer exists —
            // the next Save would fail with a confusing "0 rows updated".
            if (String(editingAlertId) === String(id)) stopEditingAlert();
          } else if (action === "disable") {
            await sb.from("alerts").update({ status: "DISABLED" }).eq("id", id);
          } else if (action === "enable") {
            await sb.from("alerts").update({ status: "ACTIVE" }).eq("id", id);
          }
          await loadMyAlerts();
        } catch (err) {
          setSaveStatus(`Action failed: ${err.message}`);
          btn.disabled = false;
        }
      });
    });
  }

  /**
   * Phase 16/17 (23-Aug-2026) — shared by both updateAlertLiveRates() (the
   * one-line live rate on each "My Saved Alerts" card) and renderHeroRows()
   * (the multi-alert "Best available rate" table): computes what to show
   * for ONE saved alert right now. Returns `{ disabled: true }` for a
   * disabled alert, `null` when the alert has no money changer selected,
   * or `{ valid, formatted, value, origin, invalidReason, best }` — same
   * shape computeAlertReading() itself returns.
   *
   * If this alert is the one currently loaded into the hero/chart (see
   * loadedAlertId), reuses tick()'s own already-computed reading instead of
   * calling computeAlertReading() a second time for it — see the comment
   * where lastHeroReading is set in app.js's tick() for why (avoids
   * double-advancing a shared simulated-source random walk, which would
   * otherwise make the exact same alert show two different numbers in two
   * different places on the page at once).
   */
  function getAlertDisplayReading(a) {
    if (a.status === "DISABLED") return { disabled: true };
    if (typeof window.CKM === "undefined" || typeof window.CKM.computeAlertReading !== "function") return null;

    const heroReading = typeof window.CKM.getLastHeroReading === "function" ? window.CKM.getLastHeroReading() : null;
    const alertSourceIds = (Array.isArray(a.sources) ? a.sources : []).slice().sort();
    const isLoadedAlert =
      String(a.id) === String(loadedAlertId) &&
      heroReading &&
      heroReading.currency === a.currency &&
      heroReading.rateType === a.rate_type &&
      heroReading.branch === (a.branch || null) &&
      JSON.stringify(heroReading.sourceIds) === JSON.stringify(alertSourceIds);

    if (isLoadedAlert) {
      return { valid: heroReading.valid, formatted: heroReading.formatted, value: heroReading.value,
        origin: heroReading.best.origin, invalidReason: heroReading.best.invalidReason, best: heroReading.best };
    }
    return window.CKM.computeAlertReading(a);
  }

  /**
   * Bug fix (26-Aug-2026, reported): a STALE reading — the backend's own
   * scheduled job hasn't run recently enough for LIVE_DATA_FRESHNESS_MS to
   * still call it current (see app.js's buildRealReadingFromEntry()) —
   * still carries a REAL last-known buyRate/sellRate; validateReading()
   * only marks it `valid: false` so it can never be used to actually
   * evaluate/fire an alert, not because the number itself is missing. But
   * both call sites below were treating ANY invalid reading identically —
   * STALE (has a real number, just aging) and genuinely SOURCE_UNAVAILABLE/
   * EXTRACTION_ERROR (no number at all) both collapsed to a bare "⚠
   * Unavailable" with the number hidden. That directly contradicts this
   * app's own written requirement (PROJECT INSTRUCTIONS section 22 —
   * "Instead display: Last successful rate: 60.53 / Retrieved: 12:50 PM /
   * Current status: SOURCE UNAVAILABLE", never just blank it out) and made
   * the "Best Available Rate" card visibly disagree with the Multi-Source
   * Comparison table right below it for the exact same alert — that table
   * (app.js's renderCompareTable()) already correctly shows the stale
   * number with a 🟠 STALE badge; this was the one place that didn't.
   * Returns null when there's genuinely no last-known number to fall back
   * to (a true SOURCE_UNAVAILABLE/EXTRACTION_ERROR), so callers can tell
   * the two cases apart.
   */
  function staleFallbackReading(a, result) {
    if (!result || !result.best || result.best.status !== "STALE") return null;
    const value = a.rate_type === "SELL" ? result.best.sellRate : result.best.buyRate;
    if (value == null) return null;
    const fmt = (typeof window.CKM !== "undefined" && typeof window.CKM.formatRateFor === "function")
      ? window.CKM.formatRateFor
      : (v) => Number(v).toFixed(2);
    return { value, formatted: fmt(value, a.currency), sourceName: result.best.sourceName, branch: result.best.branch };
  }

  /**
   * Phase 16 (23-Aug-2026): fills in each saved-alert card's own live/
   * simulated rate — see window.CKM.computeAlertReading()'s comment in
   * app.js for why this exists (previously only whichever ONE alert was
   * loaded into the hero ever showed a live number, even with several
   * saved alerts for different currencies). Updates just the one
   * `[data-live-for]` node per alert rather than re-rendering the whole
   * list, so this can run on a timer without disturbing button state or
   * in-flight click handlers, and is called once right after every
   * renderAlertsList() plus on its own short interval (see init() below)
   * so the numbers keep moving between full list refreshes too.
   */
  function updateAlertLiveRates() {
    const list = $("myAlertsList");
    if (!list) return;

    myAlertsCache.forEach((a) => {
      const el = list.querySelector(`[data-live-for="${a.id}"]`);
      if (!el) return;

      const result = getAlertDisplayReading(a);
      if (result && result.disabled) {
        el.textContent = "Disabled — not currently being checked.";
        el.className = "alert-item-live";
        return;
      }
      if (!result) {
        el.textContent = "No money changer selected.";
        el.className = "alert-item-live";
        return;
      }
      if (!result.valid) {
        const stale = staleFallbackReading(a, result);
        if (stale) {
          el.textContent = `🟠 STALE ${a.rate_type} ${stale.formatted} · ${stale.sourceName}${stale.branch ? " — " + stale.branch : ""} — ${result.invalidReason || "last successful check is aging"}`;
        } else {
          el.textContent = `⚠ ${result.invalidReason || "Could not get a valid rate right now"}`;
        }
        el.className = "alert-item-live alert-item-live-error";
        return;
      }
      const isReal = result.origin === "REAL";
      el.textContent = `${isReal ? "🟢 LIVE" : "🧪 SIMULATED"} ${a.rate_type} ${result.formatted} · ${result.best.sourceName}`;
      el.className = "alert-item-live" + (isReal ? " alert-item-live-real" : " alert-item-live-sim");
    });
  }

  /**
   * Phase 17 (23-Aug-2026) — user request: "I want all the currencies in
   * My Saved Alerts ... also showing row by row in the Best Available Rate
   * For Your Alert section." The hero card used to be able to show only
   * ONE alert's live number at a time (whichever was "loaded" — see
   * loadedAlertId). This replaces that single view with one row per SAVED
   * alert whenever the user has any, so every currency they're watching
   * (now and anything added later — this iterates myAlertsCache, nothing
   * here is hardcoded to a specific currency or count) is visible at once
   * without picking one. Falls back to the original single-alert view
   * (see index.html's #heroSingle) when signed out or with zero saved
   * alerts, since there's nothing yet to list and that view still serves
   * its original purpose: a live preview of whatever's in the form below
   * while composing a first alert.
   */
  function renderHeroRows() {
    const single = $("heroSingle");
    const rows = $("heroRows");
    const rowsHeading = $("heroRowsHeading");
    const pairEl = $("heroPair");
    const pillEl = $("statusPill");
    const body = $("heroRowsBody");
    if (!single || !rows || !body) return;

    const hasAlerts = myAlertsCache.length > 0;
    single.style.display = hasAlerts ? "none" : "";
    rows.style.display = hasAlerts ? "" : "none";
    if (pairEl) pairEl.style.display = hasAlerts ? "none" : "";
    if (pillEl) pillEl.style.display = hasAlerts ? "none" : "";
    if (rowsHeading) {
      rowsHeading.style.display = hasAlerts ? "" : "none";
      // Phase 32 (26-Aug-2026) fix: requested — "Saved" capitalized, not
      // "saved", since this line is this card's own headline (right below
      // its "Best available rate for your alert" eyebrow), not a sentence
      // continuing that eyebrow's text.
      // Phase 36 (26-Aug-2026) follow-up: requested — every word in this
      // headline capitalized, not just "Saved" — "Alert"/"Alerts" too.
      rowsHeading.textContent = `${myAlertsCache.length} Saved Alert${myAlertsCache.length === 1 ? "" : "s"}`;
    }
    if (!hasAlerts) return;

    const fmt = (typeof window.CKM !== "undefined" && typeof window.CKM.formatRateFor === "function")
      ? window.CKM.formatRateFor
      : (v) => Number(v).toFixed(2);

    body.innerHTML = myAlertsCache.map((a) => {
      const { sources } = describeAlert(a);
      const target = Number(a.target_rate);
      const targetText = Number.isFinite(target) ? fmt(target, a.currency) : "—";
      const statusText = `<span class="${statusPillClass(a.status)}" style="font-size:.72rem;">${a.status}</span>`;

      const result = getAlertDisplayReading(a);
      let rateCell = "—", diffCell = "—", sourceCell = "—";

      if (result && result.disabled) {
        rateCell = `<span style="color:var(--ink-faint);">Disabled</span>`;
      } else if (!result) {
        rateCell = `<span style="color:var(--ink-faint);">No source selected</span>`;
      } else if (!result.valid) {
        const stale = staleFallbackReading(a, result);
        if (stale) {
          rateCell = `${stale.formatted} <span class="status-pill error" style="font-size:.68rem;" title="${(result.invalidReason || "").replace(/"/g, "&quot;")}">🟠 STALE</span>`;
          sourceCell = stale.sourceName + (stale.branch ? ` — ${stale.branch}` : "");
          if (Number.isFinite(target)) {
            const diff = stale.value - target;
            const diffColor = diff <= 0 ? "var(--up)" : "var(--down)";
            diffCell = `<span style="color:${diffColor};">${diff >= 0 ? "+" : ""}${fmt(diff, a.currency)}</span>`;
          }
        } else {
          rateCell = `<span class="alert-item-live-error" title="${(result.invalidReason || "").replace(/"/g, "&quot;")}">⚠ Unavailable</span>`;
        }
      } else {
        const isReal = result.origin === "REAL";
        const originTag = isReal
          ? '<span class="origin-tag origin-live">LIVE</span>'
          : '<span class="origin-tag origin-sim">SIM</span>';
        rateCell = `${fmt(result.value, a.currency)} ${originTag}`;
        sourceCell = result.best.sourceName + (result.best.branch ? ` — ${result.best.branch}` : "");
        if (Number.isFinite(target)) {
          const diff = result.value - target;
          const diffColor = diff <= 0 ? "var(--up)" : "var(--down)";
          diffCell = `<span style="color:${diffColor};">${diff >= 0 ? "+" : ""}${fmt(diff, a.currency)}</span>`;
        }
      }

      return `<tr>
        <td>
          <div style="font-weight:600;">${a.currency} ${a.rate_type} <span class="tabular">${targetText}</span></div>
          <div style="font-size:.72rem;color:var(--ink-faint);">${sources}</div>
        </td>
        <td class="num">${rateCell}</td>
        <td class="num">${targetText}</td>
        <td class="num">${diffCell}</td>
        <td>${statusText}</td>
        <td style="font-size:.78rem;">${sourceCell}</td>
      </tr>`;
    }).join("");
  }

  // -------------------------------------------------------------------------
  // Editing an existing saved alert (Phase 13)
  // -------------------------------------------------------------------------
  // "Edit" loads a saved alert's settings back into the form panel on the
  // left (via app.js's window.CKM.loadAlertIntoForm — see that file) so the
  // user can change them and save OVER the same alert, instead of only ever
  // being able to Disable/Delete and build a fresh one from scratch.

  function formatAlertLabel(a) {
    if (!a) return "";
    const target = Number(a.target_rate).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
    return `${a.currency} ${a.rate_type} ${target}`;
  }

  function updateEditingBanner() {
    const banner = $("editingBanner");
    const label = $("editingBannerLabel");
    const saveBtn = $("saveAlertBtn");
    if (editingAlertId) {
      const alert = myAlertsCache.find((a) => String(a.id) === String(editingAlertId));
      if (banner) banner.style.display = "flex";
      if (label) label.textContent = formatAlertLabel(alert);
      if (saveBtn) saveBtn.textContent = "💾 Update this alert";
    } else {
      if (banner) banner.style.display = "none";
      if (saveBtn) saveBtn.textContent = "💾 Save current alert to my account";
    }
  }

  // Desktop-only "form hidden until requested" mode: un-hides the form
  // panel if the auto-collapse from updateAuthUI() above is currently
  // active. Shared by every path that brings the user to the form --
  // "Edit" on a saved alert (startEditingAlert(), right below) and the
  // "+ Build Your Alert" shortcut (wireForm(), further down) -- so
  // neither one can strand the user scrolling to a form that's still
  // display:none. A no-op if the panel was never collapsed.
  function revealFormPanelIfHidden() {
    const layoutEl = document.querySelector(".layout");
    if (layoutEl) layoutEl.classList.remove("form-panel-hidden");
  }

  function startEditingAlert(id) {
    const alert = myAlertsCache.find((a) => String(a.id) === String(id));
    if (!alert) {
      setSaveStatus("Could not find that alert to edit — try reloading the page.");
      return;
    }
    if (typeof window.CKM === "undefined" || typeof window.CKM.loadAlertIntoForm !== "function") {
      setSaveStatus("Could not load the alert into the form — the dashboard script may not have loaded yet.");
      return;
    }
    editingAlertId = id;
    loadedAlertId = id;
    window.CKM.loadAlertIntoForm(alert);
    // Bug fix (23-Aug-2026): clicking "Edit" is just as deliberate a choice
    // of which alert belongs in the form/hero as typing into a field is —
    // but it never used to set state.userEditedForm itself. If the user
    // then clicked Save without ALSO touching some other field (a very
    // normal thing to do — re-saving an alert as-is, or only toggling a
    // checkbox that doesn't happen to be wired through wireForm()'s on()
    // handler for this exact purpose), userEditedForm was still false once
    // the save completed. loadMyAlerts()'s auto-sync (see its own comment)
    // then saw "not editing, form untouched" and silently reloaded the
    // user's NEWEST alert over the one they had just edited — e.g. editing
    // an older CNY alert and saving it would immediately snap the hero back
    // to a newer VND alert instead of staying on CNY. Marking the form
    // touched here, exactly like every real field handler already does,
    // closes that gap using the same mechanism instead of a new one.
    if (typeof window.CKM.getState === "function") window.CKM.getState().userEditedForm = true;
    updateEditingBanner();
    setSaveStatus("");
    revealFormPanelIfHidden();
    const formPanel = $("formPanel");
    if (formPanel) formPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function stopEditingAlert() {
    editingAlertId = null;
    updateEditingBanner();
  }

  // UX improvement (28-Aug-2026, requested after Android install testing):
  // after a save/update actually succeeds, bring the user back up to
  // "Your Account" (the whole card -- eyebrow/heading down through My
  // saved alerts) so they can see the alert they just saved land in the
  // list, instead of leaving them sitting at the form with only a small
  // status line as confirmation. Originally scrolled to just the "My
  // saved alerts" sub-heading; widened to the full card per follow-up
  // request the same day.
  function scrollToAccountCard() {
    const card = $("accountCard");
    if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Desktop-only "form hidden until requested" mode, follow-up (28-Aug-
  // 2026): the mirror image of revealFormPanelIfHidden() above -- re-
  // collapses the form panel after a successful save/update, so the
  // sidebar goes back to being tucked away rather than staying open
  // indefinitely once first revealed. Same >=881px gate as the initial
  // auto-collapse in updateAuthUI(); a no-op on mobile, where the class
  // has no visual effect anyway (see styles.css's min-width rule).
  function collapseFormPanelOnDesktop() {
    if (window.matchMedia && window.matchMedia("(min-width: 881px)").matches) {
      const layoutEl = document.querySelector(".layout");
      if (layoutEl) layoutEl.classList.add("form-panel-hidden");
    }
  }

  // ---------------------------------------------------------------------
  // Saved-currency chips (Phase 18) — a quick-switch row, sourced from the
  // signed-in user's own saved alerts, that drives what the Multi-source
  // comparison table and Rate history chart are currently showing. Both
  // of those cards read directly off app.js's `state.currency` (Rate
  // history via currentSelection() in rateHistory.js; the comparison
  // table via tick()/renderCompareTable() in app.js), so switching that
  // one value — via the same loadAlertIntoForm() bridge "Edit" already
  // uses — updates both cards from a single click.
  //
  // Deliberately NOT the same thing as startEditingAlert() above: this is
  // a VIEW switch, not an edit intent. It does not set editingAlertId, does
  // not show the "✏️ Editing…" banner, does not relabel Save as "Update
  // this alert", and does not scroll to the form — a user browsing their
  // CNY vs. VND comparison shouldn't look like (or accidentally become)
  // mid-edit of a saved alert.
  // ---------------------------------------------------------------------

  /** Unique currency codes across the signed-in user's saved alerts, in
   *  the same newest-first order loadMyAlerts() already sorts by. */
  function getSavedCurrencies() {
    const seen = new Set();
    const codes = [];
    myAlertsCache.forEach((a) => {
      if (a.currency && !seen.has(a.currency)) { seen.add(a.currency); codes.push(a.currency); }
    });
    return codes;
  }

  function selectSavedCurrency(code) {
    // If more than one saved alert shares this currency (e.g. CNY SELL and
    // CNY BUY), take the newest one — myAlertsCache is sorted newest-first
    // by loadMyAlerts()'s query, same "first match wins" convention the
    // sign-in auto-sync above already uses, so this isn't a new rule.
    const alert = myAlertsCache.find((a) => a.currency === code);
    if (!alert || typeof window.CKM === "undefined" || typeof window.CKM.loadAlertIntoForm !== "function") return;

    // One genuinely new risk this control introduces: unlike the sign-in
    // auto-sync (which only ever fires before the user has touched
    // anything), a chip is available to click AFTER the user has started
    // composing an unsaved edit. Warn instead of silently overwriting it —
    // same courtesy "Edit" gets implicitly, since clicking Edit is itself
    // the user's own deliberate choice, whereas a currency chip further
    // down the page is easy to click without remembering the form above
    // has unsaved changes in it.
    const state = window.CKM.getState ? window.CKM.getState() : null;
    const hadUnsavedEdit = !!(state && state.userEditedForm && !editingAlertId);

    window.CKM.loadAlertIntoForm(alert);
    loadedAlertId = alert.id;
    // loadAlertIntoForm() re-populates the form to match `alert`, which
    // counts as "the form now reflects saved data," not an in-progress
    // edit — so, unlike startEditingAlert(), userEditedForm is reset to
    // false rather than forced true. This keeps the sign-in auto-sync
    // (loadMyAlerts()'s canAutoSync check) able to keep following the
    // newest alert on a later refresh, exactly as if the user had simply
    // never touched the form at all.
    if (state) state.userEditedForm = false;

    if (hadUnsavedEdit && typeof window.CKM.showToast === "function") {
      window.CKM.showToast(`Switched to your saved ${code} alert — your unsaved form changes were replaced.`);
    }

    renderSavedCurrencyChips();
  }

  function renderSavedCurrencyChips() {
    const containers = [$("compareCurrencyChips"), $("historyCurrencyChips")].filter(Boolean);
    if (containers.length === 0) return;

    const codes = getSavedCurrencies();
    const activeCurrency = (typeof window.CKM !== "undefined" && typeof window.CKM.getState === "function")
      ? window.CKM.getState().currency
      : null;
    const getName = (typeof window.CKM !== "undefined" && typeof window.CKM.getCurrencyName === "function")
      ? window.CKM.getCurrencyName
      : (code) => code;

    const html = codes.map((code) => {
      const pressed = code === activeCurrency ? "true" : "false";
      return `<button type="button" class="chip-currency" data-currency="${code}"
                aria-pressed="${pressed}" title="${escapeHtml(getName(code))}">${escapeHtml(code)}</button>`;
    }).join("");

    containers.forEach((el) => { el.innerHTML = html; });
    containers.forEach((el) => {
      el.querySelectorAll(".chip-currency").forEach((btn) => {
        btn.addEventListener("click", () => selectSavedCurrency(btn.dataset.currency));
      });
    });
  }

  /**
   * Phase 21 (24-Aug-2026) — the single entry point for keeping BOTH
   * things derived from myAlertsCache's set of currencies in sync with
   * each other: the chip row above (which currencies can you click), and
   * app.js's Supabase live-rate cache (which currencies get kept fresh —
   * see app.js's window.CKM.setWatchedCurrencies() and its Phase 21
   * comment for the full "why": Phase 20 only kept the ACTIVE currency's
   * rates fresh, leaving every OTHER saved-alert row in the hero table
   * still on stale/deploy-time-only data).
   *
   * Deliberately one function calling both, rather than two separate
   * calls at every myAlertsCache-mutation site — the exact same reasoning
   * documented next to Phase 18's own call sites below: two things
   * derived from the same source data are far more likely to silently
   * drift apart if every caller has to remember to update both than if
   * there's exactly one place that does.
   */
  /**
   * Phase 21's original scope (chips + Supabase watch list) broadened in
   * Phase 22 to also cover the Activity Log's empty-state text (see
   * app.js's renderActivityLog() for why) — all three are derived from the
   * exact same two facts (signed in? which/how many saved alerts?), so one
   * function keeping all of them in sync, called from the same handful of
   * myAlertsCache-mutation sites, is far less error-prone than three
   * separate call sites each hoping the others remember to fire too.
   */
  function syncSavedCurrencyUI() {
    renderSavedCurrencyChips();
    if (typeof window.CKM !== "undefined" && typeof window.CKM.setWatchedCurrencies === "function") {
      window.CKM.setWatchedCurrencies(getSavedCurrencies());
    }
    if (typeof window.CKM !== "undefined" && typeof window.CKM.renderActivityLog === "function") {
      window.CKM.renderActivityLog();
    }
  }

  async function loadMyAlerts() {
    if (!sb || !currentSession) return;
    const { data, error } = await sb.from("alerts").select("*").order("created_at", { ascending: false });
    if (error) {
      setSaveStatus(`Could not load your alerts: ${error.message}`);
      return;
    }
    myAlertsCache = data || [];
    renderAlertsList(myAlertsCache);
    // The alert being edited may have changed shape (e.g. the background
    // trigger bridge just marked it TRIGGERED) — refresh the banner's label
    // so it never shows stale info, without disturbing the form itself.
    if (editingAlertId) updateEditingBanner();

    // Bug fix (23-Aug-2026) — reported: "My Saved Alerts" correctly showed
    // a saved alert's real target (e.g. CNY SELL 60.90), but the "Best
    // available rate for your alert" hero card right next to it showed
    // target 60.50 — the app's hardcoded demo default, from
    // frontend/app.js's `state.targetRate` initial value. Root cause: the
    // hero card always renders directly from that live in-memory `state`
    // object, which starts at the demo default and is otherwise only ever
    // changed by the user's own form edits, or by clicking "Edit" on a
    // saved alert (window.CKM.loadAlertIntoForm). A user who signs in and
    // has not yet touched the form in this browser tab was left looking at
    // two different numbers for what should be the same alert, with no
    // visible reason for the mismatch.
    //
    // Fix: as long as the user hasn't typed/clicked into any form field
    // this page load (state.userEditedForm — see wireForm() in app.js) and
    // isn't already mid-edit of a specific alert, silently load their most
    // recently created alert (myAlertsCache[0] — this query is sorted
    // newest-first) into the form/hero via the same loadAlertIntoForm()
    // the Edit button already uses. This runs every time this function
    // does (sign-in, and after save/delete/disable/enable), but
    // state.userEditedForm makes it a no-op the instant the user starts
    // composing their own edit (a brand-new alert, or a change to an
    // existing one), so it can never overwrite in-progress work.
    //
    // The mirror-image case (23-Aug-2026, part 2): if the count just
    // dropped to ZERO — e.g. the user deleted their only saved alert —
    // and they still haven't touched the form, reset it back to the plain
    // demo defaults instead of silently leaving it on whatever the
    // now-deleted alert's numbers were. Without this, the hero card would
    // keep showing a "live"-looking target/rate for an alert that no
    // longer exists, with My Saved Alerts right next to it correctly
    // saying "No saved alerts yet" — the exact same kind of two-sources-
    // of-truth mismatch as the original bug, just reached by a delete
    // instead of a fresh sign-in.
    const canAutoSync =
      !editingAlertId &&
      typeof window.CKM !== "undefined" &&
      typeof window.CKM.getState === "function" &&
      !window.CKM.getState().userEditedForm;
    if (canAutoSync && myAlertsCache.length > 0 && typeof window.CKM.loadAlertIntoForm === "function") {
      window.CKM.loadAlertIntoForm(myAlertsCache[0]);
      loadedAlertId = myAlertsCache[0].id;
    } else if (canAutoSync && myAlertsCache.length === 0 && typeof window.CKM.resetFormToDefaults === "function") {
      window.CKM.resetFormToDefaults();
      loadedAlertId = null;
    }

    // Now that loadedAlertId (and, via loadAlertIntoForm's own trailing
    // tick() call, the hero's own reading) are both settled for this
    // refresh, it's safe to fill in every card's live-rate line — see this
    // function's own comment above for why this can't happen any earlier.
    updateAlertLiveRates();
    renderHeroRows();
    syncSavedCurrencyUI();
  }

  async function saveCurrentAlert() {
    if (!sb || !currentSession) return;
    if (typeof window.CKM === "undefined" || typeof window.CKM.getState !== "function") {
      setSaveStatus("Could not read the current form — the dashboard script may not have loaded yet.");
      return;
    }
    const state = window.CKM.getState();
    const sources = Object.keys(state.sources || {}).filter((k) => state.sources[k]);
    // Phase 11: any combination of channels may be checked at once — this
    // is now a filtered list, not a single selected value, matching
    // `sources`' own pattern immediately above.
    const notificationMethods = Object.keys(state.notifications || {}).filter((k) => state.notifications[k]);
    if (sources.length === 0) {
      setSaveStatus("Select at least one money changer in the panel on the left before saving.");
      return;
    }
    if (notificationMethods.length === 0) {
      setSaveStatus("Select at least one notification method in the panel on the left before saving.");
      return;
    }
    if (!(state.targetRate > 0)) {
      setSaveStatus("Enter a target rate greater than zero in the panel on the left before saving.");
      return;
    }
    if (notificationMethods.includes("telegram") && !(state.telegramChatId || "").trim()) {
      setSaveStatus('Enter your Telegram chat ID in the panel on the left before saving a Telegram alert — see "Connecting Telegram" in NOTIFICATIONS_SETUP.md if you don\'t have it yet.');
      return;
    }
    // Phase 39: mirrors the Telegram guard above exactly, for the same
    // reason — never save an alert that claims a channel is active with
    // nothing behind it. Unlike Telegram's chat ID (typed by the user),
    // a push subscription can only come from a real, successful
    // PushManager.subscribe() call on THIS device (see frontend/push.js) —
    // there's nothing for the user to type around this guard, which is
    // deliberate: it should be impossible to save a Push alert that was
    // never actually subscribed.
    if (notificationMethods.includes("push") && !state.pushSubscription) {
      setSaveStatus('Enable Push notifications (check the Push box above and allow the permission prompt) before saving a Push alert.');
      return;
    }

    const row = {
      currency: state.currency,
      rate_type: state.rateType,
      target_rate: state.targetRate,
      condition: state.condition,
      pct_change_threshold: state.condition === "PCT_CHANGE" ? state.pctChange : null,
      sources,
      branch: sources.includes("tajmuhabath") ? state.branch : null,
      monitoring_interval_minutes: state.interval,
      notification_methods: notificationMethods,
      // Phase 10: only meaningful (and only ever sent) when Telegram is one
      // of the checked channels — never write a stray chat ID onto an
      // alert that didn't select Telegram.
      telegram_chat_id: notificationMethods.includes("telegram") ? state.telegramChatId.trim() : null,
      // Phase 39: same "only when selected" rule as telegram_chat_id above.
      push_subscription: notificationMethods.includes("push") ? state.pushSubscription : null,
      // Re-arm on every save, including an edit of a DISABLED/TRIGGERED
      // alert — matches how the rest of this app treats "save"/"reset" as
      // meaning "start watching again from here" (see handleAlertReset()).
      status: "ACTIVE",
    };

    // Phase 13: editingAlertId set means this save is an UPDATE to an
    // existing alert (via the "Edit" button below), not a new INSERT.
    if (editingAlertId) {
      setSaveStatus("Updating…");
      const { data, error } = await sb.from("alerts").update(row).eq("id", editingAlertId).select().single();
      if (error) {
        setSaveStatus(`Could not update: ${error.message}`);
        return;
      }
      loadedAlertId = data.id;
      setSaveStatus("Updated. Your changes are saved.");
      stopEditingAlert();
      await loadMyAlerts();
      collapseFormPanelOnDesktop();
      scrollToAccountCard();
      return;
    }

    setSaveStatus("Saving…");
    const { data, error } = await sb.from("alerts").insert(row).select().single();
    if (error) {
      setSaveStatus(`Could not save: ${error.message}`);
      return;
    }
    loadedAlertId = data.id;
    setSaveStatus("Saved. This alert is now yours, isolated from any other account.");
    await loadMyAlerts();
    collapseFormPanelOnDesktop();
    scrollToAccountCard();
  }

  // -------------------------------------------------------------------------
  // Bridge to app.js's live trigger detection (see the hooks app.js exposes
  // via window.CKM — "Phase 7 integration bridge" comment in that file).
  // -------------------------------------------------------------------------

  /**
   * Phase 19 bug fix (23-Aug-2026) — reported: after the Phase 18
   * saved-currency chips shipped, switching which saved alert was loaded
   * into the form (via a chip, or via the pre-existing "Edit" button)
   * without immediately re-saving could cause a trigger event for the
   * alert actually being monitored to instead mark a DIFFERENT saved
   * alert TRIGGERED in the database — specifically, whichever alert had
   * most recently been explicitly saved via the Save/Update button. Real
   * example from the report: a genuine CNY trigger got written onto a
   * THB alert that was nowhere near its own target, because THB happened
   * to be the last one saved.
   *
   * Root cause: handleAlertTriggered()/handleAlertReset() below used to
   * write to `linkedAlertId`, a variable only ever updated at SAVE time.
   * `loadedAlertId` (used elsewhere in this file, e.g.
   * getAlertDisplayReading()'s isLoadedAlert check) IS updated at every
   * LOAD — Edit, a saved-currency chip, or the sign-in auto-sync — but
   * was never wired into the actual database write the trigger bridge
   * performs. This resolves which alert a trigger/reset event applies to
   * at the moment it fires, from `loadedAlertId`, but only after
   * confirming that cached row's currency/rate type/branch/sources still
   * match the LIVE form state — the same match check
   * getAlertDisplayReading() already applies for its own display purposes,
   * so the two can't drift apart again. If the form has since diverged
   * from that alert (e.g. a field was tweaked without saving), this
   * returns null and the caller cleanly skips the write rather than
   * guessing and mislabeling a different alert — this project's core
   * "never silently mislabel data" rule applies here just as much as it
   * does to a scraped rate.
   */
  function resolveLoadedAlertId() {
    if (!loadedAlertId) return null;
    if (typeof window.CKM === "undefined" || typeof window.CKM.getState !== "function") return null;
    const alert = myAlertsCache.find((a) => String(a.id) === String(loadedAlertId));
    if (!alert) return null;

    const state = window.CKM.getState();
    const alertSourceIds = (Array.isArray(alert.sources) ? alert.sources : []).slice().sort();
    const stateSourceIds = Object.keys(state.sources || {}).filter((k) => state.sources[k]).sort();

    const matches =
      alert.currency === state.currency &&
      alert.rate_type === state.rateType &&
      (alert.branch || null) === (state.branch || null) &&
      JSON.stringify(alertSourceIds) === JSON.stringify(stateSourceIds);

    return matches ? alert.id : null;
  }

  async function handleAlertTriggered(reading, value) {
    const targetAlertId = resolveLoadedAlertId();
    if (!sb || !currentSession || !targetAlertId) return; // not signed in, or the form no longer matches a saved alert
    try {
      await sb.from("alerts").update({ status: "TRIGGERED" }).eq("id", targetAlertId);
      await sb.from("notifications").insert({
        alert_id: targetAlertId,
        notification_type: "browser",
        delivery_status: "DELIVERED",
        message: `${reading.origin === "REAL" ? "LIVE" : "SIMULATED"} — ${reading.sourceName} ${reading.currency} target reached at ${value}.`,
      });
      await loadMyAlerts();
    } catch (err) {
      // Never let a Supabase hiccup interrupt the in-browser alert the user
      // already saw fire correctly (toast/log/notification) — that's the
      // core Phase 1-6 behavior and it must keep working regardless.
    }
  }

  function handleAlertReset() {
    const targetAlertId = resolveLoadedAlertId();
    if (!sb || !currentSession || !targetAlertId) return;
    sb.from("alerts").update({ status: "ACTIVE" }).eq("id", targetAlertId).then(() => loadMyAlerts());
  }

  // -------------------------------------------------------------------------
  // Wiring
  // -------------------------------------------------------------------------

  function wireForm() {
    const tabLogin = $("authTabLogin");
    const tabSignup = $("authTabSignup");
    if (tabLogin) tabLogin.addEventListener("click", () => switchTab("login"));
    if (tabSignup) tabSignup.addEventListener("click", () => switchTab("signup"));

    const loginForm = $("loginForm");
    if (loginForm) {
      loginForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const email = ($("loginEmail").value || "").trim();
        const password = $("loginPassword").value || "";
        if (!email || !password) return;
        logIn(email, password);
      });
    }

    const signupForm = $("signupForm");
    if (signupForm) {
      signupForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const email = ($("signupEmail").value || "").trim();
        const password = $("signupPassword").value || "";
        const confirmPassword = $("signupPasswordConfirm").value || "";
        if (!email || !password) return;
        signUp(email, password, confirmPassword);
      });
    }

    const forgotLink = $("forgotPasswordLink");
    if (forgotLink) {
      forgotLink.addEventListener("click", (e) => {
        e.preventDefault();
        const email = ($("loginEmail").value || "").trim();
        forgotPassword(email);
      });
    }

    const resetForm = $("resetPasswordForm");
    if (resetForm) {
      resetForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const password = $("newPassword").value || "";
        if (!password) return;
        submitNewPassword(password);
      });
    }

    const signOutBtn = $("signOutBtn");
    if (signOutBtn) signOutBtn.addEventListener("click", signOut);

    const saveBtn = $("saveAlertBtn");
    if (saveBtn) saveBtn.addEventListener("click", saveCurrentAlert);

    const cancelEditBtn = $("cancelEditBtn");
    if (cancelEditBtn) cancelEditBtn.addEventListener("click", stopEditingAlert);

    // Desktop-only "form hidden until requested" mode: reveal the form
    // panel again (see updateAuthUI() above for where it gets collapsed)
    // and scroll to it. preventDefault + manual scrollIntoView, rather
    // than relying on the anchor's native href="#formHeading" jump, so
    // the reveal (removing display:none) is guaranteed to have already
    // happened before the browser tries to scroll there -- letting the
    // native jump fire first/instead on a hidden element would land on a
    // zero-height target. Harmless no-op if the panel was never
    // collapsed in the first place (signed out, or mobile width).
    const buildAlertShortcut = document.querySelector(".build-alert-shortcut");
    if (buildAlertShortcut) {
      buildAlertShortcut.addEventListener("click", (e) => {
        const layoutEl = document.querySelector(".layout");
        if (layoutEl && layoutEl.classList.contains("form-panel-hidden")) {
          e.preventDefault();
          revealFormPanelIfHidden();
          const formPanel = $("formPanel");
          if (formPanel) formPanel.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        // else: panel already visible (or never collapsed) -- let the
        // native #formHeading anchor jump handle it as before.
      });
    }
  }

  function init() {
    wireForm();

    // Force every auth field empty on every fresh page load. Without this,
    // the browser's own saved-password autofill (separate from anything
    // this app's JS does — see clearAuthForms()'s other two call sites)
    // can silently repopulate loginEmail/loginPassword as soon as the page
    // renders, before any of this script has run. A page reload is a real
    // navigation, so nothing about the earlier sign-out/tab-switch fix
    // touches this case — it needs its own explicit clear. Runs twice: once
    // immediately (covers the common case) and once after a short delay
    // (covers browsers that apply autofill slightly after initial paint).
    clearAuthForms();
    setTimeout(clearAuthForms, 300);

    if (!isConfigured()) {
      showConfigNotice(
        'Supabase isn\'t configured yet — fill in frontend/supabaseConfig.js with your project URL and anon key ' +
        '(see SUPABASE_SETUP.md) to enable saved, per-user alerts. Everything else on this dashboard works fine without it.'
      );
      return;
    }

    sb = window.supabase.createClient(window.CKM_SUPABASE_URL, window.CKM_SUPABASE_ANON_KEY);

    if (typeof window.CKM !== "undefined") {
      window.CKM.onAlertTriggered = handleAlertTriggered;
      window.CKM.onAlertReset = handleAlertReset;
      // Phase 18 — keeps the saved-currency chips' aria-pressed highlighting
      // correct even when currency changes via the plain form dropdown
      // rather than via a chip click (see app.js's onCurrencyChanged calls).
      window.CKM.onCurrencyChanged = renderSavedCurrencyChips;
      // Phase 25 (25-Aug-2026) bug fix: reported — a user with 2 saved
      // alerts (2 currencies) saw the Activity Log say "You have 1 active
      // saved alert," which read as a bug/miscount. It wasn't a miscount:
      // per backend/scheduler/run.js's own header comment, an alert that
      // has already TRIGGERED is deliberately excluded from every
      // subsequent scheduler run's query ("don't re-fire"), so it
      // genuinely stops being "actively checked" the moment it fires —
      // activeSavedAlerts only ever counted status === 'ACTIVE' rows, and
      // this user's 2nd alert had already triggered by the time they
      // looked. The count itself (getMonitoringContext, added Phase 22)
      // was correct; the message just never explained WHY it could differ
      // from the total saved count, so a correct number looked wrong.
      // Fix: return the full breakdown (active/triggered/disabled) instead
      // of a single number, so app.js's renderActivityLog() can spell out
      // exactly why, instead of asserting a bare count the person has no
      // way to reconcile against what they actually see in "My saved
      // alerts" just above it.
      window.CKM.getMonitoringContext = () => {
        const counts = { active: 0, triggered: 0, disabled: 0 };
        myAlertsCache.forEach((a) => {
          if (a.status === "ACTIVE") counts.active++;
          else if (a.status === "TRIGGERED") counts.triggered++;
          else if (a.status === "DISABLED") counts.disabled++;
        });
        return {
          signedIn: !!currentSession,
          totalSavedAlerts: myAlertsCache.length,
          activeSavedAlerts: counts.active, // kept for anything still reading this exact field
          ...counts,
        };
      };
    }

    // Show a friendly message for a failed callback (e.g. expired/reused
    // confirmation or reset link) instead of leaving a raw #error=... in
    // the address bar — then always strip the hash so it can't leak into a
    // later emailRedirectTo/redirectTo (see cleanRedirectUrl()'s comment
    // above).
    const hadError = reportHashError();

    sb.auth.onAuthStateChange((event, session) => {
      // Fires when the user lands here via a "forgot password" email link —
      // Supabase's JS client parses the recovery token out of the URL and
      // establishes a temporary session automatically; this flag makes
      // updateAuthUI() show the "set new password" form instead of treating
      // that temporary session as a normal sign-in.
      if (event === "PASSWORD_RECOVERY") {
        awaitingPasswordReset = true;
      }
      updateAuthUI(session);
      clearAuthHash();
    });
    sb.auth.getSession().then(({ data }) => {
      updateAuthUI(data ? data.session : null);
      if (hadError) clearAuthHash();
    });

    // Phase 16/17 (23-Aug-2026): keep every saved alert's own live-rate
    // line — both on its "My Saved Alerts" card and its row in the
    // "Best available rate" table — moving between full loadMyAlerts()
    // refreshes, same 4-second cadence as app.js's own tick() so nothing on
    // the page feels out of sync. A no-op whenever there are no saved
    // alerts or nothing is signed in — see updateAlertLiveRates()'s and
    // renderHeroRows()'s own early returns.
    setInterval(() => { updateAlertLiveRates(); renderHeroRows(); }, 4000);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
