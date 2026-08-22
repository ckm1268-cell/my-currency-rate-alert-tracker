#!/usr/bin/env node
/**
 * Scheduled monitor — Phase 8
 * ==============================
 * STATUS: implemented, 22-Aug-2026. This is the "actual scheduled backend
 * job" every earlier phase's status notes pointed to: it fetches every
 * ACTIVE alert from Supabase, runs both adapters (deduplicated — one check
 * per distinct source+currency+branch combo, not one per alert), writes
 * every reading to the `rates` table, evaluates each alert with
 * backend/targetEngine/compareTarget.js's isTargetMet() + pickBestReading()
 * (already implemented in Phase 5/8), and — the moment a target is met —
 * flips that alert's status to TRIGGERED and inserts a `notifications` row.
 * This is what makes a *saved* alert actually get checked in the
 * background, independent of whether any browser tab has it open, which
 * every phase since 7 has flagged as the single biggest limitation of the
 * client-side-only monitoring built through Phase 7.
 *
 * Run manually: `node scheduler/run.js` (from backend/), with SUPABASE_URL
 * and SUPABASE_SERVICE_ROLE_KEY set in the environment (see .env.example).
 * As of Phase 10, RESEND_API_KEY and/or TELEGRAM_BOT_TOKEN are also needed
 * in the environment if any active alert actually has 'email' or 'telegram'
 * among its notification_methods (Phase 11: an array — an alert can select
 * any combination and gets delivered to all of them at once) — a run with
 * neither set still completes normally for alerts using only 'browser' (or
 * no active alert at all); it only affects
 * delivery for the channels that need it, recorded honestly as FAILED (with
 * the missing-key message from notify.js) rather than crashing the run.
 * Wired into .github/workflows/monitor.yml, which as of Phase 14
 * (22-Aug-2026) runs this on a RECURRING every-5-minute schedule, not just
 * a manual click — see that file's own header comment for exactly what was
 * (and wasn't) verified about each site's Terms of Use before that was
 * turned on, at the project owner's explicit, informed decision.
 *
 * - Because the workflow now runs unattended every 5 minutes, an individual
 *   alert's own monitoring_interval_minutes finally means something (Phase
 *   14): isDueForCheck() below skips re-evaluating an alert until its own
 *   interval has elapsed since alerts.last_checked_at. This can only ever
 *   throttle a specific alert DOWN from the workflow's 5-minute cadence
 *   (e.g. an "every 30 minutes" alert is genuinely skipped on 5 out of
 *   every 6 runs) — no alert can ever be checked more often than the
 *   workflow itself runs, regardless of what's selected in the dashboard.
 *
 * Design decisions worth knowing about before touching this file:
 *
 * - Best-rate-across-sources, not "primary source only": when an alert has
 *   more than one source selected, this evaluates the alert against
 *   whichever selected source currently has the best LIVE rate (lower
 *   SELL is better, higher BUY is better) — see
 *   compareTarget.js's pickBestReading() for the full rationale. This
 *   matches a fix made to frontend/app.js in the same Phase 8 change, so
 *   the live dashboard and this backend job agree on what "the rate that
 *   matters" means for a multi-source alert.
 *
 * - "Previous rate" for PCT_CHANGE alerts is the most recent PRIOR `rates`
 *   row for the specific source this run picked as best — fetched BEFORE
 *   this run's own reading is written, so it's never compared against
 *   itself. Caveat, stated plainly rather than silently assumed: if the
 *   best source flips between runs (My Money Master was best last time,
 *   Taj Muhabath is best this time), the "previous rate" is that
 *   currently-best source's own history, not a continuous series across
 *   whichever source happened to be best each time. For a PCT_CHANGE
 *   alert with only one source selected this never matters; it's a
 *   reasonable, documented compromise for the multi-source case rather
 *   than an invented "blended" previous value.
 *
 * - Every reading gets written to `rates` regardless of outcome (LIVE,
 *   STALE, SOURCE_UNAVAILABLE, EXTRACTION_ERROR, RATE_VALIDATION_ERROR) —
 *   this is the project brief's section 17 rate-history requirement and
 *   section 24 logging requirement; a failed check is exactly as much a
 *   fact worth recording as a successful one, never silently dropped.
 *
 * - A triggered alert's `notifications` row(s) now reflect a REAL delivery
 *   attempt, as of Phase 10 (22-Aug-2026) — backend/notifications/notify.js
 *   is no longer a throwing scaffold. As of Phase 11, an alert's
 *   notification_methods is an ARRAY: for each of 'email'/'telegram' it
 *   contains, this file resolves the actual destination (the signed-in
 *   user's own auth email via the Supabase Auth admin API, or the alert's
 *   own saved telegram_chat_id) and calls notify() for every selected
 *   channel at once (see resolveNotifyTargets() + the Promise.all in
 *   evaluateAlert()), each returning DELIVERED / FAILED / PENDING honestly
 *   based on what actually happened for THAT channel — never optimistically
 *   marked DELIVERED before a send is attempted, and one channel's failure
 *   never blocks another's delivery. 'browser' (Phase 1) and the still-
 *   unimplemented whatsapp/sms channels correctly stay PENDING: notify()
 *   has no server-side channel for them, same "never mislabel" principle
 *   the Phase 5 fireAlert() incident and every phase since has held to.
 *
 * - Duplicate-alert suppression needs no extra bookkeeping here: this
 *   script only ever queries alerts with status = 'ACTIVE'. Once an alert
 *   is marked TRIGGERED, it simply stops appearing in that query on every
 *   later run, until the user resets it (frontend/auth.js's existing
 *   enable/disable + the account UI's own reset path) — the database
 *   itself enforces "don't re-fire" for the server-side path, the same
 *   guarantee state.triggered gives the in-browser demo.
 */

