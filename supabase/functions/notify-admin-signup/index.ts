// =============================================================================
// MY Currency Rate Tracker — Admin Module: new-signup notification (Phase 51)
// =============================================================================
// Supabase Edge Function: supabase/functions/notify-admin-signup
//
// Why this exists: the Super User asked to be told, near-instantly, whenever
// a new account signs up — not just be able to see the full user list on
// demand in the Admin Module (admin.html). Polling auth.users from the
// existing GitHub Actions scheduler (backend/scheduler/run.js, every 5
// minutes) would work but adds up to 5 minutes of delay; this function is
// instead called the moment a row is actually inserted into auth.users, via
// a Postgres trigger + pg_net (see database/schema.sql's Phase 51 block:
// public.notify_admin_of_new_signup()) — the same "trigger directly on
// auth.users" pattern this project already uses for public.profiles
// (handle_new_user(), Phase 45), which is proven to work against this
// project's actual Supabase instance. Supabase's own point-and-click
// "Database Webhooks" dashboard feature was considered instead, but its
// table picker does not reliably expose the `auth` schema — the hand-written
// trigger + pg_net route (what that dashboard feature is built from
// internally anyway) is the more dependable choice here.
//
// Auth model — deliberately different from supabase/functions/admin-users:
//   - This function is called by Postgres itself (via pg_net), not by a
//     signed-in browser session, so it never has a Supabase user JWT to
//     present. It must be deployed with `--no-verify-jwt` (see
//     ADMIN_SETUP.md Step 5) so Supabase's platform-level JWT check doesn't
//     reject the call outright before this code ever runs.
//   - In place of a user JWT, the calling trigger sends a shared secret in
//     the `X-Signup-Webhook-Secret` header, checked below against the
//     SIGNUP_WEBHOOK_SECRET Supabase secret. This is intentionally a
//     lighter-weight check than admin-users' profiles.role lookup — it
//     exists only so a stranger who finds this function's URL can't make it
//     spam the admin's inbox/Telegram for free. This function never reads
//     or writes any user data and never returns anything sensitive, so the
//     actual blast radius of someone bypassing this check is "the admin
//     gets a fake notification," not an account compromise.
//   - Never put SIGNUP_WEBHOOK_SECRET, RESEND_API_KEY, TELEGRAM_BOT_TOKEN,
//     ADMIN_NOTIFY_EMAIL, or ADMIN_NOTIFY_TELEGRAM_CHAT_ID in frontend/ code
//     or commit them to this repo — Supabase secrets only
//     (`supabase secrets set ...`, ADMIN_SETUP.md Step 5).
//
// Delivery: mirrors backend/notifications/email.js and
// backend/notifications/telegram.js's exact Resend / Telegram Bot API calls.
// Deno Edge Functions can't `require()` those Node/CommonJS files directly,
// so this is a small, deliberate, parallel implementation, not a shortcut —
// same reasoning as admin-users' own standalone TypeScript. Both channels
// are attempted independently via Promise.allSettled-style handling: a
// failure or missing config on one (e.g. Telegram not set up) never blocks
// the other, and either channel can be configured alone. Every attempt's
// outcome is both returned in the JSON response and logged via
// console.log/console.error — visible in Supabase Dashboard -> Edge
// Functions -> notify-admin-signup -> Logs — since nothing else consumes
// this function's response; the pg_net call that invokes it is fire-and-
// forget from Postgres's side, by design (a slow/failed notification must
// never slow down or block a real signup).
// =============================================================================

const SIGNUP_WEBHOOK_SECRET = Deno.env.get("SIGNUP_WEBHOOK_SECRET");

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const NOTIFY_EMAIL_FROM =
  Deno.env.get("NOTIFY_EMAIL_FROM") || "MY Currency Rate Tracker <onboarding@resend.dev>";
const ADMIN_NOTIFY_EMAIL = Deno.env.get("ADMIN_NOTIFY_EMAIL");

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const ADMIN_NOTIFY_TELEGRAM_CHAT_ID = Deno.env.get("ADMIN_NOTIFY_TELEGRAM_CHAT_ID");

const APP_URL = Deno.env.get("APP_URL") || "https://app.mycurrencyalerts.abrdns.com/";

interface SignupWebhookPayload {
  type?: string;
  table?: string;
  schema?: string;
  record?: {
    id?: string;
    email?: string;
    created_at?: string;
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed. Use POST." }, 405);
  }

  if (!SIGNUP_WEBHOOK_SECRET) {
    console.error(
      "notify-admin-signup: SIGNUP_WEBHOOK_SECRET is not set — refusing every request until it is (see ADMIN_SETUP.md Step 5)."
    );
    return json({ error: "Server misconfigured — missing SIGNUP_WEBHOOK_SECRET secret." }, 500);
  }

