import { describe, expect, test } from 'bun:test';
import { getVendorResponse, seededVendors, VENDOR_IDS } from './simulator';

describe('vendor simulator', () => {
  test('returns a deterministic offer', () => { const vendor = seededVendors('request').find((item) => item.id === VENDOR_IDS.vertex)!; const result = getVendorResponse(vendor, 1, 'request', { item: 'laptops', quantity: 500, targetUnitPrice: 55000, maximumUnitPrice: 57000, deliveryDays: 21, minimumWarrantyMonths: 24, maximumAdvancePaymentPercent: 20, negotiableTerms: [], nonNegotiableTerms: [] }, true); if (!('offer' in result) || !result.offer) throw new Error('Expected offer'); expect(result.offer.unitPrice).toBe(58000); });
  test('exposes controlled failure once then recovers', () => { const vendor = seededVendors('request').find((item) => item.id === VENDOR_IDS.vertex)!; const request = { item: 'laptops', quantity: 500, targetUnitPrice: 55000, maximumUnitPrice: 57000, deliveryDays: 21, minimumWarrantyMonths: 24, maximumAdvancePaymentPercent: 20, negotiableTerms: [], nonNegotiableTerms: [] }; expect(getVendorResponse(vendor, 1, 'request', request, false)).toEqual({ failure: 'tool failure' }); expect('offer' in getVendorResponse(vendor, 1, 'request', request, true)).toBe(true); });
});
