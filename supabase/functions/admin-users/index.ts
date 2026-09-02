// =============================================================================
// MY Currency Rate Tracker — Admin Module (Phase 45 / v3)
// =============================================================================
// Supabase Edge Function: supabase/functions/admin-users
//
// Why this exists: bulk-disabling, re-enabling, and deleting user accounts
// requires Supabase's Auth Admin API, which only ever works with the
// service-role key — a key that must NEVER reach the browser (it bypasses
// every Row-Level Security policy in database/schema.sql entirely). This
// app's frontend is static GitHub Pages with no server of its own (see
// backend/scheduler/run.js and its GitHub Actions cron for the only other
// place a privileged key is used, and note that mechanism is a scheduled
// batch job, not something a button click can call synchronously). A
// Supabase Edge Function is the standard fix: it runs server-side, holds
// the service-role key as a Supabase secret (set via `supabase secrets
// set`, never committed to this repo — see ADMIN_SETUP.md), and is called
// over HTTPS from frontend/admin.js using the caller's own short-lived
// session token, not the service-role key itself.
//
// Security model — read this before changing anything below:
//   1. The caller's Authorization: Bearer <access_token> header (their own
//      signed-in session, the same one supabase-js already manages) is
//      used to look up who they are via admin.auth.getUser(jwt).
//   2. Their role is then read from public.profiles — NOT trusted from
//      anything the client sent in the request body. A request claiming
//      `{"isAdmin": true}` in its JSON body would be meaningless; only the
//      server-side profiles.role lookup below decides authorization.
//   3. Only when that lookup returns role === 'admin' does any action run.
//      frontend/admin.js also checks the caller's own profile before even
//      showing the Admin UI, but that check is UX only (avoids flashing
//      admin controls at a non-admin for a moment) — THIS function's check
//      is the actual security boundary, and re-runs on every single call.
//   4. A caller can never target their own account (self-disable/-delete
//      is blocked outright) — this exists purely to prevent an admin from
//      accidentally locking themselves out with no other admin to fix it.
//   5. Every action attempt (success, failure, or a blocked self-action)
//      is written to public.admin_actions for an audit trail, using the
//      same service-role client — see database/schema.sql's Phase 45
//      block for that table's RLS (admins can read it; nothing else can
//      write to it except this function).
//
// Deploy with the Supabase CLI (`supabase functions deploy admin-users`)
// after `supabase secrets set SERVICE_ROLE_KEY=... ALLOWED_ORIGIN=...`
// — full walkthrough in ADMIN_SETUP.md. SUPABASE_URL is provided
// automatically by the Supabase Edge Functions runtime and does not need
// to be set by hand.
//
// Note on the secret's name: this reads a custom `SERVICE_ROLE_KEY`
// secret, NOT the legacy auto-injected `SUPABASE_SERVICE_ROLE_KEY`. The
// Supabase CLI refuses to let you set any secret starting with
// `SUPABASE_` (that prefix is reserved for the platform's own
// auto-injected values), and as of Aug-2026 this project migrated off
// the legacy JWT-based service_role key entirely — the value you set
// here should be your project's current `sb_secret_...` key from
// Project Settings -> API Keys, not the retired legacy key.
// =============================================================================

// Bug fix (02-Sep-2026): this was pinned to @2.45.4 -- a version from
// well before Supabase's newer publishable/secret API key format and
// asymmetric (JWT Signing Keys / ES256) JWT signing existed. Both this
// project's frontend (frontend/index.html's unpinned `@supabase/supabase-js@2`
// CDN import, currently resolving to 2.112.4 in production -- confirmed
// live via this function's own request logs, request.headers.x_client_info)
// and its backend scheduler (backend/package.json's `^2.45.0`, resolved to
// 2.112.4 in backend/package-lock.json) have long since moved on to a
// current 2.x release. A live-captured invocation of this exact function
// showed a REAL, unexpired ES256-signed session token (confirmed correct
// issuer, role, ~36 minutes left before expiry) still getting rejected by
// admin.auth.getUser(jwt) below -- consistent with this stale SDK version
// not correctly handling a SERVICE_ROLE_KEY in the newer sb_secret_...
// format, or the newer ES256-signed tokens it's being asked to verify.
// Pinned to the exact same version already proven working everywhere else
// in this project, rather than an untested "latest", for consistency.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.112.4";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;

