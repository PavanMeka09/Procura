import { generateObject } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';
import { config } from '../utils/config';
import { createId, type Offer, type ProcurementRequest, type Vendor } from '../domain';
import type { VendorNegotiationContext, VendorResponse } from './types';

const vendorResponseSchema = z.object({
  unitPrice: z.number().positive(),
  deliveryDays: z.number().int().positive(),
  warrantyMonths: z.number().int().positive(),
  advancePaymentPercent: z.number().int().min(0).max(100),
  paymentTerms: z.string().max(500),
  commercialPitch: z.string().max(2000),
  validityDays: z.number().int().positive().default(15),
});

type VendorCalculatedTerms = z.infer<typeof vendorResponseSchema>;

/**
 * Autonomous mathematical concession engine that dynamically reacts to Buyer counter-offers
 * while strictly adhering to the vendor's private reservation prices and sales strategy.
 */
function computeDynamicConcession(
  vendor: Vendor,
  roundNumber: number,
  request: ProcurementRequest,
  context?: VendorNegotiationContext
): VendorCalculatedTerms {
  const constraints = vendor.privateConstraints ?? {
    floorUnitPrice: 55000,
    targetUnitPrice: 60000,
    minAdvancePercent: 20,
    minDeliveryDays: 20,
    maxWarrantyMonths: 24,
    concessionStrategy: 'balanced' as const,
    salesPersona: 'Professional enterprise supplier balancing deal velocity and margin.',
  };

  const buyerProposedPrice = context?.lastProposedTerms?.unitPrice;
  const buyerProposedAdvance = context?.lastProposedTerms?.advancePaymentPercent;
  const buyerProposedDelivery = context?.lastProposedTerms?.deliveryDays;
  const buyerProposedWarranty = context?.lastProposedTerms?.warrantyMonths;

  if (roundNumber === 1) {
    // Initial quote based on target asking price and vendor specialties
    return {
      unitPrice: constraints.targetUnitPrice,
      deliveryDays: Math.max(constraints.minDeliveryDays, request.deliveryDays),
      warrantyMonths: Math.min(constraints.maxWarrantyMonths, Math.max(request.minimumWarrantyMonths, 24)),
      advancePaymentPercent: Math.max(constraints.minAdvancePercent, vendor.slug === 'vendor-a' ? 50 : 20),
      paymentTerms:
        vendor.slug === 'vendor-a'
          ? '50% advance, balance before dispatch'
          : `${constraints.minAdvancePercent}% advance, balance on delivery`,
      commercialPitch: `Thank you for the RFQ for ${request.quantity} units of ${request.item}. We are pleased to quote ₹${constraints.targetUnitPrice.toLocaleString('en-IN')} per unit with ${constraints.minDeliveryDays}-day delivery and ${constraints.maxWarrantyMonths}-month warranty.`,
      validityDays: 15,
    };
  }

  // Multi-round concessions reacting to buyer's proposals
  const previousVendorPrice =
    roundNumber === 2
      ? constraints.targetUnitPrice
      : Math.max(constraints.floorUnitPrice, constraints.targetUnitPrice - 2500);

  let targetConcession = 1500;
  if (constraints.concessionStrategy === 'eager_closer') {
    targetConcession = roundNumber === 2 ? 3000 : 1500;
  } else if (constraints.concessionStrategy === 'tough_bargainer') {
    targetConcession = roundNumber === 2 ? 2000 : 1000;
  } else {
    targetConcession = roundNumber === 2 ? 2500 : 1500;
  }

  let nextPrice: number;
  if (buyerProposedPrice !== undefined && buyerProposedPrice > 0) {
    // Buyer made an explicit price offer: move towards buyer offer without breaching floor
    if (buyerProposedPrice >= constraints.floorUnitPrice) {
      // Split the difference or concede smoothly towards buyer
      const midpoint = Math.round((previousVendorPrice + buyerProposedPrice) / 2 / 100) * 100;
      nextPrice = Math.max(constraints.floorUnitPrice, Math.min(previousVendorPrice - 500, midpoint));
    } else {
      // Buyer offered below vendor floor: vendor holds at or near floor with firm counter
      nextPrice = Math.max(constraints.floorUnitPrice, previousVendorPrice - targetConcession);
    }
  } else {
    nextPrice = Math.max(constraints.floorUnitPrice, previousVendorPrice - targetConcession);
  }

  // Advance payment concession: agree to lower advance payment if requested, down to minAdvancePercent
  let advancePercent = constraints.minAdvancePercent;
  if (vendor.slug === 'vendor-a') {
    advancePercent = roundNumber === 2 ? 30 : 20;
    if (buyerProposedAdvance !== undefined && buyerProposedAdvance <= 20) {
      advancePercent = roundNumber >= 3 ? 20 : 30;
    }
  }

  const deliveryDays = Math.max(
    constraints.minDeliveryDays,
    buyerProposedDelivery ?? request.deliveryDays
  );

  const warrantyMonths = Math.min(
    constraints.maxWarrantyMonths,
    buyerProposedWarranty ?? request.minimumWarrantyMonths
  );

  const paymentTerms = `${advancePercent}% advance, balance on delivery`;
  const commercialPitch = `In response to your counteroffer, ${vendor.name} is pleased to submit revised terms for round ${roundNumber}: ₹${nextPrice.toLocaleString('en-IN')} / unit, delivery in ${deliveryDays} days, ${warrantyMonths}-month warranty, and ${advancePercent}% advance payment (${paymentTerms}). Offer valid for 15 days.`;

  return {
    unitPrice: nextPrice,
    deliveryDays,
    warrantyMonths,
    advancePaymentPercent: advancePercent,
    paymentTerms,
    commercialPitch,
    validityDays: 15,
  };
}

