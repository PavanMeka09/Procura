import { describe, expect, test } from 'bun:test';
import { parseOffer, ParsingError } from './offer-parser';
import { seededVendors } from './vendors/simulator';

describe('offer parser', () => {
  test(
    'normalizes a standard natural language response',
    async () => {
      const vendor = seededVendors('request')[2]!;
      const parsed = await parseOffer(
        'We can supply 55,500 INR per unit, delivery in 21 days, 24-month warranty, and 20% advance payment (balance on delivery).',
        'request',
        vendor,
        1,
        500
      );
      expect(parsed.unitPrice).toBe(55500);
      expect(parsed.totalPrice).toBe(27750000);
      expect(parsed.deliveryDays).toBe(21);
      expect(parsed.warrantyMonths).toBe(24);
      expect(parsed.advancePaymentPercent).toBe(20);
    },
    15000
  );

  test(
    'parses colloquial natural language vendor offers with lakhs and weeks',
    async () => {
      const vendor = seededVendors('request')[1]!;
      const parsed = await parseOffer(
        'We are pleased to quote 1.85 lakhs per unit, delivery in 3 weeks, 3-year warranty, and 15% upfront advance.',
        'request',
        vendor,
        1,
        50
      );
      expect(parsed.unitPrice).toBe(185000);
      expect(parsed.totalPrice).toBe(9250000);
      expect(parsed.deliveryDays).toBe(21);
      expect(parsed.warrantyMonths).toBe(36);
      expect(parsed.advancePaymentPercent).toBe(15);
    },
    15000
  );

  test(
    'rejects incomplete response without commercial parameters',
    async () => {
      const vendor = seededVendors('request')[0]!;
      await expect(
        parseOffer('We can probably meet your request.', 'request', vendor, 1, 500)
      ).rejects.toThrow(ParsingError);
    },
    15000
  );
});

