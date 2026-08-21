import { describe, expect, test } from 'bun:test';
import { evaluateAction } from './decision-gate';
import { validateOffer } from './engine';
import type { AgentAction, Offer, ProcurementRequest } from '../domain';

const request: ProcurementRequest = { item: 'business laptops', quantity: 500, targetUnitPrice: 55000, maximumUnitPrice: 57000, deliveryDays: 21, minimumWarrantyMonths: 24, maximumAdvancePaymentPercent: 20, negotiableTerms: [], nonNegotiableTerms: [] };
const makeOffer = (overrides: Partial<Offer> = {}): Offer => ({ id: 'offer', requestId: 'request', vendorId: 'vendor-c', roundNumber: 1, rawResponse: '', unitPrice: 55500, totalPrice: 27750000, deliveryDays: 21, warrantyMonths: 24, advancePaymentPercent: 20, paymentTerms: 'balance on delivery', validityDays: 15, additionalConditions: [], extractionConfidence: 1, ...overrides });
const passCritic = { decision: 'PASS' as const, confidence: 0.95, policyViolations: [], concerns: [], evidence: [], requiresHumanReview: false };
const accept: AgentAction = { type: 'ACCEPT', vendorId: 'vendor-c', offerId: 'offer', rationale: 'compliant' };

describe('policy engine', () => {
  test('blocks price, warranty, delivery and advance violations', () => {
    expect(validateOffer(makeOffer({ unitPrice: 58000 }), request).decision).toBe('BLOCK');
    expect(validateOffer(makeOffer({ warrantyMonths: 12 }), request).decision).toBe('BLOCK');
    expect(validateOffer(makeOffer({ deliveryDays: 25 }), request).decision).toBe('BLOCK');
    expect(validateOffer(makeOffer({ advancePaymentPercent: 35 }), request).decision).toBe('BLOCK');
  });
  test('passes a compliant offer', () => expect(validateOffer(makeOffer(), request).decision).toBe('PASS'));
});

describe('decision gate', () => {
  test('pass plus pass executes', () => expect(evaluateAction(accept, passCritic, validateOffer(makeOffer(), request), 1, 5, 0.1).decision).toBe('EXECUTE'));
  test('critic block blocks', () => expect(evaluateAction(accept, { ...passCritic, decision: 'BLOCK' }, validateOffer(makeOffer(), request), 1, 5, 0.1).decision).toBe('BLOCK'));
  test('missing critic fails closed', () => expect(evaluateAction(accept, null, validateOffer(makeOffer(), request), 1, 5, 0.1).decision).toBe('HUMAN_REVIEW'));
  test('max rounds stops', () => expect(evaluateAction(accept, passCritic, validateOffer(makeOffer(), request), 5, 5, 0.1).decision).toBe('STOP'));
});
