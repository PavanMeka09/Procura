import { generateObject } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';
import { config } from '../utils/config';
import { ModelError, CriticError } from '../errors';
import type {
  AgentAction,
  CriticResult,
  NegotiationSession,
  Offer,
  ProposedTerms,
} from '../domain';

export interface NegotiatorProvider {
  proposeAction: (
    session: NegotiationSession,
    offer: Offer
  ) => Promise<{
    action: AgentAction;
    runs: NegotiationSession['modelRuns'];
    fallbackUsed: boolean;
  }>;
}

export interface CriticProvider {
  critique: (
    session: NegotiationSession,
    offer: Offer,
    action: AgentAction
  ) => Promise<{
    result: CriticResult;
    run: NegotiationSession['modelRuns'][number];
  }>;
}

export interface ModelAdapters {
  negotiator: NegotiatorProvider;
  critic: CriticProvider;
  executionMode: 'provider' | 'test-adapter';
}

// Zod schemas for structured LLM outputs
const actionSchema = z.object({
  type: z.enum(['SEND_COUNTER', 'ACCEPT', 'ESCALATE', 'STOP']),
  vendorId: z.string().uuid().optional(),
  offerId: z.string().uuid().optional(),
  message: z.string().max(2000).optional(),
  proposedTerms: z
    .object({
      unitPrice: z.number().finite().positive(),
      deliveryDays: z.number().int().positive().optional(),
      warrantyMonths: z.number().int().positive().optional(),
      advancePaymentPercent: z.number().int().min(0).max(100).optional(),
      paymentTerms: z.string().max(500).optional(),
    })
    .optional(),
  rationale: z.string().max(2000).optional(),
  reason: z.string().max(2000).optional(),
});

const criticSchema = z.object({
  decision: z.enum(['PASS', 'WARN', 'BLOCK']),
  confidence: z.number().min(0).max(1),
  policyViolations: z.array(z.string()),
  concerns: z.array(z.string()),
  evidence: z.array(z.string()),
  requiresHumanReview: z.boolean(),
});

/**
 * Builds standard serialized context for LLM prompts including active competitive auction benchmarks.
 */
export function buildPromptContext(session: NegotiationSession, offer: Offer): string {
  const defaultEvidence = [
    'Maximum advance payment is 20%',
    'Minimum warranty is 24 months',
    'Maximum delivery is 21 days',
  ];

  const currentVendor = session.vendors.find((v) => v.id === offer.vendorId);
  const bestOffer = session.currentBestOffer;
  const isCompetitorBest = Boolean(
    bestOffer &&
      bestOffer.vendorId !== offer.vendorId &&
      bestOffer.policyStatus === 'PASS'
  );
  const bestVendor = isCompetitorBest && bestOffer
    ? session.vendors.find((v) => v.id === bestOffer.vendorId)
    : null;

  const competitiveBenchmark = isCompetitorBest && bestOffer
    ? {
        vendorName: bestVendor?.name ?? 'Competing Approved Vendor',
        vendorSlug: bestVendor?.slug ?? null,
        vendorId: bestOffer.vendorId,
        unitPrice: bestOffer.unitPrice,
        deliveryDays: bestOffer.deliveryDays,
        warrantyMonths: bestOffer.warrantyMonths,
        advancePaymentPercent: bestOffer.advancePaymentPercent,
        policyStatus: bestOffer.policyStatus,
        isFromCompetitor: true,
        isBetterThanCurrent: bestOffer.unitPrice < offer.unitPrice,
        priceAdvantageInINR: Math.max(0, offer.unitPrice - bestOffer.unitPrice),
      }
    : null;

  const competitorOffersSummary = session.vendors
    .filter((v) => v.id !== offer.vendorId)
    .map((v) => {
      const vendorOffers = session.offers.filter((o) => o.vendorId === v.id);
      const latestOffer = vendorOffers[vendorOffers.length - 1];
      const bestCompliant =
        vendorOffers
          .filter((o) => o.policyStatus === 'PASS')
          .sort((a, b) => a.unitPrice - b.unitPrice)[0] ?? null;

      if (!latestOffer) return null;

      return {
        vendorName: v.name,
        latestUnitPrice: latestOffer.unitPrice,
        bestCompliantUnitPrice: bestCompliant?.unitPrice ?? null,
        warrantyMonths: latestOffer.warrantyMonths,
        deliveryDays: latestOffer.deliveryDays,
        advancePaymentPercent: latestOffer.advancePaymentPercent,
        hasCompliantOffer: Boolean(bestCompliant),
      };
    })
    .filter(Boolean);

  return JSON.stringify({
    request: session.originalRequest,
    currentVendor,
    currentOffer: offer,
    currentBestOffer: session.currentBestOffer,
    competitiveBenchmark,
    competitorOffersSummary,
    history: session.messages.slice(-12),
    evidence: session.retrievedEvidence.length
      ? session.retrievedEvidence
      : defaultEvidence,
  });
}

