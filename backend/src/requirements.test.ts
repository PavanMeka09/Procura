import { describe, expect, test } from 'bun:test';
import { extractRequirements } from './requirements';
import { createSession, runSession } from './agent/orchestrator';
import { createDeterministicModelAdapters } from './ai/models';

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

  test('default demo prompt executes and successfully accepts compliant offer within policy', async () => {
    const defaultDemoInput =
      'Buy 500 business laptops under ₹55,000 each, delivery within 21 days, min 2-year warranty, max 20% advance';
    const request = extractRequirements(defaultDemoInput);
    const session = createSession('demo-session-req-1', request);
    await runSession(session.id, createDeterministicModelAdapters());

    expect(session.currentState).toBe('ACCEPTED');
    expect(session.currentBestOffer).not.toBeNull();
    expect(session.currentBestOffer!.unitPrice).toBeLessThanOrEqual(55000);
    expect(session.currentBestOffer!.advancePaymentPercent).toBeLessThanOrEqual(20);
    expect(session.currentBestOffer!.deliveryDays).toBeLessThanOrEqual(21);
    expect(session.currentBestOffer!.warrantyMonths).toBeGreaterThanOrEqual(24);
  });
});
