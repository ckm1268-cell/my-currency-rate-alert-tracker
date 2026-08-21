/**
 * Supabase public config — Phase 7
 * ====================================
 * These two values are SAFE to commit and ship in the public frontend
 * bundle. They are not secrets: access to your data is enforced by the
 * Row-Level Security policies in database/schema.sql, not by keeping this
 * key hidden — that's the whole point of Supabase's anon-key model. See
 * SUPABASE_SETUP.md for where these values come from.
 *
 * NEVER put your service-role key here or anywhere in frontend/ — that key
 * bypasses Row-Level Security entirely and must only ever live in a GitHub
 * Actions encrypted secret, used by backend/db/supabaseClient.js.
 *
 * Loaded before app.js and auth.js in index.html.
 */

window.CKM_SUPABASE_URL = "YOUR_SUPABASE_PROJECT_URL"; // e.g. "https://abcdefghijk.supabase.co"
window.CKM_SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY"; // Project Settings -> API -> Project API keys -> anon / public