/**
 * Normalizes structured LLM output into a typed AgentAction.
 */
function normalizeAction(
  object: z.infer<typeof actionSchema>,
  offer: Offer
): AgentAction {
  if (object.type === 'ACCEPT') {
    return {
      type: 'ACCEPT',
      vendorId: object.vendorId ?? offer.vendorId,
      offerId: object.offerId ?? offer.id,
      rationale: object.rationale ?? 'Offer accepted after verification.',
    };
  }

  if (object.type === 'STOP') {
    return {
      type: 'STOP',
      reason: object.reason ?? object.rationale ?? 'Negotiation stopped by the negotiator.',
    };
  }

  if (object.type === 'ESCALATE') {
    return {
      type: 'ESCALATE',
      reason: object.reason ?? object.rationale ?? 'Human review requested.',
    };
  }

  return {
    type: 'SEND_COUNTER',
    vendorId: object.vendorId ?? offer.vendorId,
    message: object.message ?? 'Please provide your best compliant offer.',
    proposedTerms: object.proposedTerms ?? { unitPrice: offer.unitPrice },
    rationale:
      object.rationale ?? 'Counteroffer prepared within retrieved policy constraints.',
  };
}

/**
 * Primary LLM negotiator: proposes actions using Gemini with automatic OpenRouter fallback.
 */
