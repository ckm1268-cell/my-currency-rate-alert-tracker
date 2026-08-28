/**
 * Admin Module (Phase 45 / v3) — frontend/admin.js
 * =================================================
 * Backs frontend/admin.html. A separate page from the main dashboard (not
 * a tab inside index.html), reached via the "🛡️ Admin" link auth.js shows
 * in the topbar to signed-in Super Users only.
 *
 * Every actual disable/enable/delete/list call goes through the
 * `admin-users` Supabase Edge Function (supabase/functions/admin-users) —
 * this file never touches the service-role key and never could: the anon
 * key it uses can't perform any of these actions on its own. The role
 * check this file does client-side (readOwnRole()) is UX only, to decide
 * whether to show the panel or an "Access denied" message — the Edge
 * Function re-checks the caller's role itself on every request and is the
 * actual security boundary. See that file's header comment for the full
 * security model.
 */

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const escapeHtml = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  let sb = null;
  let self = null; // { id, email }
  let allUsers = []; // last list result from the Edge Function
  let pendingConfirmAction = null; // 'disable' | 'enable' | 'delete', while the confirm dialog is open

  function isConfigured() {
    return (
      typeof window.CKM_SUPABASE_URL === "string" &&
      window.CKM_SUPABASE_URL &&
      !window.CKM_SUPABASE_URL.includes("YOUR-PROJECT") &&
      typeof window.supabase !== "undefined" &&
      typeof window.supabase.createClient === "function"
    );
  }

  function showOnly(id) {
    ["adminLoading", "adminSignedOut", "adminDenied", "adminNotConfigured", "adminPanel"].forEach((cardId) => {
      const el = $(cardId);
      if (el) el.style.display = cardId === id ? "" : "none";
    });
  }

  function showToast(message) {
    const toast = $("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.style.display = "block";
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      toast.style.display = "none";
    }, 4000);
  }

  async function callAdminFunction(payload) {
    const { data, error } = await sb.functions.invoke("admin-users", { body: payload });
    if (error) {
      // supabase-js surfaces a non-2xx response as `error`, with the
      // parsed JSON body (when present) on error.context — try to pull a
      // real message out of it rather than showing a generic failure.
      let message = error.message || "Request failed.";
      try {
        const body = await error.context?.json?.();
        if (body?.error) message = body.error;
      } catch (_) {
        // ignore — fall back to error.message above
      }
      throw new Error(message);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async function loadUsers() {
    const tbody = $("usersTableBody");
    tbody.innerHTML = `<tr><td colspan="6" class="admin-empty-row">Loading users…</td></tr>`;
    try {
      const data = await callAdminFunction({ action: "list" });
      allUsers = data.users || [];
      renderUsers();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" class="admin-empty-row">⚠ Could not load users: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function renderUsers() {
    const tbody = $("usersTableBody");
    const filter = ($("userSearch").value || "").trim().toLowerCase();
    const rows = allUsers.filter((u) => !filter || (u.email || "").toLowerCase().includes(filter));

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="admin-empty-row">No matching users.</td></tr>`;
      updateToolbarState();
      return;
    }

    tbody.innerHTML = rows
      .map((u) => {
        const isSelf = u.id === self.id;
        const created = u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—";
        const lastSignIn = u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleString() : "Never";
        return `
        <tr class="${isSelf ? "admin-self-row" : ""}" data-user-id="${escapeHtml(u.id)}">
          <td>
            <input type="checkbox" class="user-row-checkbox" data-user-id="${escapeHtml(u.id)}"
              aria-label="Select ${escapeHtml(u.email || u.id)}" ${isSelf ? "disabled title=\"You can't act on your own account\"" : ""}>
          </td>
          <td class="admin-email-cell">${escapeHtml(u.email || "(no email)")}${isSelf ? " <em>(you)</em>" : ""}</td>
          <td><span class="admin-role-pill role-${escapeHtml(u.role)}">${escapeHtml(u.role)}</span></td>
          <td><span class="admin-status-pill ${u.disabled ? "status-disabled" : "status-active"}">${u.disabled ? "Disabled" : "Active"}</span></td>
          <td>${escapeHtml(created)}</td>
          <td>${escapeHtml(lastSignIn)}</td>
        </tr>`;
      })
      .join("");

    tbody.querySelectorAll(".user-row-checkbox").forEach((cb) => {
      cb.addEventListener("change", updateToolbarState);
    });
    updateToolbarState();
  }

  function getSelectedIds() {
    return Array.from(document.querySelectorAll(".user-row-checkbox:checked")).map((cb) => cb.dataset.userId);
  }

  function updateToolbarState() {
    const selected = getSelectedIds();
    $("selectedCount").textContent = `${selected.length} selected`;
    $("disableSelectedBtn").disabled = selected.length === 0;
    $("enableSelectedBtn").disabled = selected.length === 0;
    $("deleteSelectedBtn").disabled = selected.length === 0;

    const visibleCheckboxes = Array.from(document.querySelectorAll(".user-row-checkbox:not(:disabled)"));
    const allChecked = visibleCheckboxes.length > 0 && visibleCheckboxes.every((cb) => cb.checked);
    $("selectAllCheckbox").checked = allChecked;
  }

  function emailsFor(ids) {
    return ids.map((id) => allUsers.find((u) => u.id === id)?.email || id);
  }

  function openConfirm(action, ids) {
    pendingConfirmAction = action;
    const emails = emailsFor(ids);
    const verb = { disable: "disable", enable: "re-enable", delete: "permanently delete" }[action];
    $("confirmTitle").textContent = `Confirm: ${verb} ${ids.length} account${ids.length === 1 ? "" : "s"}`;
    $("confirmBody").textContent =
      action === "delete"
        ? "This permanently deletes each account and all of its saved alerts and notification history. This cannot be undone."
        : `This will ${verb} sign-in for the accounts listed below.`;
    $("confirmUserList").innerHTML = emails.map((e) => `<li>${escapeHtml(e)}</li>`).join("");
    $("confirmProceedBtn").textContent = action === "delete" ? "Yes, delete permanently" : `Yes, ${verb}`;
    $("confirmOverlay").style.display = "flex";
    $("confirmOverlay").dataset.userIds = JSON.stringify(ids);
  }

  function closeConfirm() {
    $("confirmOverlay").style.display = "none";
    pendingConfirmAction = null;
  }

  async function runBulkAction(action, ids) {
    const resultsEl = $("actionResults");
    resultsEl.style.display = "block";
    resultsEl.innerHTML = `<p class="lede">Running ${escapeHtml(action)} on ${ids.length} account(s)…</p>`;

    try {
      const data = await callAdminFunction({ action, userIds: ids });
      const results = data.results || [];
      const summary = results.reduce(
        (acc, r) => {
          acc[r.result] = (acc[r.result] || 0) + 1;
          return acc;
        },
        { SUCCESS: 0, FAILED: 0, SKIPPED: 0 }
      );
      resultsEl.innerHTML = `
        <h4>Result: ${summary.SUCCESS} succeeded, ${summary.FAILED} failed, ${summary.SKIPPED} skipped</h4>
        <ul>
          ${results
            .map((r) => {
              const cls = r.result === "SUCCESS" ? "admin-result-success" : r.result === "FAILED" ? "admin-result-failed" : "admin-result-skipped";
              const label = escapeHtml(r.email || r.userId);
              const extra = r.message ? ` — ${escapeHtml(r.message)}` : "";
              return `<li class="${cls}">${label}: ${escapeHtml(r.result)}${extra}</li>`;
            })
            .join("")}
        </ul>`;
      showToast(`${action} complete: ${summary.SUCCESS} succeeded, ${summary.FAILED} failed, ${summary.SKIPPED} skipped.`);
    } catch (err) {
      resultsEl.innerHTML = `<p class="admin-result-failed">⚠ ${escapeHtml(err.message)}</p>`;
      showToast(`Action failed: ${err.message}`);
    }

    await loadUsers();
    await loadActivityLog();
  }

  async function loadActivityLog() {
    const el = $("adminActivityLog");
    try {
      const { data, error } = await sb
        .from("admin_actions")
        .select("action, target_email, admin_email, result, error_message, created_at")
        .order("created_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      if (!data || data.length === 0) {
        el.innerHTML = `<p class="lede">No admin actions recorded yet.</p>`;
        return;
      }
      el.innerHTML = data
        .map((row) => {
          const time = new Date(row.created_at).toLocaleString();
          const who = escapeHtml(row.admin_email || "—");
          const what = escapeHtml(row.action);
          const target = escapeHtml(row.target_email || "—");
          const errSuffix = row.error_message ? ` (${escapeHtml(row.error_message)})` : "";
          return `
          <div class="admin-activity-row">
            <span class="admin-activity-time">${escapeHtml(time)}</span>
            <span class="admin-activity-badge ${escapeHtml(row.result)}">${escapeHtml(row.result)}</span>
            <span>${who} ${what} ${target}${errSuffix}</span>
          </div>`;
        })
        .join("");
    } catch (err) {
      el.innerHTML = `<p class="lede">Could not load activity log: ${escapeHtml(err.message)}</p>`;
    }
  }

  function wireEvents() {
    $("userSearch").addEventListener("input", renderUsers);
    $("refreshUsersBtn").addEventListener("click", () => {
      loadUsers();
      loadActivityLog();
    });

    $("selectAllCheckbox").addEventListener("change", (e) => {
      document.querySelectorAll(".user-row-checkbox:not(:disabled)").forEach((cb) => {
        cb.checked = e.target.checked;
      });
      updateToolbarState();
    });

    $("disableSelectedBtn").addEventListener("click", () => openConfirm("disable", getSelectedIds()));
    $("enableSelectedBtn").addEventListener("click", () => openConfirm("enable", getSelectedIds()));
    $("deleteSelectedBtn").addEventListener("click", () => openConfirm("delete", getSelectedIds()));

    $("confirmCancelBtn").addEventListener("click", closeConfirm);
    $("confirmOverlay").addEventListener("click", (e) => {
      if (e.target === $("confirmOverlay")) closeConfirm();
    });
    $("confirmProceedBtn").addEventListener("click", () => {
      const ids = JSON.parse($("confirmOverlay").dataset.userIds || "[]");
      const action = pendingConfirmAction;
      closeConfirm();
      if (action && ids.length > 0) runBulkAction(action, ids);
    });
  }

  async function init() {
    if (!isConfigured()) {
      showOnly("adminNotConfigured");
      return;
    }

    sb = window.supabase.createClient(window.CKM_SUPABASE_URL, window.CKM_SUPABASE_ANON_KEY);

    const {
      data: { session },
    } = await sb.auth.getSession();

    if (!session) {
      showOnly("adminSignedOut");
      return;
    }

    self = { id: session.user.id, email: session.user.email };

    const { data: profile, error: profileErr } = await sb
      .from("profiles")
      .select("role")
      .eq("user_id", self.id)
      .maybeSingle();

    if (profileErr || !profile || profile.role !== "admin") {
      showOnly("adminDenied");
      return;
    }

    $("adminSelfEmail").textContent = self.email || "—";
    showOnly("adminPanel");
    wireEvents();
    await loadUsers();
    await loadActivityLog();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
