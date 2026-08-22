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

  const SOURCE_LABELS = {
    mymoneymaster: "My Money Master",
    tajmuhabath: "Taj Muhabath",
  };

  const NOTIFICATION_LABELS = {
    browser: "🔔 Browser (this tab only)",
    email: "✉️ Email",
    telegram: "📨 Telegram",
    whatsapp: "WhatsApp",
    sms: "SMS",
  };

  const $ = (id) => document.getElementById(id);

  let sb = null; // Supabase client, once configured
  let currentSession = null;
  let linkedAlertId = null; // most recently saved alert id, for the trigger bridge
  let activeTab = "login"; // "login" | "signup" — which form is showing when signed out
  let awaitingPasswordReset = false; // true between a PASSWORD_RECOVERY event and a successful updateUser({password})
  // Phase 13 — the alert (row id) currently loaded into the form for
  // editing, or null when "Save current alert" would create a NEW alert.
  // myAlertsCache holds the last list loaded from Supabase so the Edit
  // button can hand a full row straight to loadAlertIntoForm() without an
  // extra round trip.
  let editingAlertId = null;
  let myAlertsCache = [];

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
    } else {
      if (pill) { pill.className = "status-pill mock"; pill.textContent = "Not signed in"; }
      if (authTabs) authTabs.style.display = "flex";
      if (resetForm) resetForm.style.display = "none";
      showActiveTab();
      if (signedInPanel) signedInPanel.style.display = "none";
      if (saveAlertSection) saveAlertSection.style.display = "none";
      linkedAlertId = null;
      stopEditingAlert(); // signed out mid-edit shouldn't leave a stale "Editing..." banner for the next sign-in
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
    stopEditingAlert(); // clears editingAlertId and resets the Save button/banner for the next sign-in
  }

  // -------------------------------------------------------------------------
  // Alerts CRUD
  // -------------------------------------------------------------------------

  function describeAlert(a) {
    const sources = Array.isArray(a.sources) ? a.sources.map((s) => SOURCE_LABELS[s] || s).join(" + ") : "—";
    const branch = a.branch ? ` (${a.branch})` : "";
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
    return { sources: sources + branch, cond, notif };
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
    window.CKM.loadAlertIntoForm(alert);
    updateEditingBanner();
    setSaveStatus("");
    const formPanel = $("formPanel");
    if (formPanel) formPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function stopEditingAlert() {
    editingAlertId = null;
    updateEditingBanner();
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
      linkedAlertId = data.id;
      setSaveStatus("Updated. Your changes are saved.");
      stopEditingAlert();
      await loadMyAlerts();
      return;
    }

    setSaveStatus("Saving…");
    const { data, error } = await sb.from("alerts").insert(row).select().single();
    if (error) {
      setSaveStatus(`Could not save: ${error.message}`);
      return;
    }
    linkedAlertId = data.id;
    setSaveStatus("Saved. This alert is now yours, isolated from any other account.");
    await loadMyAlerts();
  }

  // -------------------------------------------------------------------------
  // Bridge to app.js's live trigger detection (see the hooks app.js exposes
  // via window.CKM — "Phase 7 integration bridge" comment in that file).
  // -------------------------------------------------------------------------

  async function handleAlertTriggered(reading, value) {
    if (!sb || !currentSession || !linkedAlertId) return; // nothing to bridge if not signed in / nothing saved
    try {
      await sb.from("alerts").update({ status: "TRIGGERED" }).eq("id", linkedAlertId);
      await sb.from("notifications").insert({
        alert_id: linkedAlertId,
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
    if (!sb || !currentSession || !linkedAlertId) return;
    sb.from("alerts").update({ status: "ACTIVE" }).eq("id", linkedAlertId).then(() => loadMyAlerts());
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
  }

  document.addEventListener("DOMContentLoaded", init);
})();