  const presented = req.headers.get("X-Signup-Webhook-Secret") ?? "";
  if (presented !== SIGNUP_WEBHOOK_SECRET) {
    return json({ error: "Invalid or missing webhook secret." }, 401);
  }

  const payload = (await req.json().catch(() => null)) as SignupWebhookPayload | null;
  if (!payload || payload.type !== "INSERT" || !payload.record) {
    // Not an error — just nothing to do here (e.g. a manual test POST with
    // no body, or a future non-INSERT event this trigger never actually
    // sends today). Acknowledge cleanly rather than erroring.
    return json({ skipped: true, reason: "Not a new-user INSERT event." });
  }

  const { id, email, created_at } = payload.record;
  const text = formatNewSignupText({ id, email, created_at });

  const results: Record<string, { delivered: boolean; error: string | null }> = {};
  const jobs: Promise<void>[] = [];

  if (RESEND_API_KEY && ADMIN_NOTIFY_EMAIL) {
    jobs.push(
      sendAdminEmail(text, email)
        .then(() => {
          results.email = { delivered: true, error: null };
        })
        .catch((err: Error) => {
          results.email = { delivered: false, error: err.message };
          console.error("notify-admin-signup: email delivery failed:", err.message);
        })
    );
  } else {
    results.email = {
      delivered: false,
      error: "RESEND_API_KEY or ADMIN_NOTIFY_EMAIL not set — skipped, not attempted.",
    };
  }

  if (TELEGRAM_BOT_TOKEN && ADMIN_NOTIFY_TELEGRAM_CHAT_ID) {
    jobs.push(
      sendAdminTelegram(text)
        .then(() => {
          results.telegram = { delivered: true, error: null };
        })
        .catch((err: Error) => {
          results.telegram = { delivered: false, error: err.message };
          console.error("notify-admin-signup: telegram delivery failed:", err.message);
        })
    );
  } else {
    results.telegram = {
      delivered: false,
      error: "TELEGRAM_BOT_TOKEN or ADMIN_NOTIFY_TELEGRAM_CHAT_ID not set — skipped, not attempted.",
    };
  }

  await Promise.all(jobs);

  console.log("notify-admin-signup:", JSON.stringify({ userId: id, email, results }));

  return json({ ok: true, results });
});

function formatNewSignupText({
  id,
  email,
  created_at,
}: {
  id?: string;
  email?: string;
  created_at?: string;
}): string {
  return [
    "🆕 New User Registered",
    "",
    `Email: ${email ?? "(no email on account)"}`,
    `User ID: ${id ?? "(unknown)"}`,
    `Signed up: ${formatMalaysiaTime(created_at)}`,
    "",
    "Admin Module:",
    `${APP_URL}admin.html`,
  ].join("\n");
}

async function sendAdminEmail(text: string, newUserEmail?: string): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: NOTIFY_EMAIL_FROM,
      to: [ADMIN_NOTIFY_EMAIL],
      subject: `New signup — ${newUserEmail ?? "unknown email"}`,
      text,
    }),
  });

  let body: { message?: string; id?: string } = {};
  try {
    body = await res.json();
  } catch {
    // Resend's error responses are normally JSON too — a body that doesn't
    // parse at all is itself worth surfacing rather than swallowing.
  }

  if (!res.ok) {
    throw new Error(`Resend API error (HTTP ${res.status}): ${body.message ?? JSON.stringify(body)}`);
  }
}

async function sendAdminTelegram(text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: ADMIN_NOTIFY_TELEGRAM_CHAT_ID, text }),
  });

  let body: { ok?: boolean; description?: string } = {};
  try {
    body = await res.json();
  } catch {
    // fall through — body stays {}
  }

  if (!res.ok || body.ok === false) {
    throw new Error(`Telegram API error: ${body.description ?? `HTTP ${res.status}`}`);
  }
}

/**
 * Same Asia/Kuala_Lumpur, DD-MMM-YYYY hh:mm:ss AM/PM format as
 * frontend/timeFormat.js's formatMalaysiaTime() (see that file's header
 * comment for the full history of why this format/timezone was pinned
 * explicitly). Re-implemented here, not imported, because Deno Edge
 * Functions can't `require()` that CommonJS/UMD file directly — this
 * mirrors admin-users' own precedent of standalone TypeScript with no
 * cross-import into backend/frontend. Uses the same en-US
 * Intl.DateTimeFormat + formatToParts() approach so the two stay in visual
 * sync even though they're two separate files, including the same
 * midnight-edge-case behavior ("12:00:00 AM", not "00:00:00").
 */
function formatMalaysiaTime(iso?: string): string {
  const date = iso ? new Date(iso) : new Date();
  if (isNaN(date.getTime())) return "(unknown time)";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}-${get("month")}-${get("year")} ${get("hour")}:${get("minute")}:${get("second")} ${get("dayPeriod")}`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
