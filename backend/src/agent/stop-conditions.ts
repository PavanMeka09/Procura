import type { NegotiationSession, Offer } from '../domain';
import { config } from '../utils/config';

const MAXIMUM_RISK_THRESHOLD = 0.9;

/**
 * Checks whether autonomous negotiation should gracefully stop.
 * Returns a human-readable stop reason if a condition is triggered, or null to continue.
 */
export function shouldStop(
  session: NegotiationSession,
  offer?: Offer,
  maxRoundsPerVendor: number = config.maxRoundsPerVendor
): string | null {
  // Condition 1: Ceiling on negotiation rounds reached for current vendor
  if (session.currentRound >= maxRoundsPerVendor) {
    return `Maximum negotiation rounds reached (${maxRoundsPerVendor} per vendor).`;
  }

  // Condition 2: Elevated composite risk score exceeds safety limits
  if (session.riskScore >= MAXIMUM_RISK_THRESHOLD) {
    return 'Risk exceeded the configured threshold.';
  }

  // Condition 3: If an offer already hits all ideal targets, continue or finish cleanly
  if (
    offer &&
    session.targetUnitPrice &&
    offer.unitPrice <= session.targetUnitPrice &&
    offer.advancePaymentPercent <= session.maximumAdvancePaymentPercent &&
    offer.deliveryDays <= session.maximumDeliveryDays &&
    offer.warrantyMonths >= session.minimumWarrantyMonths
  ) {
    return null;
  }

  return null;
}
