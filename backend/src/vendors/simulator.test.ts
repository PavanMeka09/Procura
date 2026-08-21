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
});