// Bug fix (02-Sep-2026), likely the actual root cause: this app's own
// publishable key -- the exact same value frontend/supabaseConfig.js
// ships to every visitor's browser in plain text, since it is explicitly
// designed to be public (safe to expose; access is enforced by RLS, not
// by hiding this value -- see that file's own header comment). Hardcoded
// here (rather than read from a secret) precisely BECAUSE it isn't a
// secret -- there's nothing to configure or keep in sync.
//
// Why this exists: research into this project's admin-users 401 bug
// turned up a real-world report (a Supabase user fixing the same
// "valid session token still rejected" symptom after Supabase's move to
// asymmetric JWT signing / the new secret-key format) whose fix was
// exactly this -- verifying a caller's own session JWT via
// admin.auth.getUser(jwt) using a client built with the PUBLISHABLE key,
// never the SECRET/service-role key. That matches this project's own
// live evidence: a Supabase Dashboard invocation log for this exact
// function showed a real, unexpired, correctly-issued ES256-signed
// token still getting rejected by this call. Verifying "is this JWT
// valid, and whose is it" is a read-only, publicly-permissioned
// operation that never needed service-role privileges in the first
// place -- only the profiles.role lookup and the actual admin actions
// below (list/disable/enable/delete) genuinely need the service-role
// client, and those are unchanged.
const PUBLISHABLE_KEY = "sb_publishable_WHj9KO6LMC7f7nO-dCmiHQ_f8mh1-Gy";

// Supabase's Admin API has no literal "ban forever" value — its own docs
// and examples use a very long finite duration instead. ~100 years is the
// commonly documented convention for "effectively permanent" until the
// admin explicitly re-enables the account (ban_duration: "none").
const INDEFINITE_BAN_DURATION = "876000h";

type Action = "list" | "disable" | "enable" | "delete";

interface ActionResult {
  userId: string;
  action: string;
  result: "SUCCESS" | "FAILED" | "SKIPPED";
  email?: string | null;
  message?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed. Use POST." }, 405);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    // Fails loudly rather than silently — matches this project's own
    // "never claim success without proof" principle (see e.g.
    // backend/db/supabaseClient.js's equivalent check).
    console.error("admin-users: missing SUPABASE_URL or SERVICE_ROLE_KEY secret.");
    return json({ error: "Server misconfigured — missing Supabase secrets." }, 500);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  // See the PUBLISHABLE_KEY comment above -- used ONLY to verify the
  // caller's own JWT below, never for anything privileged.
  const authClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) {
      return json({ error: "Missing Authorization header." }, 401);
    }

    // Bug fix (02-Sep-2026): this call used to be `admin.auth.getUser(jwt)`
    // directly, once, with no logging at all if it failed -- every possible
    // failure reason (a genuinely expired/garbled token, a network hiccup
    // talking to the Auth server, or a stale/mismatched SERVICE_ROLE_KEY or
    // SUPABASE_URL secret -- e.g. left over from before this project's
    // Aug-2026 API key rotation, see this file's header comment) was
    // silently swallowed and reported to the browser as the exact same
    // "Invalid or expired session. Please sign in again." message, even
    // when the caller's own token had many minutes left before its own
    // exp claim and signing in again would fix nothing. Two changes below:
    // (1) getUserWithRetry() retries once so a one-off network blip
    // between this function and the Auth server doesn't masquerade as a
    // real auth failure; (2) the real error is now logged, so the next
    // time this fires, Supabase Dashboard -> Edge Functions -> admin-users
    // -> Logs (search for "auth.getUser(jwt) failed") shows the actual
    // reason instead of nothing -- see ADMIN_SETUP.md's Troubleshooting
    // section for what each cause looks like there and how to fix it.
    const { data: callerData, error: callerErr } = await getUserWithRetry(authClient, jwt);
    if (callerErr || !callerData?.user) {
      console.error("admin-users: auth.getUser(jwt) failed:", {
        message: callerErr?.message,
        name: callerErr?.name,
        status: (callerErr as { status?: number } | undefined)?.status,
        code: (callerErr as { code?: string } | undefined)?.code,
        gotUser: !!callerData?.user,
      });
      return json(
        {
          error:
            "Could not verify your session. Try signing in again -- if that keeps failing, this is likely a server configuration issue, not your login.",
        },
        401
      );
    }
    const caller = callerData.user;

    // The real authorization check — see the header comment's point 2/3.
    const { data: profile, error: profileErr } = await admin
      .from("profiles")
      .select("role")
      .eq("user_id", caller.id)
      .maybeSingle();

    if (profileErr) {
      console.error("admin-users: profile lookup failed:", profileErr);
      return json({ error: "Could not verify admin role." }, 500);
    }
    if (!profile || profile.role !== "admin") {
      return json({ error: "Not authorized. Super User role required." }, 403);
    }

    const body = await req.json().catch(() => null);
    const action = body?.action as Action | undefined;

    if (action === "list") {
      const users = await listAllUsers(admin);
      return json({ users });
    }

    if (action !== "disable" && action !== "enable" && action !== "delete") {
      return json({ error: `Unknown or missing action: ${String(action)}` }, 400);
    }

    const userIds: string[] = Array.isArray(body?.userIds)
      ? body.userIds.filter((id: unknown) => typeof id === "string" && id.length > 0)
      : [];

    if (userIds.length === 0) {
      return json({ error: "No userIds provided." }, 400);
    }
    if (userIds.length > 500) {
      // Sanity cap — this app's real user count is nowhere near this, and
      // a request this large is far more likely a client bug than a
      // legitimate bulk action.
      return json({ error: "Too many userIds in one request (max 500)." }, 400);
    }

    const results: ActionResult[] = [];
    for (const targetId of userIds) {
      // Sequential, not Promise.all: each iteration writes its own
      // admin_actions row, and keeping this sequential makes the audit
      // log's created_at ordering match the order the caller selected
      // users in, which is easier to read back later than an
      // interleaved-by-network-timing order would be. Bulk actions here
      // are expected to be tens of users at most, not thousands, so the
      // extra wall-clock cost of sequential processing is negligible.
      results.push(await performAction(admin, action, targetId, caller));
    }

    return json({ results });
  } catch (err) {
    console.error("admin-users: unhandled error:", err);
    return json({ error: "Internal error." }, 500);
  }
});

