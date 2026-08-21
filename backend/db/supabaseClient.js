/**
 * Supabase client — Phase 7
 * ============================
 * STATUS: scaffold only.
 *
 * The scheduled backend job (GitHub Actions) uses the SERVICE-ROLE key
 * (from an encrypted GitHub Actions secret — never committed, never sent to
 * the frontend). The frontend (frontend/app.js) will separately create its
 * own Supabase client using only the public ANON key, with access enforced
 * by Postgres Row-Level Security policies (Phase 7), not by secrecy of that
 * key.
 *
 * Required environment variables (see ../../.env.example):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   (backend only — do not expose to frontend)
 */

function getServiceRoleClient() {
  throw new Error('getServiceRoleClient() is not implemented yet — Phase 7 scaffold.');
}

module.exports = { getServiceRoleClient };
