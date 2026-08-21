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
 * Builds standard serialized context for LLM prompts.
 */
function buildPromptContext(session: NegotiationSession, offer: Offer): string {
  const defaultEvidence = [
    'Maximum advance payment is 20%',
    'Minimum warranty is 24 months',
    'Maximum delivery is 21 days',
  ];

  return JSON.stringify({
    request: session.originalRequest,
    vendor: session.vendors.find((v) => v.id === offer.vendorId),
    currentOffer: offer,
    currentBestOffer: session.currentBestOffer,
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
  const prompt = `You are the primary procurement negotiator. Return only a concise structured action. Never authorize execution; the critic and deterministic policy gate do that. ${buildPromptContext(session, offer)}`;

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

  if (
    isCompliant &&
    offer.unitPrice <= (session.targetUnitPrice ?? session.maximumUnitPrice)
  ) {
    return {
      type: 'ACCEPT',
      vendorId: offer.vendorId,
      offerId: offer.id,
      rationale: `Offer meets every hard constraint at ₹${offer.unitPrice.toLocaleString('en-IN')} per unit.`,
    };
  }

  if (offer.roundNumber >= 3 && isCompliant) {
    return {
      type: 'ACCEPT',
      vendorId: offer.vendorId,
      offerId: offer.id,
      rationale: `After ${offer.roundNumber} rounds, the offer is compliant and further improvement is uncertain.`,
    };
  }

  const baseTarget = session.targetUnitPrice ?? 55000;
  const priceReduction = vendor?.slug === 'vendor-c' ? 2500 : 3000;
  const nextPrice = Math.max(
    baseTarget,
    Math.min(session.maximumUnitPrice, offer.unitPrice - priceReduction)
  );

  const proposedTerms: ProposedTerms = {
    unitPrice: nextPrice,
    deliveryDays: Math.min(offer.deliveryDays, session.maximumDeliveryDays),
    warrantyMonths: Math.max(offer.warrantyMonths, session.minimumWarrantyMonths),
    advancePaymentPercent: session.maximumAdvancePaymentPercent,
    paymentTerms: '20% advance, balance on delivery',
  };

  return {
    type: 'SEND_COUNTER',
    vendorId: offer.vendorId,
    message: `We can proceed at ₹${nextPrice.toLocaleString('en-IN')} per unit with ${proposedTerms.deliveryDays}-day delivery, ${proposedTerms.warrantyMonths}-month warranty, and ${proposedTerms.advancePaymentPercent}% advance payment.`,
    proposedTerms,
    rationale: vendor
      ? "Protect the hard constraints while preserving room for the vendor's next concession."
      : 'Counter within policy limits.',
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
