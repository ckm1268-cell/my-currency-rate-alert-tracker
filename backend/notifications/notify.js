/**
 * Notification engine — Phase 10 (real email + Telegram delivery)
 * ====================================================================
 * STATUS: implemented, 22-Aug-2026. Was a throwing Phase 1 scaffold through
 * Phase 8 — backend/scheduler/run.js logged every trigger with
 * delivery_status "PENDING" because nothing actually pushed it anywhere.
 * This file is what turns that into a real delivery for the two channels
 * the project brief's Phase 2 notification scope covers (email, Telegram);
 * 'browser' and the Phase 3 channels (whatsapp, sms) are still not server-
 * side deliverable — 'browser' by definition only ever fires in an open tab
 * (frontend/app.js's fireAlert(), unchanged since Phase 6), and whatsapp/sms
 * remain genuinely out of scope.
 *
 * Pluggable by design, as the original scaffold's header comment promised:
 * each channel (email.js, telegram.js) implements its own narrow send
 * function; this file is the only place that knows how to format the
 * message and which channel a given target maps to. Adding a future channel
 * means adding one file + one branch here, not touching the scheduler.
 *
 * Every call is wrapped so it can never throw: a bad/missing API key, a
 * network failure, or an unconfigured destination (no email on the account,
 * no Telegram chat ID saved) all come back as a clean
 * { delivered: false, deliveryStatus: 'FAILED', error: '...' } result
 * instead of crashing the scheduler run over one bad delivery — the same
 * resilience pattern backend/scheduler/run.js already uses for a throwing
 * adapter (see checkCombo()'s try/catch).
 *
 * @param {{ channel: "browser"|"email"|"telegram"|"whatsapp"|"sms",
 *           email?: string, telegramChatId?: string }} target
 * @param {{ currency: string, rateType: string, rate: number,
 *           targetRate: number, source: string, retrievedAt?: string|Date }} payload
 * @returns {Promise<{ delivered: boolean, deliveryStatus: "DELIVERED"|"FAILED"|"PENDING", error: string|null }>}
 */

'use strict';

const { sendEmail } = require('./email');
const { sendTelegramMessage } = require('./telegram');

/**
 * Builds the plain-text alert body, matching the exact template in the
 * project brief's section 11 ("Notification / Alert System").
 */
function formatAlertText({ currency, rateType, rate, targetRate, source, retrievedAt }) {
  const time = retrievedAt ? new Date(retrievedAt).toLocaleString() : new Date().toLocaleString();
  return [
    '🚨 Currency Rate Alert',
    '',
    `Currency: ${currency}`,
    `Rate Type: ${rateType}`,
    `Current Rate: ${rate}`,
    `Target Rate: ${targetRate}`,
    '',
    'Money Changer:',
    source,
    '',
    'Status:',
    'TARGET REACHED',
    '',
    'Time:',
    time,
  ].join('\n');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function formatAlertHtml(payload) {
  return `<pre style="font:14px/1.5 -apple-system,Segoe UI,sans-serif; white-space:pre-wrap;">${escapeHtml(formatAlertText(payload))}</pre>`;
}

async function notify(target, payload) {
  const text = formatAlertText(payload);

  try {
    if (target.channel === 'email') {
      if (!target.email) {
        return { delivered: false, deliveryStatus: 'FAILED', error: 'No email address on file for this account.' };
      }
      await sendEmail({
        to: target.email,
        subject: `Currency Rate Alert — ${payload.currency} ${payload.rateType} reached ${payload.targetRate}`,
        text,
        html: formatAlertHtml(payload),
      });
      return { delivered: true, deliveryStatus: 'DELIVERED', error: null };
    }

    if (target.channel === 'telegram') {
      if (!target.telegramChatId) {
        return { delivered: false, deliveryStatus: 'FAILED', error: 'No Telegram chat ID saved for this alert.' };
      }
      await sendTelegramMessage({ chatId: target.telegramChatId, text });
      return { delivered: true, deliveryStatus: 'DELIVERED', error: null };
    }
  } catch (err) {
    return { delivered: false, deliveryStatus: 'FAILED', error: err.message };
  }

  // 'browser', 'whatsapp', 'sms' — no server-side delivery channel exists
  // for these. 'browser' is Phase 1's channel and only ever fires in an
  // open tab (frontend/app.js's fireAlert()) — that is correct, expected
  // behavior, not a gap, so this stays PENDING rather than FAILED: the
  // scheduler DID detect and log the trigger, it's just not this module's
  // job to deliver it.
  return { delivered: false, deliveryStatus: 'PENDING', error: null };
}

module.exports = { notify, formatAlertText, formatAlertHtml };
