/**
 * Rate validation — Phase 4 (partial: wired for the My Money Master adapter
 * in Phase 2; will be exercised by the Taj Muhabath adapter too once that's
 * built in Phase 3)
 * =====================================================================
 *
 * Applies the sanity checks described in the project reference pack
 * ("Prevent False Alerts" / "Rate Validation") to a raw adapter reading
 * BEFORE it is allowed to reach the target-comparison engine or be labeled
 * LIVE:
 *
 *   - both buyRate and sellRate must be present, numeric, and finite
 *   - both must be > 0
 *   - buyRate must be <= sellRate (a money changer buys low, sells high;
 *     a reversed reading is a strong signal of a scraping/parsing bug)
 *   - both must fall within the currency's expectedRange (from
 *     config/websites/*.json → validation.expectedRange) — this is what
 *     catches the classic "0.6053 instead of 60.53" decimal-placement bug
 *     called out explicitly in the project brief
 *   - retrievedAt must be a valid, parseable timestamp and not be in the
 *     future (a malformed clock/timestamp bug is still a validation
 *     failure even if the numbers themselves look plausible)
 *
 * This module does NOT check staleness/freshness against "now" — that is
 * the caller's job (the adapter or scheduler decides what "too old" means
 * for its own polling interval), since a validateRate() call is about
 * whether the READING ITSELF is sane, not how old it is.
 *
 * @param {{ currency: string, buyRate: number|null, sellRate: number|null,
 *           retrievedAt: string, expectedRange?: {min:number,max:number} }} reading
 * @returns {{ passed: boolean, reasons: string[] }}
 */
function validateRate(reading) {
  const reasons = [];

  if (!reading || typeof reading !== 'object') {
    return { passed: false, reasons: ['reading is missing or not an object'] };
  }

  const { currency, buyRate, sellRate, retrievedAt, expectedRange } = reading;

  if (!currency || typeof currency !== 'string') {
    reasons.push('currency code is missing or not a string');
  }

  for (const [label, value] of [['buyRate', buyRate], ['sellRate', sellRate]]) {
    if (value === null || value === undefined) {
      reasons.push(`${label} is missing (null/undefined)`);
    } else if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
      reasons.push(`${label} is not a finite number: ${JSON.stringify(value)}`);
    } else if (value <= 0) {
      reasons.push(`${label} must be greater than zero, got ${value}`);
    }
  }

  const buyOk = typeof buyRate === 'number' && Number.isFinite(buyRate) && buyRate > 0;
  const sellOk = typeof sellRate === 'number' && Number.isFinite(sellRate) && sellRate > 0;

  if (buyOk && sellOk && buyRate > sellRate) {
    reasons.push(
      `buyRate (${buyRate}) is greater than sellRate (${sellRate}) — a money ` +
      `changer buys low and sells high, so this direction is invalid and ` +
      `likely indicates a parsing bug (columns swapped, wrong selector, etc.)`
    );
  }

  if (expectedRange && typeof expectedRange.min === 'number' && typeof expectedRange.max === 'number') {
    for (const [label, value] of [['buyRate', buyRate], ['sellRate', sellRate]]) {
      if (typeof value === 'number' && Number.isFinite(value) &&
          (value < expectedRange.min || value > expectedRange.max)) {
        reasons.push(
          `${label} (${value}) is outside the expected range ` +
          `[${expectedRange.min}, ${expectedRange.max}] for ${currency || 'this currency'} — ` +
          `possible decimal-placement or unit-scaling error`
        );
      }
    }
  }

  if (!retrievedAt || Number.isNaN(Date.parse(retrievedAt))) {
    reasons.push(`retrievedAt is missing or not a parseable timestamp: ${JSON.stringify(retrievedAt)}`);
  } else if (Date.parse(retrievedAt) > Date.now() + 60_000) {
    // Allow a small (1 min) clock-skew tolerance rather than rejecting on
    // any future timestamp at all.
    reasons.push(`retrievedAt (${retrievedAt}) is in the future`);
  }

  return { passed: reasons.length === 0, reasons };
}

module.exports = { validateRate };
