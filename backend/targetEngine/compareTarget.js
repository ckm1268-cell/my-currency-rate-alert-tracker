/**
 * Target comparison engine — Phase 5
 * =====================================
 * STATUS: scaffold only.
 *
 * Evaluates a validated live rate against a user's Alert. Default condition
 * is "live rate <= target rate". See the "Target Rate Logic" section of the
 * project reference pack for the full condition set (reaches, below, at-or-
 * below, above, changes by X%) and the duplicate-alert-suppression rule:
 * once an alert's status flips to TRIGGERED it must not re-fire on every
 * subsequent qualifying check — only on reset or a new qualifying event
 * after the user re-arms it.
 *
 * @param {{ liveRate: number, targetRate: number,
 *           condition: "AT_OR_BELOW"|"BELOW"|"REACHES"|"ABOVE"|"PCT_CHANGE" }} params
 * @returns {boolean}
 */
function isTargetMet(params) {
  throw new Error('isTargetMet() is not implemented yet — Phase 5 scaffold.');
}

module.exports = { isTargetMet };