export async function proposeAction(
  session: NegotiationSession,
  offer: Offer
): Promise<{
  action: AgentAction;
  runs: NegotiationSession['modelRuns'];
  fallbackUsed: boolean;
}> {
  if (!config.googleApiKey && !config.openRouterApiKey) {
    throw new ModelError('Negotiator model providers are not configured.');
  }

  const runs: NegotiationSession['modelRuns'] = [];
  const currentVendor = session.vendors.find((v) => v.id === offer.vendorId);
  const bestOffer = session.currentBestOffer;
  const hasCompetitorBenchmark = Boolean(
    bestOffer &&
      bestOffer.vendorId !== offer.vendorId &&
      bestOffer.policyStatus === 'PASS'
  );
  const bestVendor = hasCompetitorBenchmark && bestOffer
    ? session.vendors.find((v) => v.id === bestOffer.vendorId)
    : null;

  const competitorBenchmarkText =
    hasCompetitorBenchmark && bestOffer
      ? `Active Competitor Benchmark: ${bestVendor?.name ?? 'A competitor'} has already offered ₹${bestOffer.unitPrice.toLocaleString('en-IN')} with ${bestOffer.warrantyMonths}-month warranty and ${bestOffer.deliveryDays}-day delivery.`
      : 'Active Competitor Benchmark: No lower competitor offer secured yet.';

  const competitorLeverageInstruction =
    hasCompetitorBenchmark && bestOffer
      ? `When negotiating with ${currentVendor?.name ?? 'the current vendor'}, actively leverage the benchmark in your counteroffer message (e.g. "${bestVendor?.name ?? 'A competing vendor'} just offered ₹${bestOffer.unitPrice.toLocaleString('en-IN')} with ${bestOffer.warrantyMonths}-month warranty. Can you beat that with ₹...").`
      : `Challenge ${currentVendor?.name ?? 'the current vendor'} to provide their best pricing and terms meeting or beating the target price.`;

  const prompt = `You are the lead enterprise procurement negotiator conducting an active multi-vendor competitive auction.
Your goal is to secure the lowest compliant unit price and best commercial terms for the buyer.

TACTICAL COMPETITIVE AUCTION RULES:
1. Dynamic Competitor Leverage:
   - ${competitorBenchmarkText}
   - ${competitorLeverageInstruction}
   - Propose a unitPrice that matches or beats the current best offer (aiming towards the target price of ₹${session.targetUnitPrice ?? session.maximumUnitPrice}).
2. Compliance & Hard Limits:
   - Proposed unit price MUST NOT exceed max price cap ₹${session.maximumUnitPrice}.
   - Advance payment MUST NOT exceed ${session.maximumAdvancePaymentPercent}%.
   - Delivery MUST NOT exceed ${session.maximumDeliveryDays} days.
   - Warranty MUST be at least ${session.minimumWarrantyMonths} months.
3. Acceptance Strategy:
   - Propose ACCEPT only when the offer is fully compliant, hits target expectations, and beats or matches all competitor benchmarks.
   - Propose SEND_COUNTER with aggressive terms whenever further price improvement or compliance correction is achievable.

Return only a concise structured JSON object matching the action schema. Never authorize execution directly.
Context:
${buildPromptContext(session, offer)}`;

  // 1. Try Primary Google Gemini Provider (up to 2 attempts)
  if (config.googleApiKey) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const startTime = Date.now();
      try {
        const google = createGoogleGenerativeAI({ apiKey: config.googleApiKey });
        const result = await generateObject({
          model: google(config.primaryModel),
          schema: actionSchema,
          prompt,
          temperature: 0.2,
        });

        runs.push({
          model: config.primaryModel,
          role: 'NEGOTIATOR',
          durationMs: Date.now() - startTime,
          retryCount: attempt,
          fallback: false,
          success: true,
          usage: result.usage
            ? {
                inputTokens: result.usage.inputTokens,
                outputTokens: result.usage.outputTokens,
              }
            : undefined,
        });

        return {
          action: normalizeAction(result.object, offer),
          runs,
          fallbackUsed: false,
        };
      } catch (error) {
        runs.push({
          model: config.primaryModel,
          role: 'NEGOTIATOR',
          durationMs: Date.now() - startTime,
          retryCount: attempt,
          fallback: false,
          success: false,
        });

        if (attempt === 0) continue;
      }
    }
  }

  // 2. Fallback to OpenRouter Provider
  if (config.openRouterApiKey) {
    const startTime = Date.now();
    try {
      const openrouter = createOpenRouter({ apiKey: config.openRouterApiKey });
      const result = await generateObject({
        model: openrouter.chat(config.fallbackModel),
        schema: actionSchema,
        prompt: `${prompt}\nPrimary provider failed. Act as the fallback negotiator.`,
        temperature: 0.2,
      });

      runs.push({
        model: config.fallbackModel,
        role: 'FALLBACK',
        durationMs: Date.now() - startTime,
        retryCount: 0,
        fallback: true,
        success: true,
        usage: result.usage
          ? {
              inputTokens: result.usage.inputTokens,
              outputTokens: result.usage.outputTokens,
            }
          : undefined,
      });

      return {
        action: normalizeAction(result.object, offer),
        runs,
        fallbackUsed: true,
      };
    } catch {
      runs.push({
        model: config.fallbackModel,
        role: 'FALLBACK',
        durationMs: Date.now() - startTime,
        retryCount: 0,
        fallback: true,
        success: false,
      });
    }
  }

  throw new ModelError('Both primary negotiator and fallback model failed.');
}

/**
 * Independent LLM Critic: evaluates safety and compliance of proposed action before execution.
 */
