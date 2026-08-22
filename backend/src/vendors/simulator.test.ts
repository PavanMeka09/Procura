import { describe, expect, test } from 'bun:test';
import { getVendorResponse, seededVendors, VENDOR_IDS } from './simulator';
import type { ProcurementRequest } from '../domain';

const sampleRequest: ProcurementRequest = {
  item: 'business laptops',
  quantity: 500,
  targetUnitPrice: 55000,
  maximumUnitPrice: 57000,
  deliveryDays: 21,
  minimumWarrantyMonths: 24,
  maximumAdvancePaymentPercent: 20,
  negotiableTerms: ['unit price', 'delivery schedule'],
  nonNegotiableTerms: ['maximum unit price', 'minimum warranty'],
};

describe('vendor subsystem & multi-agent counter-party engine', () => {
  test('returns a deterministic offer in seeded mode', async () => {
    const vendor = seededVendors('req-1').find((v) => v.id === VENDOR_IDS.vertex)!;
    const result = await getVendorResponse(vendor, {
      requestId: 'req-1',
      roundNumber: 1,
      request: sampleRequest,
      failureConsumed: true,
      mode: 'seeded',
    });

    if (!('offer' in result) || !result.offer) throw new Error('Expected offer');
    expect(result.offer.unitPrice).toBe(58000);
    expect(result.offer.warrantyMonths).toBe(24);
  });

  test('exposes controlled failure once then recovers', async () => {
    const vendor = seededVendors('req-2').find((v) => v.id === VENDOR_IDS.vertex)!;
    const failureResult = await getVendorResponse(vendor, {
      requestId: 'req-2',
      roundNumber: 1,
      request: sampleRequest,
      failureConsumed: false,
      mode: 'seeded',
    });

    expect(failureResult).toEqual({ failure: 'tool failure' });

    const recoveryResult = await getVendorResponse(vendor, {
      requestId: 'req-2',
      roundNumber: 1,
      request: sampleRequest,
      failureConsumed: true,
      mode: 'seeded',
    });

    expect('offer' in recoveryResult).toBe(true);
  });

  test('dynamic AI vendor agent reacts directly to buyer counter-offers', async () => {
    const vendor = seededVendors('req-3').find((v) => v.id === VENDOR_IDS.apex)!;

    // Round 1: Initial quote
    const r1 = await getVendorResponse(vendor, {
      requestId: 'req-3',
      roundNumber: 1,
      request: sampleRequest,
      failureConsumed: true,
      mode: 'dynamic',
    });

    if (!('offer' in r1)) throw new Error('Expected offer in r1');
    expect(r1.offer.unitPrice).toBe(60000);

    // Round 2: Buyer counters aggressively with ₹56,000 and 20% advance
    const r2 = await getVendorResponse(vendor, {
      requestId: 'req-3',
      roundNumber: 2,
      request: sampleRequest,
      lastCounterMessage: 'We propose ₹56,000 per unit with 20% advance payment.',
      lastProposedTerms: {
        unitPrice: 56000,
        advancePaymentPercent: 20,
        deliveryDays: 20,
        warrantyMonths: 24,
      },
      failureConsumed: true,
      mode: 'dynamic',
    });

    if (!('offer' in r2)) throw new Error('Expected offer in r2');
    // Vendor dynamically conceded from 60,000 towards buyer's 56,000
    expect(r2.offer.unitPrice).toBeLessThan(60000);
    expect(r2.offer.unitPrice).toBeGreaterThanOrEqual(vendor.privateConstraints!.floorUnitPrice);
    expect(r2.offer.rawResponse.length).toBeGreaterThan(10);
  });

  test('dynamic vendor never breaches private floor constraint', async () => {
    const vendor = seededVendors('req-4').find((v) => v.id === VENDOR_IDS.northstar)!;

    // Buyer makes an unrealistic bid of ₹40,000 (well below Northstar floor of ₹56,000)
    const result = await getVendorResponse(vendor, {
      requestId: 'req-4',
      roundNumber: 2,
      request: sampleRequest,
      lastCounterMessage: 'We offer ₹40,000 per unit.',
      lastProposedTerms: { unitPrice: 40000 },
      failureConsumed: true,
      mode: 'dynamic',
    });

    if (!('offer' in result)) throw new Error('Expected offer');
    // Northstar holds firm at or above its private floor price of ₹56,000
    expect(result.offer.unitPrice).toBeGreaterThanOrEqual(56000);
  });

  test('seeded Vertex offers compliant ₹55,000 in round 3 meeting under ₹55,000 budget', async () => {
    const vendor = seededVendors('req-5').find((v) => v.id === VENDOR_IDS.vertex)!;
    const result = await getVendorResponse(vendor, {
      requestId: 'req-5',
      roundNumber: 3,
      request: sampleRequest,
      failureConsumed: true,
      mode: 'seeded',
    });

    if (!('offer' in result)) throw new Error('Expected offer in round 3');
    expect(result.offer.unitPrice).toBe(55000);
    expect(result.offer.warrantyMonths).toBe(24);
    expect(result.offer.deliveryDays).toBe(21);
    expect(result.offer.advancePaymentPercent).toBe(20);
  });

  test('dynamically leverages competitor prices in later vendor rounds', async () => {
    const { createSession } = await import('../agent/orchestrator');
    const { createDeterministicModelAdapters } = await import('../ai/models');

    const session = createSession('req-auction-1', sampleRequest);
    const adapters = createDeterministicModelAdapters();

    // Simulate Apex completing round 3 with compliant offer at ₹56,500
    const apexVendor = session.vendors.find((v) => v.id === VENDOR_IDS.apex)!;
    const apexOffer = {
      id: 'apex-offer-r3',
      requestId: 'req-auction-1',
      vendorId: apexVendor.id,
      roundNumber: 3,
      rawResponse: 'Apex round 3 offer',
      unitPrice: 56500,
      totalPrice: 56500 * sampleRequest.quantity,
      deliveryDays: 20,
      warrantyMonths: 24,
      advancePaymentPercent: 20,
      paymentTerms: '20% advance, balance on delivery',
      validityDays: 15,
      additionalConditions: [],
      extractionConfidence: 1,
      policyStatus: 'PASS' as const,
    };
    session.offers.push(apexOffer);
    session.currentBestOffer = apexOffer;

    // Now Northstar quotes round 1 at ₹62,000
    const northstarVendor = session.vendors.find((v) => v.id === VENDOR_IDS.northstar)!;
    const northstarOffer = {
      id: 'northstar-offer-r1',
      requestId: 'req-auction-1',
      vendorId: northstarVendor.id,
      roundNumber: 1,
      rawResponse: 'Northstar round 1 quote',
      unitPrice: 62000,
      totalPrice: 62000 * sampleRequest.quantity,
      deliveryDays: 14,
      warrantyMonths: 36,
      advancePaymentPercent: 20,
      paymentTerms: '20% advance, balance on delivery',
      validityDays: 15,
      additionalConditions: [],
      extractionConfidence: 1,
      policyStatus: 'PASS' as const,
    };

    const actionResult = await adapters.negotiator.proposeAction(session, northstarOffer);
    const action = actionResult.action;

    expect(action.type).toBe('SEND_COUNTER');
    if (action.type === 'SEND_COUNTER') {
      // Counter must specifically leverage Apex's ₹56,500 offer
      expect(action.message).toContain('Apex Devices');
      expect(action.message).toContain('56,500');
      expect(action.message).toContain('Can you beat that?');
      // Proposed price should beat or match competitor benchmark
      expect(action.proposedTerms.unitPrice).toBeLessThanOrEqual(56000);
      expect(action.rationale).toContain('Apex Devices');
    }
  });

  test('buildPromptContext correctly formats competitiveBenchmark and competitorOffersSummary', async () => {
    const { createSession } = await import('../agent/orchestrator');
    const { buildPromptContext } = await import('../ai/models');

    const session = createSession('req-auction-2', sampleRequest);

    // Initial offer from Apex (no competitor offers exist yet)
    const apexVendor = session.vendors.find((v) => v.id === VENDOR_IDS.apex)!;
    const apexOffer = {
      id: 'apex-o1',
      requestId: 'req-auction-2',
      vendorId: apexVendor.id,
      roundNumber: 1,
      rawResponse: 'Apex quote',
      unitPrice: 60000,
      totalPrice: 30000000,
      deliveryDays: 20,
      warrantyMonths: 24,
      advancePaymentPercent: 20,
      paymentTerms: '20% advance',
      validityDays: 15,
      additionalConditions: [],
      extractionConfidence: 1,
      policyStatus: 'PASS' as const,
    };

    const initialContext = JSON.parse(buildPromptContext(session, apexOffer));
    expect(initialContext.competitiveBenchmark).toBeNull();
    expect(initialContext.competitorOffersSummary).toHaveLength(0);

    // After Apex finishes round 3, register compliant offer
    session.offers.push(apexOffer);
    session.currentBestOffer = apexOffer;

    // Northstar round 1 context
    const northstarVendor = session.vendors.find((v) => v.id === VENDOR_IDS.northstar)!;
    const northstarOffer = {
      id: 'ns-o1',
      requestId: 'req-auction-2',
      vendorId: northstarVendor.id,
      roundNumber: 1,
      rawResponse: 'Northstar quote',
      unitPrice: 62000,
      totalPrice: 31000000,
      deliveryDays: 14,
      warrantyMonths: 36,
      advancePaymentPercent: 20,
      paymentTerms: '20% advance',
      validityDays: 15,
      additionalConditions: [],
      extractionConfidence: 1,
      policyStatus: 'PASS' as const,
    };

    const nsContext = JSON.parse(buildPromptContext(session, northstarOffer));
    expect(nsContext.competitiveBenchmark).not.toBeNull();
    expect(nsContext.competitiveBenchmark.vendorName).toBe('Apex Devices');
    expect(nsContext.competitiveBenchmark.unitPrice).toBe(60000);
    expect(nsContext.competitiveBenchmark.isFromCompetitor).toBe(true);
    expect(nsContext.competitorOffersSummary).toHaveLength(1);
    expect(nsContext.competitorOffersSummary[0].vendorName).toBe('Apex Devices');
    expect(nsContext.competitorOffersSummary[0].latestUnitPrice).toBe(60000);
  });
});