'use strict';

const { getServiceRoleClient } = require('../db/supabaseClient');
const { isTargetMet, pickBestReading } = require('../targetEngine/compareTarget');
const { comboKey, getRequiredCombos, readingsForAlert } = require('./comboSelection');
const { notify } = require('../notifications/notify');

const ADAPTERS = {
  mymoneymaster: () => require('../scrapers/mymoneymaster.adapter'),
  tajmuhabath: () => require('../scrapers/tajmuhabath.adapter'),
  merchantradeasia: () => require('../scrapers/merchantradeasia.adapter'),
};

const SOURCE_DISPLAY_NAMES = {
  mymoneymaster: 'My Money Master',
  tajmuhabath: 'Taj Muhabath',
  merchantradeasia: 'Merchantrade Asia',
};

async function fetchPreviousRateRow(sb, combo) {
  let query = sb
    .from('rates')
    .select('*')
    .eq('source', combo.source)
    .eq('currency', combo.currency);
  query = combo.branch ? query.eq('branch', combo.branch) : query.is('branch', null);

  const { data, error } = await query.order('created_at', { ascending: false }).limit(1);
  if (error) {
    console.error(`[scheduler] could not fetch previous rate for ${comboKey(combo)}: ${error.message}`);
    return null;
  }
  return (data && data[0]) || null;
}

async function insertRateRow(sb, result) {
  const row = {
    source: result.source,
    branch: result.branch,
    currency: result.currency,
    buy_rate: result.buyRate,
    sell_rate: result.sellRate,
    retrieved_at: result.retrievedAt,
    source_timestamp: result.sourceTimestamp,
    status: result.status,
    validation_status: result.validationStatus,
    error_message: result.errorMessage || null,
  };
  const { data, error } = await sb.from('rates').insert(row).select().single();
  if (error) {
    console.error(`[scheduler] could not write rates row for ${comboKey(result)}: ${error.message}`);
    return null;
  }
  return data;
}

