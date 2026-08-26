/**
 * Notification engine — Phase 10 (real email + Telegram delivery),
 * extended Phase 39 (26-Aug-2026, real Web Push delivery)
 * ====================================================================
 * STATUS: implemented, 22-Aug-2026 (email/telegram); 26-Aug-2026 (push).
 * Was a throwing Phase 1 scaffold through Phase 8 — backend/scheduler/
 * run.js logged every trigger with delivery_status "PENDING" because
 * nothing actually pushed it anywhere. This file is what turns that into a
 * real delivery for email, Telegram, and (as of Phase 39) push; 'browser'
 * and the Phase 3 channels (whatsapp, sms) are still not server-side
 * deliverable — 'browser' by definition only ever fires in an open tab
 * (frontend/app.js's fireAlert(), unchanged since Phase 6), and whatsapp/sms
 * remain genuinely out of scope. 'push' is NOT the same thing as 'browser'
 * despite both ultimately showing a native OS notification — 'browser' is
 * a client-side `new Notification(...)` call that requires the tab to be
 * open and JS running; 'push' is the standard Web Push protocol, sent from
 * THIS server-side function via a subscription the browser created once
 * (frontend/push.js), and delivered by the OS/browser's own push service
 * even with the site's tab, or the whole browser, closed — see
 * backend/notifications/webpush.js's header comment for the full
 * explanation of why this needed a real dependency, unlike email/telegram.
 *
 * Pluggable by design, as the original scaffold's header comment promised:
 * each channel (email.js, telegram.js, webpush.js) implements its own
 * narrow send function; this file is the only place that knows how to
 * format the message and which channel a given target maps to. Adding a
 * future channel means adding one file + one branch here, not touching the
 * scheduler.
 *
 * Every call is wrapped so it can never throw: a bad/missing API key, a
 * network failure, or an unconfigured destination (no email on the account,
 * no Telegram chat ID saved, no push subscription saved) all come back as a
 * clean { delivered: false, deliveryStatus: 'FAILED', error: '...' } result
 * instead of crashing the scheduler run over one bad delivery — the same
 * resilience pattern backend/scheduler/run.js already uses for a throwing
 * adapter (see checkCombo()'s try/catch).
 *
 * @param {{ channel: "browser"|"email"|"telegram"|"push"|"whatsapp"|"sms",
 *           email?: string, telegramChatId?: string,
 *           pushSubscription?: { endpoint: string, keys: object } }} target
 * @param {{ currency: string, rateType: string, rate: number,
 *           targetRate: number, source: string, retrievedAt?: string|Date }} payload
 * @returns {Promise<{ delivered: boolean, deliveryStatus: "DELIVERED"|"FAILED"|"PENDING"|"NOT_APPLICABLE", error: string|null }>}
 */

'use strict';

const { sendEmail } = require('./email');
const { sendTelegramMessage } = require('./telegram');
const { sendWebPush } = require('./webpush');

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

    if (target.channel === 'push') {
      if (!target.pushSubscription || !target.pushSubscription.endpoint) {
        return {
          delivered: false,
          deliveryStatus: 'FAILED',
          error: 'No push subscription saved for this alert — enable Push on a device and save the alert again.',
        };
      }
      await sendWebPush({
        subscription: target.pushSubscription,
        title: `🚨 ${payload.currency} ${payload.rateType} target reached`,
        body: `${payload.rate} (target ${payload.targetRate}) — ${payload.source}`,
        url: '/',
      });
      return { delivered: true, deliveryStatus: 'DELIVERED', error: null };
    }
  } catch (err) {
    return { delivered: false, deliveryStatus: 'FAILED', error: err.message };
  }

  // 'browser', 'whatsapp', 'sms' — no server-side delivery channel exists
  // for these. 'browser' is Phase 1's channel and only ever fires in an
  // open tab (frontend/app.js's fireAlert()) — that is correct, expected
  // behavior, not a gap.
  //
  // Phase 25 (25-Aug-2026) bug fix: this used to return deliveryStatus:
  // 'PENDING' here, which read as a stuck/unresolved delivery — reported
  // as a bug (every 'browser' row sat as PENDING forever). 'PENDING' was
  // originally chosen to avoid the worse mistake of claiming DELIVERED or
  // FAILED for a channel nothing was ever attempted on — but it still
  // implies "will resolve eventually," which is false: this will never
  // resolve via this function, for any row, because no server-side
  // implementation of it could exist (there's no tab to notify). Returning
  // NOT_APPLICABLE says that plainly instead, while keeping the same
  // "never claim a delivery that didn't happen" principle intact — see
  // database/schema.sql's matching CHECK constraint update.
  return {
    delivered: false,
    deliveryStatus: 'NOT_APPLICABLE',
    error: `The scheduled backend job detected this trigger, but "${target.channel}" has no server-side delivery — it only fires from an open browser tab.`,
  };
}

module.exports = { notify, formatAlertText, formatAlertHtml };