// One retry, after a short delay, before treating a getUser() failure as
// final. Rules out a one-off transient network hiccup between this
// function and Supabase's own Auth server before it's ever surfaced to
// the caller as an auth failure -- see the bug-fix comment where this is
// called, above.
async function getUserWithRetry(admin: SupabaseClient, jwt: string) {
  const first = await admin.auth.getUser(jwt);
  if (!first.error) return first;
  await new Promise((resolve) => setTimeout(resolve, 300));
  return admin.auth.getUser(jwt);
}

async function listAllUsers(admin: SupabaseClient) {
  // auth.admin.listUsers() is paginated; walk every page rather than
  // assuming the first page is everyone. The 20-page (20,000-user) cap is
  // a safety valve against an infinite loop if the API's pagination
  // signal ever behaves unexpectedly — this app's real user count is a
  // tiny fraction of that.
  const all: Array<{
    id: string;
    email?: string;
    created_at: string;
    last_sign_in_at?: string | null;
    banned_until?: string | null;
  }> = [];
  let page = 1;
  const perPage = 1000;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    all.push(...data.users);
    if (data.users.length < perPage || page >= 20) break;
    page += 1;
  }

  const { data: profileRows, error: profileErr } = await admin
    .from("profiles")
    .select("user_id, role");
  if (profileErr) throw profileErr;

  const roleByUser = new Map<string, string>(
    (profileRows ?? []).map((p: { user_id: string; role: string }) => [p.user_id, p.role])
  );

  const now = Date.now();
  return all
    .map((u) => ({
      id: u.id,
      email: u.email ?? null,
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at ?? null,
      disabled: !!u.banned_until && new Date(u.banned_until).getTime() > now,
      role: roleByUser.get(u.id) ?? "user",
    }))
    .sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""));
}

async function performAction(
  admin: SupabaseClient,
  action: "disable" | "enable" | "delete",
  targetId: string,
  caller: { id: string; email?: string }
): Promise<ActionResult> {
  const base = { userId: targetId, action: action.toUpperCase() };

  if (targetId === caller.id) {
    await logAction(admin, caller, action, targetId, caller.email ?? null, "SKIPPED", "Cannot act on your own account.");
    return { ...base, result: "SKIPPED", message: "You cannot act on your own account." };
  }

  let targetEmail: string | null = null;
  try {
    const { data: targetUserData } = await admin.auth.admin.getUserById(targetId);
    targetEmail = targetUserData?.user?.email ?? null;

    if (action === "disable") {
      const { error } = await admin.auth.admin.updateUserById(targetId, {
        ban_duration: INDEFINITE_BAN_DURATION,
      });
      if (error) throw error;
    } else if (action === "enable") {
      const { error } = await admin.auth.admin.updateUserById(targetId, {
        ban_duration: "none",
      });
      if (error) throw error;
    } else {
      const { error } = await admin.auth.admin.deleteUser(targetId);
      if (error) throw error;
      // Cascades automatically: profiles, alerts (and alerts' own
      // notifications, via alerts' own ON DELETE CASCADE) all reference
      // auth.users(id) ON DELETE CASCADE — see database/schema.sql. No
      // manual cleanup needed here.
    }

    await logAction(admin, caller, action, targetId, targetEmail, "SUCCESS", null);
    return { ...base, result: "SUCCESS", email: targetEmail };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logAction(admin, caller, action, targetId, targetEmail, "FAILED", message);
    return { ...base, result: "FAILED", email: targetEmail, message };
  }
}

async function logAction(
  admin: SupabaseClient,
  caller: { id: string; email?: string },
  action: string,
  targetId: string,
  targetEmail: string | null,
  result: "SUCCESS" | "FAILED" | "SKIPPED",
  errorMessage: string | null
) {
  const { error } = await admin.from("admin_actions").insert({
    admin_user_id: caller.id,
    admin_email: caller.email ?? null,
    action: action.toUpperCase(),
    target_user_id: targetId,
    target_email: targetEmail,
    result,
    error_message: errorMessage,
  });
  if (error) {
    // Never let a logging failure mask the actual action's outcome from
    // the caller — just surface it in the function's own logs.
    console.error("admin-users: failed to write admin_actions row:", error);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