async function checkCombo(sb, combo) {
  const loadAdapter = ADAPTERS[combo.source];
  if (!loadAdapter) {
    console.error(`[scheduler] no adapter registered for source "${combo.source}" — skipping.`);
    return null;
  }

  console.log(
    `[scheduler] checking ${combo.source} ${combo.currency}${combo.branch ? ` (branch: ${combo.branch})` : ''}...`
  );

  // Fetch the previous reading BEFORE writing this run's own row, so it's
  // never compared against itself for PCT_CHANGE evaluation.
  const prevRow = await fetchPreviousRateRow(sb, combo);

  let reading;
  try {
    const adapter = loadAdapter();
    reading = await adapter.fetchRateWithFallback({
      currencyCode: combo.currency,
      ...(combo.branch ? { branch: combo.branch } : {}),
    });
  } catch (err) {
    // An adapter throwing outright (as opposed to returning a
    // SOURCE_UNAVAILABLE/EXTRACTION_ERROR result, which is the normal,
    // expected way an adapter reports failure) is unexpected — record it
    // the same honest way rather than letting one bad combo crash the
    // whole run and silently skip every other alert.
    reading = {
      source: combo.source,
      branch: combo.branch,
      currency: combo.currency,
      buyRate: null,
      sellRate: null,
      retrievedAt: new Date().toISOString(),
      sourceTimestamp: null,
      status: 'SOURCE_UNAVAILABLE',
      validationStatus: 'NOT_RUN',
      errorMessage: `Adapter threw: ${err.message}`,
    };
  }

  console.log(
    `[scheduler]   -> status=${reading.status} validationStatus=${reading.validationStatus}` +
      (reading.errorMessage ? ` errorMessage=${reading.errorMessage}` : '')
  );

  const rateRow = await insertRateRow(sb, reading);

  return { combo, reading, rateRowId: rateRow ? rateRow.id : null, prevRow };
}

/**
 * Resolves where a triggered alert's notification(s) should actually go —
 * plural, as of Phase 11: an alert can have any combination of
 * notification_methods selected (e.g. ['email','telegram'], or all three
 * including 'browser'), and this returns one target per selected method so
 * evaluateAlert() can deliver to every one of them simultaneously rather
 * than picking just one channel. Email addresses are never stored on the
 * `alerts` row itself — this alert's owner already has one, in Supabase's
 * own auth.users table, via the Auth admin API (only reachable with the
 * service-role client this scheduler already uses; the frontend's anon-key
 * client cannot call this). Email lookups are cached per user_id for the
 * lifetime of one run — across every alert AND every channel — since one
 * user can easily have several active alerts (or one alert with 'email'
 * among several selected methods) and there's no reason to look up the
 * same email twice in a single pass.
 *
 * Falls back to the old singular `notification_method` column (wrapped in
 * a one-element array) if `notification_methods` is missing — this should
 * only matter mid-migration, if this code ever runs against a database
 * that hasn't had database/schema.sql's Phase 11 migration applied yet;
 * once that migration has run, the old column no longer exists and this
 * fallback is simply unreachable.
 */
async function resolveNotifyTargets(sb, alert, emailCache) {
  const methods = Array.isArray(alert.notification_methods) && alert.notification_methods.length > 0
    ? alert.notification_methods
    : (alert.notification_method ? [alert.notification_method] : ['browser']);

  const targets = [];
  for (const method of methods) {
    if (method === 'telegram') {
      targets.push({ channel: 'telegram', telegramChatId: alert.telegram_chat_id });
      continue;
    }

    if (method === 'email') {
      if (!emailCache.has(alert.user_id)) {
        try {
          const { data, error } = await sb.auth.admin.getUserById(alert.user_id);
          if (error) throw error;
          emailCache.set(alert.user_id, (data && data.user && data.user.email) || null);
        } catch (err) {
          console.error(`[scheduler] could not resolve email for user ${alert.user_id}: ${err.message}`);
          emailCache.set(alert.user_id, null);
        }
      }
      targets.push({ channel: 'email', email: emailCache.get(alert.user_id) });
      continue;
    }

    // 'browser', 'whatsapp', 'sms' — notify() itself knows these have no
    // server-side channel and will return PENDING; nothing to resolve here.
    targets.push({ channel: method });
  }
  return targets;
}

/**
 * Phase 14 — is this alert due to be checked THIS run, given its own
 * monitoring_interval_minutes and when it was last actually checked?
 *
 * An alert that has never been checked (last_checked_at is null — a brand
 * new alert, or one saved before this migration ran) is always due
 * immediately rather than waiting a full interval first; that matches how
 * every other "first run" case in this codebase behaves (e.g. a PCT_CHANGE
 * alert with no previous rate yet).
 *
 * `now` is passed in (rather than read via `new Date()` inside this
 * function) purely so this stays a pure, easily-testable function — see
 * tests/isDueForCheck.test.js.
 */
