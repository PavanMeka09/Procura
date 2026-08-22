import type {
  AgentAction,
  Offer,
  PolicyResult,
  ProcurementRequest,
} from '../domain';

/**
 * Validates a commercial vendor offer against hard constraints (caps) and soft targets.
 */
export function validateOffer(
  offer: Offer,
  request: ProcurementRequest
): PolicyResult {
  const violations: string[] = [];
  const warnings: string[] = [];

  // Hard Constraint 1: Unit Price Cap
  if (offer.unitPrice > request.maximumUnitPrice) {
    violations.push(
      `UNIT_PRICE_TOO_HIGH: ₹${offer.unitPrice.toLocaleString('en-IN')} exceeds maximum allowed ₹${request.maximumUnitPrice.toLocaleString('en-IN')}.`
    );
  }

  // Hard Constraint 2: Minimum Warranty Period
  if (offer.warrantyMonths < request.minimumWarrantyMonths) {
    violations.push(
      `WARRANTY_TOO_SHORT: ${offer.warrantyMonths} months is below required ${request.minimumWarrantyMonths} months.`
    );
  }

  // Hard Constraint 3: Maximum Delivery Schedule
  if (offer.deliveryDays > request.deliveryDays) {
    violations.push(
      `DELIVERY_TOO_SLOW: ${offer.deliveryDays} days exceeds required ${request.deliveryDays} days.`
    );
  }

  // Hard Constraint 4: Maximum Advance Payment
  if (offer.advancePaymentPercent > request.maximumAdvancePaymentPercent) {
    violations.push(
      `ADVANCE_PAYMENT_TOO_HIGH: ${offer.advancePaymentPercent}% exceeds maximum allowed ${request.maximumAdvancePaymentPercent}%.`
    );
  }

  // Soft Warnings
  if (offer.extractionConfidence < 0.8) {
    warnings.push('OFFER_EXTRACTION_LOW_CONFIDENCE');
  }

  const targetPrice = request.targetUnitPrice ?? request.maximumUnitPrice;
  if (offer.unitPrice > targetPrice) {
    warnings.push('ABOVE_TARGET_PRICE');
  }

  // Determine policy outcome
  let decision: PolicyResult['decision'] = 'PASS';
  if (violations.length > 0) {
    decision = 'BLOCK';
  } else if (warnings.includes('OFFER_EXTRACTION_LOW_CONFIDENCE')) {
    decision = 'HUMAN_REVIEW';
  }

  return {
    decision,
    violations,
    warnings,
    evidence: [
      `Max price ₹${request.maximumUnitPrice.toLocaleString('en-IN')}`,
      `Delivery ≤ ${request.deliveryDays} days`,
      `Warranty ≥ ${request.minimumWarrantyMonths} months`,
      `Advance ≤ ${request.maximumAdvancePaymentPercent}%`,
    ],
  };
}

/**
 * Returns a list of constraint violations for an offer.
 */
export function getViolations(offer: Offer, request: ProcurementRequest): string[] {
  return validateOffer(offer, request).violations;
}

/**
 * Checks if human review is strictly required before an action can execute.
 */
export function requiresHumanReview(
  action: AgentAction,
  result: PolicyResult,
  vendorApproved: boolean = true
): boolean {
  return (
    !vendorApproved ||
    action.type === 'ESCALATE' ||
    result.decision === 'HUMAN_REVIEW'
  );
}

/**
 * Validates a proposed agent mutation (e.g. counteroffer terms or acceptance)
 * by evaluating the hypothetical post-action offer state against policy rules.
 */
export function validateAction(
  action: AgentAction,
  request: ProcurementRequest,
  offer: Offer | null
): PolicyResult {
  // Non-mutating actions pass by definition without modifying vendor state
  if (action.type === 'STOP' || action.type === 'ESCALATE') {
    return {
      decision: action.type === 'ESCALATE' ? 'HUMAN_REVIEW' : 'PASS',
      violations: [],
      warnings: [],
      evidence: ['No vendor mutation is authorized by this action.'],
    };
  }

  // Project proposed counteroffer terms onto the existing or synthetic offer
  const terms = action.type === 'SEND_COUNTER' ? action.proposedTerms : undefined;
  const proposedOffer: Offer = {
    ...(offer ?? {
      id: 'pending',
      requestId: '',
      vendorId: action.vendorId,
      roundNumber: 0,
      rawResponse: '',
      totalPrice: 0,
      paymentTerms: '',
      validityDays: null,
      additionalConditions: [],
      extractionConfidence: 1,
    }),
    unitPrice: terms?.unitPrice ?? offer?.unitPrice ?? Number.MAX_SAFE_INTEGER,
    deliveryDays: terms?.deliveryDays ?? offer?.deliveryDays ?? request.deliveryDays,
    warrantyMonths: terms?.warrantyMonths ?? offer?.warrantyMonths ?? request.minimumWarrantyMonths,
    advancePaymentPercent: terms?.advancePaymentPercent ?? offer?.advancePaymentPercent ?? request.maximumAdvancePaymentPercent,
  };

  return validateOffer(proposedOffer, request);
}

/**
 * Returns true if the policy engine fully greenlights execution.
 */
export function canExecute(policy: PolicyResult): boolean {
  return policy.decision === 'PASS';
}
