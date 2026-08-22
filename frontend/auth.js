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
 * What this file does:
 *   - Renders a sign-in / signed-in panel in the "accountCard" markup in
 *     index.html, using Supabase Auth's magic-link (passwordless email) flow.
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
    const form = $("signInForm");
    const pill = $("authStatusPill");
    if (notice) { notice.style.display = "block"; notice.textContent = message; }
    if (form) form.style.display = "none";
    if (pill) { pill.className = "status-pill mock"; pill.textContent = "Not configured"; }
  }

  function setAuthFormStatus(msg) {
    const el = $("authFormStatus");
    if (el) el.textContent = msg || "";
  }

  function setSaveStatus(msg) {
    const el = $("saveAlertStatus");
    if (el) el.textContent = msg || "";
  }

  // -------------------------------------------------------------------------
  // Auth UI
  // -------------------------------------------------------------------------

  function updateAuthUI(session) {
    currentSession = session || null;
    const pill = $("authStatusPill");
    const signInForm = $("signInForm");
    const signedInPanel = $("signedInPanel");

    if (currentSession && currentSession.user) {
      if (pill) { pill.className = "status-pill live"; pill.textContent = "🟢 Signed in"; }
      if (signInForm) signInForm.style.display = "none";
      if (signedInPanel) signedInPanel.style.display = "block";
      const emailEl = $("authUserEmail");
      if (emailEl) emailEl.textContent = currentSession.user.email || "(no email on session)";
      loadMyAlerts();
    } else {
      if (pill) { pill.className = "status-pill mock"; pill.textContent = "Not signed in"; }
      if (signInForm) signInForm.style.display = "block";
      if (signedInPanel) signedInPanel.style.display = "none";
      linkedAlertId = null;
    }
  }

  // Clean base URL (origin + path only) — deliberately excludes any
  // hash/query from the current address bar. Using window.location.href
  // directly here was a real bug: once a callback ever lands on this page
  // with #error=... (e.g. an expired/already-used magic link), that hash
  // stays in the address bar (nothing was clearing it — see clearAuthHash()
  // below, added at the same time as this fix). If a *second* magic link is
  // then requested from the same tab without a manual reload,
  // window.location.href at that moment already contains the old
  // "#error=..." fragment, so it gets sent to Supabase as emailRedirectTo.
  // Supabase's own redirect then appends ITS "#access_token=..." (or
  // "#error=...") onto a URL that already has a "#" in it — a URL can only
  // have one real fragment, so everything after the second "#" is not
  // parsed the way the Supabase JS client expects, and the callback can
  // fail even on a click made within seconds of a genuinely fresh link.
  function cleanRedirectUrl() {
    return window.location.origin + window.location.pathname;
  }

  // Strip any leftover #access_token=... / #error=... from the address bar
  // after we've handled it, so it can never be picked up by a later
  // emailRedirectTo: window.location.href-style call (see above) or simply
  // confuse the user into thinking a fresh attempt already failed.
  function clearAuthHash() {
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }

  // Surface a Supabase auth callback error (e.g. #error=access_denied&
  // error_code=otp_expired&error_description=...) in the sign-in form
  // instead of leaving the user staring at a raw URL fragment with no
  // explanation in the UI.
  function reportHashError() {
    const hash = window.location.hash;
    if (!hash || hash.indexOf("error=") === -1) return false;
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    const code = params.get("error_code");
    const description = params.get("error_description");
    const friendly = code === "otp_expired"
      ? "That magic link expired or was already used — request a new one below and click it right away (use the most recent email if you requested more than one)."
      : `Sign-in failed: ${description ? description.replace(/\+/g, " ") : code || "unknown error"}.`;
    setAuthFormStatus(friendly);
    return true;
  }

  async function sendMagicLink(email) {
    setAuthFormStatus("Sending magic link…");
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: cleanRedirectUrl() },
    });
    if (error) {
      setAuthFormStatus(`Could not send magic link: ${error.message}`);
      return;
    }
    setAuthFormStatus(`Magic link sent to ${email} — check your inbox and click the link to sign in.`);
  }

  async function signOut() {
    await sb.auth.signOut();
    setSaveStatus("");
  }

  // -------------------------------------------------------------------------
  // Alerts CRUD
  // -------------------------------------------------------------------------

  function describeAlert(a) {
    const sources = Array.isArray(a.sources) ? a.sources.map((s) => SOURCE_LABELS[s] || s).join(" + ") : "—";
    const branch = a.branch ? ` (${a.branch})` : "";
    const cond = CONDITION_LABELS[a.condition] || a.condition;
    const notif = NOTIFICATION_LABELS[a.notification_method] || a.notification_method;
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
        btn.disabled = true;
        try {
          if (action === "delete") {
            if (!window.confirm("Delete this saved alert? This can't be undone.")) { btn.disabled = false; return; }
            await sb.from("alerts").delete().eq("id", id);
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

  async function loadMyAlerts() {
    if (!sb || !currentSession) return;
    const { data, error } = await sb.from("alerts").select("*").order("created_at", { ascending: false });
    if (error) {
      setSaveStatus(`Could not load your alerts: ${error.message}`);
      return;
    }
    renderAlertsList(data);
  }

  async function saveCurrentAlert() {
    if (!sb || !currentSession) return;
    if (typeof window.CKM === "undefined" || typeof window.CKM.getState !== "function") {
      setSaveStatus("Could not read the current form — the dashboard script may not have loaded yet.");
      return;
    }
    const state = window.CKM.getState();
    const sources = Object.keys(state.sources || {}).filter((k) => state.sources[k]);
    if (sources.length === 0) {
      setSaveStatus("Select at least one money changer in the panel on the left before saving.");
      return;
    }
    if (!(state.targetRate > 0)) {
      setSaveStatus("Enter a target rate greater than zero in the panel on the left before saving.");
      return;
    }
    if (state.notification === "telegram" && !(state.telegramChatId || "").trim()) {
      setSaveStatus('Enter your Telegram chat ID in the panel on the left before saving a Telegram alert — see "Connecting Telegram" in NOTIFICATIONS_SETUP.md if you don\'t have it yet.');
      return;
    }

    setSaveStatus("Saving…");
    const row = {
      currency: state.currency,
      rate_type: state.rateType,
      target_rate: state.targetRate,
      condition: state.condition,
      pct_change_threshold: state.condition === "PCT_CHANGE" ? state.pctChange : null,
      sources,
      branch: sources.includes("tajmuhabath") ? state.branch : null,
      monitoring_interval_minutes: state.interval,
      notification_method: state.notification,
      // Phase 10: only meaningful (and only ever sent) when Telegram is the
      // chosen channel — never write a stray chat ID onto a browser/email alert.
      telegram_chat_id: state.notification === "telegram" ? state.telegramChatId.trim() : null,
      status: "ACTIVE",
    };

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
    const form = $("signInForm");
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const email = ($("authEmail").value || "").trim();
        if (!email) return;
        sendMagicLink(email);
      });
    }
    const signOutBtn = $("signOutBtn");
    if (signOutBtn) signOutBtn.addEventListener("click", signOut);

    const saveBtn = $("saveAlertBtn");
    if (saveBtn) saveBtn.addEventListener("click", saveCurrentAlert);
  }

  function init() {
    wireForm();

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
    // magic link) instead of leaving a raw #error=... in the address bar —
    // then always strip the hash so it can't leak into a later
    // emailRedirectTo (see cleanRedirectUrl()'s comment above).
    const hadError = reportHashError();

    sb.auth.onAuthStateChange((_event, session) => {
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
