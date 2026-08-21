/**
 * Rate validation — Phase 4
 * ===========================
 * STATUS: scaffold only. Not yet wired into the adapters.
 *
 * This module will apply the sanity checks described in the project
 * reference pack ("Prevent False Alerts" / "Rate Validation") to a raw
 * adapter reading before it is allowed to reach the target-comparison
 * engine: numeric, greater than zero, buy <= sell, within the currency's
 * expected range (config/websites/*.json → validation.expectedRange), and
 * fresh enough (retrievedAt / sourceTimestamp within the configured
 * freshness window).
 *
 * @param {{ currency: string, buyRate: number|null, sellRate: number|null,
 *           retrievedAt: string, expectedRange?: {min:number,max:number} }} reading
 * @returns {{ passed: boolean, reasons: string[] }}
 */
function validateRate(reading) {
  throw new Error('validateRate() is not implemented yet — Phase 4 scaffold.');
}

module.exports = { validateRate };
