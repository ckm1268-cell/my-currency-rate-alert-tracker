/**
 * Supabase public config — Phase 7 (publishable key since Phase 45 / v3)
 * ====================================
 * These two values are SAFE to commit and ship in the public frontend
 * bundle. They are not secrets: access to your data is enforced by the
 * Row-Level Security policies in database/schema.sql, not by keeping this
 * key hidden — that's the whole point of Supabase's publishable-key model
 * (the modern replacement for the older "anon key" concept; same role,
 * new name/format). See SUPABASE_SETUP.md for where these values come
 * from.
 *
 * NEVER put your secret/service-role key here or anywhere in frontend/ —
 * that key bypasses Row-Level Security entirely and must only ever live
 * in a GitHub Actions encrypted secret, used by backend/db/supabaseClient.js,
 * or a Supabase Edge Function secret, used by supabase/functions/admin-users.
 *
 * Loaded before app.js and auth.js in index.html.
 */

window.CKM_SUPABASE_URL = "https://vhcpotlfgdpjyheoynvz.supabase.co";
window.CKM_SUPABASE_ANON_KEY = "sb_publishable_WHj9KO6LMC7f7nO-dCmiHQ_f8mh1-Gy";