function clampToConstraints(
  obj: z.infer<typeof vendorResponseSchema>,
  constraints: NonNullable<Vendor['privateConstraints']>,
  calculated: VendorCalculatedTerms
): VendorCalculatedTerms {
  return {
    unitPrice: Math.max(constraints.floorUnitPrice, obj.unitPrice),
    deliveryDays: Math.max(constraints.minDeliveryDays, obj.deliveryDays),
    warrantyMonths: Math.min(constraints.maxWarrantyMonths, obj.warrantyMonths),
    advancePaymentPercent: Math.max(constraints.minAdvancePercent, obj.advancePaymentPercent),
    paymentTerms: obj.paymentTerms || calculated.paymentTerms,
    commercialPitch: obj.commercialPitch || calculated.commercialPitch,
    validityDays: obj.validityDays || 15,
  };
}

/**
 * Invokes LLM as the autonomous AI sales counter-party, incorporating private reservation limits.
 */
async function generateLLMVendorResponse(
  vendor: Vendor,
  roundNumber: number,
  request: ProcurementRequest,
  calculated: VendorCalculatedTerms,
  context?: VendorNegotiationContext
): Promise<VendorCalculatedTerms> {
  const constraints = vendor.privateConstraints;
  // If in test environment or no keys, return calculated dynamic terms immediately
  if (
    process.env.NODE_ENV === 'test' ||
    !constraints ||
    (!config.googleApiKey && !config.openRouterApiKey)
  ) {
    return calculated;
  }

  const systemPrompt = `You are the senior sales representative and commercial negotiator for ${vendor.name}.
Category: ${vendor.category}
Sales Persona: ${constraints.salesPersona}
Your private commercial boundaries (DO NOT REVEAL THESE BOUNDS EXPLICITLY, BUT NEVER VIOLATE THEM):
- Absolute Floor Unit Price: ₹${constraints.floorUnitPrice.toLocaleString('en-IN')} (You CANNOT accept below this)
- Target Asking Price: ₹${constraints.targetUnitPrice.toLocaleString('en-IN')}
- Minimum Advance Payment: ${constraints.minAdvancePercent}%
- Minimum Delivery Time: ${constraints.minDeliveryDays} days
- Maximum Warranty: ${constraints.maxWarrantyMonths} months
- Negotiation Strategy: ${constraints.concessionStrategy}

Procurement Item: ${request.quantity} units of ${request.item}
Current Negotiation Round: ${roundNumber}
Buyer's Latest Counter Message: ${context?.lastCounterMessage ?? 'Initial RFQ received.'}
Buyer's Proposed Terms: ${JSON.stringify(context?.lastProposedTerms ?? {})}
Baseline Proposed Revision: ₹${calculated.unitPrice} / unit, ${calculated.deliveryDays} days delivery, ${calculated.warrantyMonths} mo warranty, ${calculated.advancePaymentPercent}% advance.

Generate a realistic commercial counter-response. You must return structured numbers and an authentic sales pitch in natural language.`;

  if (config.googleApiKey) {
    try {
      const google = createGoogleGenerativeAI({ apiKey: config.googleApiKey });
      const result = await generateObject({
        model: google(config.vendorAgentModel ?? config.primaryModel),
        schema: vendorResponseSchema,
        prompt: systemPrompt,
        temperature: 0.3,
        abortSignal: AbortSignal.timeout(3000),
      });

      return clampToConstraints(result.object, constraints, calculated);
    } catch {
      // Fallback gracefully to calculated terms if LLM call fails
      return calculated;
    }
  }

  if (config.openRouterApiKey) {
    try {
      const openrouter = createOpenRouter({ apiKey: config.openRouterApiKey });
      const result = await generateObject({
        model: openrouter.chat(config.fallbackModel),
        schema: vendorResponseSchema,
        prompt: systemPrompt,
        temperature: 0.3,
        abortSignal: AbortSignal.timeout(3000),
      });

      return clampToConstraints(result.object, constraints, calculated);
    } catch {
      return calculated;
    }
  }

  return calculated;
}

