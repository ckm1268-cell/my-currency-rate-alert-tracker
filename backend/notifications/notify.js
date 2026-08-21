/**
 * Notification engine — Phase 6 (browser) / Phase 10 (email, Telegram, ...)
 * ============================================================================
 * STATUS: scaffold only.
 *
 * Pluggable by design: each channel (browser, email, telegram, whatsapp, sms)
 * implements the same send(alert, rate) contract so new channels can be added
 * without touching the target engine that calls this module. Phase 1 ships
 * no channels — the frontend's mock-data notification demo (see
 * frontend/app.js) exercises the Browser Notification API directly and is
 * NOT wired to this module yet.
 *
 * @param {{ channel: "browser"|"email"|"telegram"|"whatsapp"|"sms", alertId: string }} target
 * @param {{ currency: string, rateType: string, rate: number, source: string,
 *           retrievedAt: string }} payload
 * @returns {Promise<{ delivered: boolean, deliveryStatus: string }>}
 */
async function notify(target, payload) {
  throw new Error('notify() is not implemented yet — Phase 6/10 scaffold.');
}

module.exports = { notify };
