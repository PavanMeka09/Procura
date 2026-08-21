import type { NegotiationSession, Offer } from '../domain';

const MAX_ALLOWED_ROUNDS = 5;
const MAXIMUM_RISK_THRESHOLD = 0.9;

/**
 * Checks whether autonomous negotiation should gracefully stop.
 * Returns a human-readable stop reason if a condition is triggered, or null to continue.
 */
export function shouldStop(
  session: NegotiationSession,
  offer?: Offer
): string | null {
  // Condition 1: Ceiling on negotiation rounds reached
  if (session.currentRound >= MAX_ALLOWED_ROUNDS) {
    return `Maximum negotiation rounds reached (${MAX_ALLOWED_ROUNDS}).`;
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