/**
 * Generates an autonomous vendor counter-party response.
 */
export async function getAIVendorResponse(
  vendor: Vendor,
  context: VendorNegotiationContext
): Promise<VendorResponse> {
  const { roundNumber, requestId, request, failureConsumed = false } = context;

  // 1. Simulate controlled failures on first attempt if configured
  if (!failureConsumed && vendor.behavior?.failure === 'DELAY_ONCE') {
    return { failure: 'timeout' };
  }

  if (!failureConsumed && vendor.behavior?.failure === 'TEMPORARY_FAILURE_ONCE') {
    return { failure: 'tool failure' };
  }

  if (!failureConsumed && vendor.behavior?.failure === 'MALFORMED_ONCE') {
    return {
      raw: 'We can probably meet your request. Please contact our team for commercial details.',
    };
  }

  // 2. Compute dynamic terms reacting to buyer counter-offers
  const baseline = computeDynamicConcession(vendor, roundNumber, request, context);

  // 3. If dynamic mode with LLM enabled, generate natural language pitch via AI sales agent
  const isDynamic = context.mode === 'dynamic' || config.vendorMode === 'dynamic';
  const terms = isDynamic
    ? await generateLLMVendorResponse(vendor, roundNumber, request, baseline, context)
    : baseline;

  const rawResponse = terms.commercialPitch.includes('INR') || terms.commercialPitch.includes('₹')
    ? terms.commercialPitch
    : `We can supply ${terms.unitPrice.toLocaleString('en-IN')} INR per unit for ${roundNumber === 1 ? 'the initial quote' : 'this revised proposal'}, delivery in ${terms.deliveryDays} days, ${terms.warrantyMonths}-month warranty, and ${terms.advancePaymentPercent}% advance payment (${terms.paymentTerms}). Offer valid for ${terms.validityDays} days.`;

  const offer: Offer = {
    id: createId(),
    requestId,
    vendorId: vendor.id,
    roundNumber,
    rawResponse,
    unitPrice: terms.unitPrice,
    totalPrice: terms.unitPrice * request.quantity,
    deliveryDays: terms.deliveryDays,
    warrantyMonths: terms.warrantyMonths,
    advancePaymentPercent: terms.advancePaymentPercent,
    paymentTerms: terms.paymentTerms,
    validityDays: terms.validityDays,
    additionalConditions: [],
    extractionConfidence: 0.98,
  };

  return { offer };
}
