/**
 * Web Push public config — Phase 39
 * ====================================
 * This value is SAFE to commit and ship in the public frontend bundle. It
 * is not a secret: a VAPID "application server key" is meant to be public
 * — it's how the browser proves to the push service which server is
 * allowed to push to a subscription it creates, the same way
 * frontend/supabaseConfig.js's anon key is safe to expose because access
 * is enforced elsewhere (there, by Row-Level Security; here, by the
 * matching VAPID_PRIVATE_KEY that only ever lives server-side — see
 * PUSH_SETUP.md and backend/notifications/webpush.js).
 *
 * NEVER put the PRIVATE key here or anywhere in frontend/ — it must only
 * ever live in a GitHub Actions encrypted secret, used by
 * backend/notifications/webpush.js.
 *
 * Loaded before push.js in index.html. Until this is filled in with a
 * real key (see PUSH_SETUP.md), frontend/push.js detects the placeholder
 * value below and disables the Push checkbox with an explanatory status
 * message, rather than throwing or silently pretending to work — same
 * fail-soft pattern frontend/auth.js already uses for an unconfigured
 * Supabase.
 */

window.CKM_VAPID_PUBLIC_KEY = "BHMHscgxF6GMmpG2uMLSJbaFZJYeCthROO42G-N_ifBnYBZE9kiqnZoQodS-FlX_hganyAF9gyLDdAqLSN2-4-c";