export async function critique(
  session: NegotiationSession,
  offer: Offer,
  action: AgentAction
): Promise<{
  result: CriticResult;
  run: NegotiationSession['modelRuns'][number];
}> {
  if (!config.googleApiKey) {
    throw new CriticError('Critic provider is not configured.');
  }

  const prompt = `You are an independent procurement critic. Do not negotiate or rewrite the action. Decide whether it is safe to allow given the evidence. ${buildPromptContext(session, offer)} Proposed action: ${JSON.stringify(action)}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const startTime = Date.now();
    try {
      const google = createGoogleGenerativeAI({ apiKey: config.googleApiKey });
      const result = await generateObject({
        model: google(config.criticModel),
        schema: criticSchema,
        prompt,
        temperature: 0,
      });

      return {
        result: result.object,
        run: {
          model: config.criticModel,
          role: 'CRITIC',
          durationMs: Date.now() - startTime,
          retryCount: attempt,
          fallback: false,
          success: true,
          usage: result.usage
            ? {
                inputTokens: result.usage.inputTokens,
                outputTokens: result.usage.outputTokens,
              }
            : undefined,
        },
      };
    } catch {
      if (attempt === 1) {
        throw new CriticError('Independent critic failed after retry.');
      }
    }
  }

  throw new CriticError('Independent critic failed.');
}

// ---------------------------------------------------------------------------
// Deterministic Test Adapters (Used in automated test suites and offline QA)
// ---------------------------------------------------------------------------

function deterministicProposal(
  session: NegotiationSession,
  offer: Offer
): AgentAction {
  const vendor = session.vendors.find((item) => item.id === offer.vendorId);
  const vendorName = vendor?.name ?? 'Vendor';

  // Vendor A round 1 special case for test scenario
  if (vendor?.slug === 'vendor-a' && offer.roundNumber === 1) {
    return {
      type: 'ACCEPT',
      vendorId: offer.vendorId,
      offerId: offer.id,
      rationale:
        'Low headline price looks attractive; verify the full commercial terms before any mutation.',
    };
  }

  const isCompliant =
    offer.unitPrice <= session.maximumUnitPrice &&
    offer.deliveryDays <= session.maximumDeliveryDays &&
    offer.warrantyMonths >= session.minimumWarrantyMonths &&
    offer.advancePaymentPercent <= session.maximumAdvancePaymentPercent;

  const targetPrice = session.targetUnitPrice ?? session.maximumUnitPrice;
  const bestOffer = session.currentBestOffer;
  const isCompetitorBest = Boolean(
    bestOffer &&
      bestOffer.vendorId !== offer.vendorId &&
      bestOffer.policyStatus === 'PASS'
  );
  const competitorVendor = isCompetitorBest
    ? session.vendors.find((v) => v.id === bestOffer?.vendorId)
    : null;
  const competitorName = competitorVendor?.name ?? 'A competing vendor';
  const beatsOrMatchesCompetitor =
    !isCompetitorBest || !bestOffer || offer.unitPrice <= bestOffer.unitPrice;

  if (isCompliant && offer.unitPrice <= targetPrice && beatsOrMatchesCompetitor) {
    return {
      type: 'ACCEPT',
      vendorId: offer.vendorId,
      offerId: offer.id,
      rationale: `Offer meets every hard constraint at ₹${offer.unitPrice.toLocaleString('en-IN')} per unit and beats or matches competitor benchmarks.`,
    };
  }

  if (offer.roundNumber >= 3 && isCompliant && beatsOrMatchesCompetitor) {
    return {
      type: 'ACCEPT',
      vendorId: offer.vendorId,
      offerId: offer.id,
      rationale: `After ${offer.roundNumber} rounds, the offer is compliant at ₹${offer.unitPrice.toLocaleString('en-IN')} and competitive against market benchmarks.`,
    };
  }

  const baseTarget = session.targetUnitPrice ?? session.maximumUnitPrice;
  const priceReduction = Math.max(
    50,
    Math.round(session.maximumUnitPrice * (vendor?.slug === 'vendor-c' ? 0.04 : 0.05))
  );

  let nextPrice: number;
  if (isCompetitorBest && bestOffer && bestOffer.unitPrice < offer.unitPrice) {
    nextPrice = Math.max(
      baseTarget,
      Math.min(bestOffer.unitPrice - 500, offer.unitPrice - priceReduction)
    );
  } else {
    nextPrice = Math.max(
      baseTarget,
      Math.min(session.maximumUnitPrice, offer.unitPrice - priceReduction)
    );
  }

  const proposedTerms: ProposedTerms = {
    unitPrice: nextPrice,
    deliveryDays: Math.min(offer.deliveryDays, session.maximumDeliveryDays),
    warrantyMonths: Math.max(offer.warrantyMonths, session.minimumWarrantyMonths),
    advancePaymentPercent: session.maximumAdvancePaymentPercent,
    paymentTerms: `${session.maximumAdvancePaymentPercent}% advance, balance on delivery`,
  };

  let message: string;
  let rationale: string;

  if (isCompetitorBest && bestOffer && bestOffer.unitPrice < offer.unitPrice) {
    message = `${competitorName} just offered ₹${bestOffer.unitPrice.toLocaleString('en-IN')} with ${bestOffer.warrantyMonths}-month warranty and ${bestOffer.deliveryDays}-day delivery. Can you beat that? We can proceed at ₹${nextPrice.toLocaleString('en-IN')} per unit with ${proposedTerms.deliveryDays}-day delivery, ${proposedTerms.warrantyMonths}-month warranty, and ${proposedTerms.advancePaymentPercent}% advance payment.`;
    rationale = `Leveraging ${competitorName}'s ₹${bestOffer.unitPrice.toLocaleString('en-IN')} benchmark to drive competitive price concessions from ${vendorName}.`;
  } else {
    message = `We can proceed at ₹${nextPrice.toLocaleString('en-IN')} per unit with ${proposedTerms.deliveryDays}-day delivery, ${proposedTerms.warrantyMonths}-month warranty, and ${proposedTerms.advancePaymentPercent}% advance payment.`;
    rationale = vendor
      ? "Protect the hard constraints while preserving room for the vendor's next concession."
      : 'Counter within policy limits.';
  }

  return {
    type: 'SEND_COUNTER',
    vendorId: offer.vendorId,
    message,
    proposedTerms,
    rationale,
  };
}