function isDueForCheck(alert, now) {
  if (!alert.last_checked_at) return true;
  const intervalMinutes = alert.monitoring_interval_minutes || 5;
  const elapsedMs = now.getTime() - new Date(alert.last_checked_at).getTime();
  return elapsedMs >= intervalMinutes * 60 * 1000;
}

async function evaluateAlert(sb, alert, readingsByComboKey, recordsByComboKey, emailCache) {
  const candidateReadings = readingsForAlert(alert, readingsByComboKey);
  const best = pickBestReading(candidateReadings, alert.rate_type);

  if (!best) {
    console.log(
      `[scheduler] alert ${alert.id} (${alert.currency} ${alert.rate_type}, target ${alert.target_rate}): ` +
        `no LIVE reading from any of its selected source(s) this run — skipped.`
    );
    return { evaluated: false, triggered: false };
  }

  const record = recordsByComboKey.get(comboKey({ source: best.source, currency: best.currency, branch: best.branch }));
  const value = alert.rate_type === 'SELL' ? best.sellRate : best.buyRate;
  const prevRaw = record && record.prevRow
    ? (alert.rate_type === 'SELL' ? record.prevRow.sell_rate : record.prevRow.buy_rate)
    : null;
  const prevRate = prevRaw != null ? Number(prevRaw) : null;

  const met = isTargetMet({
    liveRate: value,
    targetRate: Number(alert.target_rate),
    condition: alert.condition,
    prevRate,
    pctChangeThreshold: alert.pct_change_threshold != null ? Number(alert.pct_change_threshold) : undefined,
  });

  const bestLabel = `${SOURCE_DISPLAY_NAMES[best.source] || best.source}${best.branch ? ` (${best.branch})` : ''}`;
  console.log(
    `[scheduler] alert ${alert.id}: best=${bestLabel} ${alert.currency} ${alert.rate_type}=${value} ` +
      `target=${alert.target_rate} condition=${alert.condition} -> ${met ? 'TARGET REACHED' : 'waiting'}`
  );

  if (!met) return { evaluated: true, triggered: false };

  const { error: updateError } = await sb.from('alerts').update({ status: 'TRIGGERED' }).eq('id', alert.id);
  if (updateError) {
    console.error(`[scheduler] could not mark alert ${alert.id} TRIGGERED: ${updateError.message}`);
  }

  const message =
    `${bestLabel} ${alert.currency} ${alert.rate_type} target reached: ${value} (target ${alert.target_rate}).`;

  // Phase 11: deliver to every selected channel AT ONCE (Promise.all, not
  // one after another) — an alert with both Email and Telegram checked
  // gets both messages sent concurrently, not Telegram waiting on Email's
  // network round trip first. Each channel still gets its own
  // `notifications` row below, exactly as a single-channel alert always
  // has — the `notifications` table's `notification_type` column stays a
  // single value per row by design (see database/schema.sql), it's just
  // that a multi-channel trigger now writes multiple rows in the same
  // pass instead of always writing exactly one.
  const notifyTargets = await resolveNotifyTargets(sb, alert, emailCache);
  const payload = {
    currency: alert.currency,
    rateType: alert.rate_type,
    rate: value,
    targetRate: Number(alert.target_rate),
    source: bestLabel,
    retrievedAt: best.retrievedAt || new Date().toISOString(),
  };
  const notifyResults = await Promise.all(notifyTargets.map((target) => notify(target, payload)));

  for (let i = 0; i < notifyTargets.length; i++) {
    const target = notifyTargets[i];
    const result = notifyResults[i];
    console.log(
      `[scheduler]   notify via ${target.channel}: ${result.deliveryStatus}` +
        (result.error ? ` (${result.error})` : '')
    );

    const { error: notifyError } = await sb.from('notifications').insert({
      alert_id: alert.id,
      rate_id: record ? record.rateRowId : null,
      notification_type: target.channel,
      delivery_status: result.deliveryStatus,
      delivery_error: result.error,
      message,
    });
    if (notifyError) {
      console.error(`[scheduler] could not insert notification for alert ${alert.id} (${target.channel}): ${notifyError.message}`);
    }
  }

  return { evaluated: true, triggered: true };
}

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`[scheduler] run started at ${startedAt}`);

  const sb = getServiceRoleClient();

  const { data: alerts, error: alertsError } = await sb.from('alerts').select('*').eq('status', 'ACTIVE');
  if (alertsError) {
    console.error('[scheduler] FATAL: could not fetch active alerts:', alertsError.message);
    process.exitCode = 1;
    return;
  }

  console.log(`[scheduler] ${alerts.length} active alert(s).`);
  if (alerts.length === 0) {
    console.log('[scheduler] nothing to check — exiting.');
    return;
  }

  // Phase 14: with this workflow now running unattended every 5 minutes
  // (rather than only on a manual click), fetching live data for every
  // active alert on every single run would ignore whatever interval each
  // alert actually asked for and hit the real money-changer sites far more
  // than necessary. Filter down to only the alerts actually due first —
  // see isDueForCheck()'s own comment for exactly how "due" is decided.
  const now = new Date();
  const dueAlerts = alerts.filter((a) => isDueForCheck(a, now));
  const skippedCount = alerts.length - dueAlerts.length;
  console.log(
    `[scheduler] ${dueAlerts.length} alert(s) due for a check this run (their own monitoring_interval_minutes ` +
      `has elapsed since last_checked_at); ${skippedCount} skipped — not due yet, no data dropped, just deferred.`
  );
  if (dueAlerts.length === 0) {
    console.log('[scheduler] nothing due this run — exiting.');
    return;
  }

  const combos = getRequiredCombos(dueAlerts);
  console.log(`[scheduler] ${combos.length} distinct source/currency/branch combo(s) needed for these alerts.`);

  const readingsByComboKey = new Map();
  const recordsByComboKey = new Map();

  for (const combo of combos) {
    const record = await checkCombo(sb, combo);
    if (!record) continue;
    const key = comboKey(combo);
    readingsByComboKey.set(key, record.reading);
    recordsByComboKey.set(key, record);
  }

  let evaluatedCount = 0;
  let triggeredCount = 0;
  const emailCache = new Map(); // user_id -> email|null, reused across every alert this run

  for (const alert of dueAlerts) {
    const result = await evaluateAlert(sb, alert, readingsByComboKey, recordsByComboKey, emailCache);
    if (result.evaluated) evaluatedCount++;
    if (result.triggered) triggeredCount++;
  }

  // Every due alert was actually looked at this run — whether or not it had
  // a LIVE reading available or ended up triggering — so all of them get
  // last_checked_at stamped together in one call, using this run's own
  // `now` (not a fresh timestamp per alert, and not per-alert timing drift
  // from how long each one took to evaluate).
  const { error: touchError } = await sb
    .from('alerts')
    .update({ last_checked_at: now.toISOString() })
    .in('id', dueAlerts.map((a) => a.id));
  if (touchError) {
    console.error(`[scheduler] could not update last_checked_at for this run's due alerts: ${touchError.message}`);
  }

  console.log(
    `[scheduler] run complete: ${alerts.length} active alert(s), ${dueAlerts.length} due and checked, ` +
      `${evaluatedCount} evaluated (had a LIVE reading), ${triggeredCount} newly triggered.`
  );
}

// Only auto-run when this file is executed directly (`node scheduler/run.js`,
// which is how both the manual local script and .github/workflows/monitor.yml
// invoke it) — NOT when it's require()'d for its exports, which
// tests/resolveNotifyTarget.test.js now does. Before this guard existed,
// requiring this file from anywhere (a test, a REPL, a future script) would
// have kicked off a real scheduler run as a side effect of loading the
// module — including trying to reach Supabase and, as of Phase 10, actually
// sending real notifications. That's exactly the kind of surprising,
// hard-to-test side effect this project's pure-function architecture
// (see comboSelection.js, compareTarget.js) has otherwise avoided throughout.
if (require.main === module) {
  main().catch((err) => {
    console.error('[scheduler] FATAL:', err);
    process.exitCode = 1;
  });
}

module.exports = { fetchPreviousRateRow, insertRateRow, checkCombo, evaluateAlert, resolveNotifyTargets, isDueForCheck };
