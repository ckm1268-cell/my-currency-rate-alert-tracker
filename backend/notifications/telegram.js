/**
 * Telegram delivery channel — Phase 10, via the Telegram Bot API
 * ===================================================================
 * Thin wrapper around https://api.telegram.org/bot<token>/sendMessage —
 * called with the built-in global `fetch` (Node 18+), same no-new-
 * dependency approach as email.js.
 *
 * Required environment variable: TELEGRAM_BOT_TOKEN (see .env.example —
 * backend / GitHub Actions secret only). Each alert additionally needs its
 * own destination chat ID — stored per-alert in alerts.telegram_chat_id
 * (see database/schema.sql's Phase 10 addition), NOT a single global
 * recipient, since this is a multi-user app and each user's alert should
 * only ever reach that user's own Telegram chat. See NOTIFICATIONS_SETUP.md
 * for how a user creates a bot (via @BotFather) and finds their chat ID.
 */

'use strict';

/**
 * @param {{ chatId: string|number, text: string }} params
 * @returns {Promise<{ messageId: number|null }>}
 * @throws if TELEGRAM_BOT_TOKEN is missing, no chatId is given, or the
 *   Telegram API itself reports failure — caller (notify.js) is responsible
 *   for catching this and recording a FAILED delivery.
 */
async function sendTelegramMessage({ chatId, text }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error(
      'TELEGRAM_BOT_TOKEN is not set — cannot send a Telegram message. Add it as a GitHub Actions ' +
      'repo secret (Settings -> Secrets and variables -> Actions) and in .env for local runs. ' +
      'See NOTIFICATIONS_SETUP.md.'
    );
  }
  if (!chatId) {
    throw new Error('sendTelegramMessage() called without a chat id.');
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });

  let body = {};
  try {
    body = await res.json();
  } catch (err) {
    // fall through — body stays {}
  }

  if (!res.ok || body.ok === false) {
    throw new Error(`Telegram API error: ${body.description || `HTTP ${res.status}`}`);
  }

  return { messageId: (body.result && body.result.message_id) || null };
}

module.exports = { sendTelegramMessage };