function deterministicCritique(
  session: NegotiationSession,
  offer: Offer,
  action: AgentAction
): CriticResult {
  const terms = action.type === 'SEND_COUNTER' ? action.proposedTerms : offer;
  const violations: string[] = [];

  if (
    (terms.advancePaymentPercent ?? offer.advancePaymentPercent) >
    session.maximumAdvancePaymentPercent
  ) {
    violations.push(
      `Advance payment exceeds ${session.maximumAdvancePaymentPercent}%.`
    );
  }

  if ((terms.unitPrice ?? offer.unitPrice) > session.maximumUnitPrice) {
    violations.push(
      `Unit price exceeds ₹${session.maximumUnitPrice.toLocaleString('en-IN')}.`
    );
  }

  if ((terms.deliveryDays ?? offer.deliveryDays) > session.maximumDeliveryDays) {
    violations.push(`Delivery exceeds ${session.maximumDeliveryDays} days.`);
  }

  if (
    (terms.warrantyMonths ?? offer.warrantyMonths) < session.minimumWarrantyMonths
  ) {
    violations.push(
      `Warranty is below ${session.minimumWarrantyMonths} months.`
    );
  }

  const evaluatedPrice =
    action.type === 'SEND_COUNTER' ? terms.unitPrice : offer.unitPrice;
  const targetCap = session.targetUnitPrice ?? session.maximumUnitPrice;
  const hasPriceWarning = !violations.length && evaluatedPrice > targetCap;

  const vendorName =
    session.vendors.find((item) => item.id === offer.vendorId)?.name ?? offer.vendorId;

  return {
    decision: violations.length ? 'BLOCK' : hasPriceWarning ? 'WARN' : 'PASS',
    confidence: violations.length ? 0.97 : 0.94,
    policyViolations: violations,
    concerns: hasPriceWarning
      ? ['Offer is above target price but within hard cap.']
      : [],
    evidence: [
      `Request cap: ₹${session.maximumUnitPrice.toLocaleString('en-IN')}`,
      `Advance limit: ${session.maximumAdvancePaymentPercent}%`,
      `Vendor: ${vendorName}`,
    ],
    requiresHumanReview: false,
  };
}

export function createDeterministicModelAdapters(): ModelAdapters {
  return {
    executionMode: 'test-adapter',
    negotiator: {
      proposeAction: async (session, offer) => ({
        action: deterministicProposal(session, offer),
        runs: [
          {
            model: 'deterministic-test-adapter',
            role: 'NEGOTIATOR',
            durationMs: 1,
            retryCount: 0,
            fallback: false,
            success: true,
          },
        ],
        fallbackUsed: false,
      }),
    },
    critic: {
      critique: async (session, offer, action) => ({
        result: deterministicCritique(session, offer, action),
        run: {
          model: 'deterministic-test-adapter',
          role: 'CRITIC',
          durationMs: 1,
          retryCount: 0,
          fallback: false,
          success: true,
        },
      }),
    },
  };
}
