import { describe, expect, test } from 'bun:test';
import { parseOffer, ParsingError } from './offer-parser';
import { seededVendors } from './vendors/simulator';

describe('offer parser', () => {
  test('normalizes a natural language response', () => { const vendor = seededVendors('request')[2]!; const parsed = parseOffer('We can supply 55,500 INR per unit, delivery in 21 days, 24-month warranty, and 20% advance payment (balance on delivery).', 'request', vendor, 1, 500); expect(parsed.unitPrice).toBe(55500); expect(parsed.totalPrice).toBe(27750000); });
  test('rejects incomplete response', () => expect(() => parseOffer('We can probably meet your request.', 'request', seededVendors('request')[0]!, 1, 500)).toThrow(ParsingError));
});
