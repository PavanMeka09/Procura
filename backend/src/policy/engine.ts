import type { AgentAction, Offer, PolicyResult, ProcurementRequest } from '../domain';

export const validateOffer = (offer: Offer, request: ProcurementRequest): PolicyResult => {
  const violations: string[] = [];
  const warnings: string[] = [];
  if (offer.unitPrice > request.maximumUnitPrice) violations.push(`UNIT_PRICE_TOO_HIGH: ₹${offer.unitPrice.toLocaleString('en-IN')} exceeds ₹${request.maximumUnitPrice.toLocaleString('en-IN')}.`);
  if (offer.warrantyMonths < request.minimumWarrantyMonths) violations.push(`WARRANTY_TOO_SHORT: ${offer.warrantyMonths} months is below ${request.minimumWarrantyMonths} months.`);
  if (offer.deliveryDays > request.deliveryDays) violations.push(`DELIVERY_TOO_SLOW: ${offer.deliveryDays} days exceeds ${request.deliveryDays} days.`);
  if (offer.advancePaymentPercent > request.maximumAdvancePaymentPercent) violations.push(`ADVANCE_PAYMENT_TOO_HIGH: ${offer.advancePaymentPercent}% exceeds ${request.maximumAdvancePaymentPercent}%.`);
  if (offer.extractionConfidence < 0.8) warnings.push('OFFER_EXTRACTION_LOW_CONFIDENCE');
  if (offer.unitPrice > (request.targetUnitPrice ?? request.maximumUnitPrice)) warnings.push('ABOVE_TARGET_PRICE');
  return { decision: violations.length ? 'BLOCK' : warnings.includes('OFFER_EXTRACTION_LOW_CONFIDENCE') ? 'HUMAN_REVIEW' : 'PASS', violations, warnings, evidence: [`Max price ₹${request.maximumUnitPrice.toLocaleString('en-IN')}`, `Delivery ≤ ${request.deliveryDays} days`, `Warranty ≥ ${request.minimumWarrantyMonths} months`, `Advance ≤ ${request.maximumAdvancePaymentPercent}%`] };
};

export const getViolations = (offer: Offer, request: ProcurementRequest) => validateOffer(offer, request).violations;
export const requiresHumanReview = (action: AgentAction, result: PolicyResult, vendorApproved = true) => !vendorApproved || action.type === 'ESCALATE' || result.decision === 'HUMAN_REVIEW';

export const validateAction = (action: AgentAction, request: ProcurementRequest, offer: Offer | null): PolicyResult => {
  if (action.type === 'STOP' || action.type === 'ESCALATE') return { decision: action.type === 'ESCALATE' ? 'HUMAN_REVIEW' : 'PASS', violations: [], warnings: [], evidence: ['No vendor mutation is authorized by this action.'] };
  const proposed: Offer = offer ? { ...offer, unitPrice: action.type === 'SEND_COUNTER' ? action.proposedTerms.unitPrice : offer.unitPrice, deliveryDays: action.type === 'SEND_COUNTER' ? action.proposedTerms.deliveryDays ?? offer.deliveryDays : offer.deliveryDays, warrantyMonths: action.type === 'SEND_COUNTER' ? action.proposedTerms.warrantyMonths ?? offer.warrantyMonths : offer.warrantyMonths, advancePaymentPercent: action.type === 'SEND_COUNTER' ? action.proposedTerms.advancePaymentPercent ?? offer.advancePaymentPercent : offer.advancePaymentPercent } : { id: 'pending', requestId: '', vendorId: action.vendorId, roundNumber: 0, rawResponse: '', unitPrice: action.type === 'SEND_COUNTER' ? action.proposedTerms.unitPrice : Number.MAX_SAFE_INTEGER, totalPrice: 0, deliveryDays: action.type === 'SEND_COUNTER' ? action.proposedTerms.deliveryDays ?? request.deliveryDays : request.deliveryDays, warrantyMonths: action.type === 'SEND_COUNTER' ? action.proposedTerms.warrantyMonths ?? request.minimumWarrantyMonths : request.minimumWarrantyMonths, advancePaymentPercent: action.type === 'SEND_COUNTER' ? action.proposedTerms.advancePaymentPercent ?? request.maximumAdvancePaymentPercent : request.maximumAdvancePaymentPercent, paymentTerms: '', validityDays: null, additionalConditions: [], extractionConfidence: 1 };
  return validateOffer(proposed, request);
};
export const canExecute = (policy: PolicyResult) => policy.decision === 'PASS';
