// Shared CORS headers for every Edge Function in this project.
//
// Restricted to this app's actual deployed origin, not "*" — an admin
// endpoint (supabase/functions/admin-users) should never be left open to
// every origin the way a purely public read-only endpoint might
// reasonably be. Override via the ALLOWED_ORIGIN Supabase secret if you
// fork/redeploy this app's frontend somewhere other than the default
// URL below (same pattern as APP_URL in backend/notifications/notify.js
// — see ADMIN_SETUP.md).
//
// Updated 31-Aug-2026: default switched from the raw GitHub Pages origin
// (https://ckm1268-cell.github.io) to the custom domain
// (https://app.mycurrencyalerts.abrdns.com) added to hide the github.io
// URL from users. The Admin Module UI is loaded from whichever origin the
// browser is on, so if it's ever opened from the old github.io URL again,
// this Edge Function's CORS check will reject it unless ALLOWED_ORIGIN is
// set to that origin via the Supabase secret instead.

const ALLOWED_ORIGIN =
  Deno.env.get("ALLOWED_ORIGIN") ?? "https://app.mycurrencyalerts.abrdns.com";

export const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
