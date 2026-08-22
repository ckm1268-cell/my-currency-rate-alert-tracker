/**
 * Email delivery channel — Phase 10, via Resend
 * =================================================
 * Thin wrapper around Resend's REST API (https://api.resend.com/emails) —
 * called with the built-in global `fetch` (Node 18+, no extra dependency
 * added to package.json), the same "don't add a dependency you don't need"
 * approach already used for backend/db/supabaseClient.js's explicit
 * environment-variable checks.
 *
 * Required environment variable: RESEND_API_KEY (see .env.example — backend
 * / GitHub Actions secret only, never sent to the frontend).
 * Optional: NOTIFY_EMAIL_FROM — defaults to Resend's own shared test sender
 * (onboarding@resend.dev), which works immediately with no domain
 * verification. Once a real domain is verified in the Resend dashboard,
 * set NOTIFY_EMAIL_FROM to an address on that domain (e.g.
 * "MY Currency Rate Tracker <alerts@yourdomain.com>") — no code change
 * needed, just the env var.
 */

'use strict';

const RESEND_API_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'MY Currency Rate Tracker <onboarding@resend.dev>';

/**
 * @param {{ to: string, subject: string, text: string, html?: string }} params
 * @returns {Promise<{ id: string|null }>}
 * @throws if RESEND_API_KEY is missing, no recipient is given, or Resend's
 *   API itself returns a non-2xx response — the caller (notify.js) is
 *   responsible for catching this and recording a FAILED delivery rather
 *   than letting one bad send crash the whole scheduler run.
 */
async function sendEmail({ to, subject, text, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error(
      'RESEND_API_KEY is not set — cannot send email. Add it as a GitHub Actions repo secret ' +
      '(Settings -> Secrets and variables -> Actions) and in .env for local runs. See NOTIFICATIONS_SETUP.md.'
    );
  }
  if (!to) {
    throw new Error('sendEmail() called without a recipient address.');
  }

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.NOTIFY_EMAIL_FROM || DEFAULT_FROM,
      to: [to],
      subject,
      text,
      ...(html ? { html } : {}),
    }),
  });

  let body = {};
  try {
    body = await res.json();
  } catch (err) {
    // Resend's error responses are normally JSON too, so a body that
    // doesn't parse at all is itself worth surfacing rather than swallowing.
  }

  if (!res.ok) {
    throw new Error(`Resend API error (HTTP ${res.status}): ${body.message || JSON.stringify(body)}`);
  }

  return { id: body.id || null };
}

module.exports = { sendEmail };
