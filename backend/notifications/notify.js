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
 * Bug fix (26-Aug-2026, reported): the "Time:" line was built with
 * `new Date(...).toLocaleString()`, which formats using whatever locale/
 * timezone the RUNNING PROCESS defaults to — not the user's. For email and
 * Telegram, that process is the GitHub Actions runner (UTC, en-US format),
 * so a real alert triggered at, say, 16:09:45 Malaysia time showed up in
 * the email as "8/26/2026, 8:09:45 AM" — technically correct in UTC, but
 * wrong for every user of this app, all of whom are monitoring Malaysian
 * money changers. Confirmed via a real delivered email.
 *
 * Fix: always format explicitly in Asia/Kuala_Lumpur (UTC+8), regardless of
 * what timezone the server happens to be running in, in DD-MMM-YYYY HH:MM:SS
 * form — matching the exact format PROJECT INSTRUCTIONS section 8/11's own
 * examples use ("21-Aug-2026 12:45:32"). Uses Intl.DateTimeFormat with an
 * explicit `timeZone` rather than toLocaleString()'s implicit one, which is
 * the only way to get a deterministic timezone independent of the host
 * environment. Exported so frontend/app.js's client-side "browser" channel
 * notification (fireAlert()) isn't tempted to duplicate this with its own,
 * possibly-diverging implementation — see that file for why it still needs
 * its own small copy anyway (no shared module system between front/back end
 * in this project).
 *
 * Bug fix (26-Aug-2026, reported): switched from 24-hour to 12-hour clock
 * with an AM/PM suffix, per request — e.g. "26-Aug-2026 09:39:29 PM" instead
 * of "26-Aug-2026 21:39:29". `hour12: true` on its own would still need a
 * plain-English AM/PM label pulled out separately, so this reads the
 * `dayPeriod` part straight out of the same formatToParts() call rather than
 * building it by hand — en-US's dayPeriod values are already the plain
 * "AM"/"PM" this app wants, no extra mapping needed. Confirmed correct at
 * the midnight edge case too (00:00 MYT -> "12:00:00 AM", not "00:00:00").
 */
function formatMalaysiaTime(input) {
  const d = input ? new Date(input) : new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kuala_Lumpur',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('day')}-${get('month')}-${get('year')} ${get('hour')}:${get('minute')}:${get('second')} ${get('dayPeriod')}`;
}

/**
 * Builds the plain-text alert body, matching the exact template in the
 * project brief's section 11 ("Notification / Alert System").
 */
function formatAlertText({ currency, rateType, rate, targetRate, source, retrievedAt }) {
  const time = formatMalaysiaTime(retrievedAt);
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
        // Bug fix (26-Aug-2026): push previously had no Time line at all —
        // added here for parity with email/Telegram now that "all
        // notifications should show Malaysia time" was reported. Native OS
        // push notifications already show their own delivery timestamp
        // chrome-side, but that's the DEVICE's receive time, not this
        // alert's actual trigger time — worth stating explicitly, same as
        // the other two channels.
        body: `${payload.rate} (target ${payload.targetRate}) — ${payload.source}\nTime: ${formatMalaysiaTime(payload.retrievedAt)}`,
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

module.exports = { notify, formatAlertText, formatAlertHtml, formatMalaysiaTime };
