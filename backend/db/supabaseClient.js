/**
 * Supabase client — Phase 7
 * ============================
 * STATUS: implemented (21-Aug-2026). Not yet called from anywhere — see the
 * note at the bottom of this file for why that's correct for Phase 7's
 * scope, and what Phase 8 does with it.
 *
 * The scheduled backend job (GitHub Actions, once Phase 8 builds it) uses
 * the SERVICE-ROLE key (from an encrypted GitHub Actions secret — never
 * committed, never sent to the frontend) to get a client that bypasses Row-
 * Level Security entirely, so it can write rate readings and evaluate every
 * user's alerts. The frontend (frontend/supabaseConfig.js + frontend/auth.js)
 * separately creates its own Supabase client using only the public ANON
 * key, with access enforced by the Postgres Row-Level Security policies in
 * database/schema.sql — never by keeping that key secret (it isn't secret;
 * it's meant to ship in the public frontend bundle).
 *
 * Required environment variables (see ../../.env.example):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   (backend only — do not expose to frontend)
 */

let cachedClient = null;

/**
 * Returns a singleton Supabase client authenticated as the service role
 * (full read/write, RLS bypassed). Throws with a clear message if the
 * required environment variables aren't set, rather than returning a
 * half-configured client that would fail confusingly later.
 *
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
function getServiceRoleClient() {
  if (cachedClient) return cachedClient;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      'getServiceRoleClient(): SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY are not set. ' +
      'Copy .env.example to .env for local development, or add both as encrypted GitHub Actions ' +
      'secrets for the scheduled workflow. See SUPABASE_SETUP.md.'
    );
  }

  let createClient;
  try {
    ({ createClient } = require('@supabase/supabase-js'));
  } catch (err) {
    throw new Error(
      `getServiceRoleClient(): the "@supabase/supabase-js" package is not installed in backend/. ` +
      `Run "npm install @supabase/supabase-js" in backend/ first. (${err.message})`
    );
  }

  cachedClient = createClient(url, serviceRoleKey, {
    auth: {
      // This is a server-side, short-lived-process client (a GitHub Actions
      // job run), not a long-lived browser session — it should never try to
      // persist or auto-refresh a session to disk/localStorage, neither of
      // which exist in that environment anyway.
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cachedClient;
}

module.exports = { getServiceRoleClient };

/**
 * Why this file is implemented but still uncalled as of Phase 7:
 * Phase 7's scope (per README's phase table and the architecture review)
 * is "Supabase schema + auth wired in; multi-user alert configuration,
 * isolated per user" — i.e. users can sign in and create/view/delete their
 * own alerts, stored in Supabase, with Row-Level Security proving the
 * isolation at the database layer. That's a frontend-plus-schema change;
 * it doesn't require the backend to talk to Supabase at all yet.
 *
 * Phase 8 ("GitHub Pages production deploy + GitHub Actions scheduled
 * workflow in production") is what will actually import and call
 * getServiceRoleClient() from a new backend/scheduler/run.js, wired into
 * .github/workflows/monitor.yml per that file's own activation checklist:
 * fetch every active alert's distinct sources, run both adapters, validate,
 * write to the `rates` table, evaluate each alert with
 * backend/targetEngine/compareTarget.js (already implemented, Phase 5),
 * and insert a `notifications` row (and eventually call
 * backend/notifications/notify.js) on every fresh trigger.
 */
