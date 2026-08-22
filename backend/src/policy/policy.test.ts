import { describe, expect, test } from 'bun:test';
import { evaluateAction } from './decision-gate';
import { validateOffer } from './engine';
import type { AgentAction, Offer, ProcurementRequest } from '../domain';
import { VENDOR_IDS } from '../vendors/simulator';

const request: ProcurementRequest = { item: 'business laptops', quantity: 500, targetUnitPrice: 55000, maximumUnitPrice: 57000, deliveryDays: 21, minimumWarrantyMonths: 24, maximumAdvancePaymentPercent: 20, negotiableTerms: [], nonNegotiableTerms: [] };
const makeOffer = (overrides: Partial<Offer> = {}): Offer => ({ id: 'offer', requestId: 'request', vendorId: VENDOR_IDS.vertex, roundNumber: 1, rawResponse: '', unitPrice: 55500, totalPrice: 27750000, deliveryDays: 21, warrantyMonths: 24, advancePaymentPercent: 20, paymentTerms: 'balance on delivery', validityDays: 15, additionalConditions: [], extractionConfidence: 1, ...overrides });
const passCritic = { decision: 'PASS' as const, confidence: 0.95, policyViolations: [], concerns: [], evidence: [], requiresHumanReview: false };
const accept: AgentAction = { type: 'ACCEPT', vendorId: VENDOR_IDS.vertex, offerId: 'offer', rationale: 'compliant' };

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
  test('pass plus pass executes', () => expect(evaluateAction(accept, passCritic, validateOffer(makeOffer(), request), 1, 3, 0.1).decision).toBe('EXECUTE'));
  test('critic block blocks', () => expect(evaluateAction(accept, { ...passCritic, decision: 'BLOCK' }, validateOffer(makeOffer(), request), 1, 3, 0.1).decision).toBe('BLOCK'));
  test('missing critic fails closed', () => expect(evaluateAction(accept, null, validateOffer(makeOffer(), request), 1, 3, 0.1).decision).toBe('HUMAN_REVIEW'));
  test('max rounds stops', () => {
    const result = evaluateAction(accept, passCritic, validateOffer(makeOffer(), request), 3, 3, 0.1);
    expect(result.decision).toBe('STOP');
    expect(result.reason).toBe('Maximum negotiation rounds reached (3 per vendor).');
  });
});

describe('human review resolution lifecycle', () => {
  test('human review approval executes without infinite loop when deterministic policy passes', async () => {
    const { createSession, resumeSession } = await import('../agent/orchestrator');
    const { store } = await import('../store');
    const { createDeterministicModelAdapters } = await import('../ai/models');

    const session = createSession('req-test-approval', request);
    const offer = makeOffer({ requestId: 'req-test-approval' });
    session.offers.push(offer);
    session.currentState = 'HUMAN_REVIEW';
    session.pendingAction = {
      type: 'ACCEPT',
      vendorId: VENDOR_IDS.vertex,
      offerId: offer.id,
      rationale: 'Accept after human approval',
    };
    session.humanReview = {
      id: 'rev-1',
      reason: 'Flagged for human sign-off',
      proposedAction: session.pendingAction,
      evidence: ['High-value order'],
      status: 'APPROVED',
      createdAt: new Date().toISOString(),
    };

    const resumed = await resumeSession(session.id, createDeterministicModelAdapters());
    expect(resumed?.currentState).toBe('ACCEPTED');
    expect(resumed?.humanReview).toBeNull();
    expect(resumed?.pendingAction).toBeNull();
  });

  test('human review rejection continues to evaluate remaining vendors instead of terminating', async () => {
    const { createSession, rejectAndResumeSession } = await import('../agent/orchestrator');
    const { createDeterministicModelAdapters } = await import('../ai/models');

    const session = createSession('req-test-rejection', request);
    session.currentState = 'HUMAN_REVIEW';
    session.currentVendorId = session.vendors[0]?.id ?? null;
    session.pendingAction = {
      type: 'SEND_COUNTER',
      vendorId: session.vendors[0]?.id ?? 'v1',
      message: 'Counteroffer',
      proposedTerms: { unitPrice: 54000 },
      rationale: 'Counter',
    };
    session.humanReview = {
      id: 'rev-2',
      reason: 'Held for review',
      proposedAction: session.pendingAction,
      evidence: [],
      status: 'REJECTED',
      createdAt: new Date().toISOString(),
    };

    const resumed = await rejectAndResumeSession(session.id, createDeterministicModelAdapters());
    // Rejection should NOT terminate the session as STOPPED if there are compliant alternatives
    expect(resumed?.currentState).not.toBe('HUMAN_REVIEW');
    expect(resumed?.humanReview).toBeNull();
    const hasRejectedEvent = session.events.some((e) => e.type === 'HUMAN_REJECTED');
    expect(hasRejectedEvent).toBe(true);
  });
});
