import type { NegotiationSession, Offer } from '../domain';
export const shouldStop = (session: NegotiationSession, offer?: Offer) => {
  if (session.currentRound >= 5) return 'Maximum negotiation rounds reached (5).';
  if (session.riskScore >= 0.9) return 'Risk exceeded the configured threshold.';
  if (offer && session.targetUnitPrice && offer.unitPrice <= session.targetUnitPrice && offer.advancePaymentPercent <= session.maximumAdvancePaymentPercent && offer.deliveryDays <= session.maximumDeliveryDays && offer.warrantyMonths >= session.minimumWarrantyMonths) return null;
  return null;
};
