import { describe, expect, test } from 'bun:test';
import { extractRequirements, extractRequirementsRegexFallback } from './requirements';
import { createSession, runSession } from './agent/orchestrator';
import { createDeterministicModelAdapters } from './ai/models';

describe('requirement extraction', () => {
  test(
    'does not treat the advance percentage as an INR price cap',
    async () => {
      const request = await extractRequirements(
        'Buy 500 business laptops under ₹55,000 each, delivery within 21 days, min 2-year warranty, max 20% advance'
      );

      expect(request.targetUnitPrice).toBe(55000);
      expect(request.maximumUnitPrice).toBe(55000);
      expect(request.maximumAdvancePaymentPercent).toBe(20);
    },
    40000
  );

  test(
    'supports an explicit maximum price or budget',
    async () => {
      const request = await extractRequirements(
        'Buy 50 monitors with maximum budget ₹48,000, delivery within 14 days'
      );

      expect(request.maximumUnitPrice).toBe(48000);
    },
    40000
  );

  test(
    'extracts complex colloquial natural language requirements',
    async () => {
      const request = await extractRequirements(
        "We're outfitting 50 remote engineers with high-end workstations under two lakhs each, needed in three weeks"
      );

      expect(request.quantity).toBe(50);
      expect(request.maximumUnitPrice).toBe(200000);
      expect(request.deliveryDays).toBe(21);
      expect(request.item.toLowerCase()).toContain('workstation');
      expect(request.minimumWarrantyMonths).toBe(24);
      expect(request.maximumAdvancePaymentPercent).toBe(20);
    },
    40000
  );

  test(
    'default demo prompt executes and successfully accepts compliant offer within policy',
    async () => {
      const defaultDemoInput =
        'Buy 500 business laptops under ₹55,000 each, delivery within 21 days, min 2-year warranty, max 20% advance';
      const request = await extractRequirements(defaultDemoInput);
      const session = createSession('demo-session-req-1', request);
      await runSession(session.id, createDeterministicModelAdapters());

      expect(session.currentState).toBe('ACCEPTED');
      expect(session.currentBestOffer).not.toBeNull();
      expect(session.currentBestOffer!.unitPrice).toBeLessThanOrEqual(55000);
      expect(session.currentBestOffer!.advancePaymentPercent).toBeLessThanOrEqual(20);
      expect(session.currentBestOffer!.deliveryDays).toBeLessThanOrEqual(21);
      expect(session.currentBestOffer!.warrantyMonths).toBeGreaterThanOrEqual(24);
    },
    40000
  );

  test(
    'rejects conversational model identity questions',
    async () => {
      await expect(
        extractRequirements('tell me which model are you, who are you')
      ).rejects.toThrow(/not contain a valid procurement requirement|conversational/i);
    },
    40000
  );

  test(
    'rejects general chit-chat and greetings without procurement intent',
    async () => {
      await expect(
        extractRequirements('hello, how are you doing today?')
      ).rejects.toThrow(/not contain a valid procurement requirement|conversational/i);
    },
    40000
  );

  test('regex fallback rejects non-procurement conversational inputs synchronously', () => {
    expect(() =>
      extractRequirementsRegexFallback('tell me which model are you, who are you')
    ).toThrow(/not contain a valid procurement requirement/i);

    expect(() =>
      extractRequirementsRegexFallback('what can you do for me?')
    ).toThrow(/not contain a valid procurement requirement/i);
  });
});

