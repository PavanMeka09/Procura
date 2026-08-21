import { describe, expect, test } from 'bun:test';
import { extractRequirements } from './requirements';

describe('requirement extraction', () => {
  test('does not treat the advance percentage as an INR price cap', () => {
    const request = extractRequirements(
      'Buy 500 business laptops under ₹55,000 each, delivery within 21 days, min 2-year warranty, max 20% advance'
    );

    expect(request.targetUnitPrice).toBe(55000);
    expect(request.maximumUnitPrice).toBe(55000);
    expect(request.maximumAdvancePaymentPercent).toBe(20);
  });

  test('supports an explicit maximum price or budget', () => {
    const request = extractRequirements(
      'Buy 50 monitors with maximum budget ₹48,000, delivery within 14 days'
    );

    expect(request.maximumUnitPrice).toBe(48000);
  });
});
