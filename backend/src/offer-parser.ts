import { generateObject } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';
import { createId } from './domain';
import type { Offer, ProcurementRequest, Vendor } from './domain';
import { config } from './utils/config';

export class ParsingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParsingError';
  }
}

export interface OfferParsingContext {
  rawResponse: string;
  requestId: string;
  vendor: Vendor;
  roundNumber: number;
  quantity: number;
}

const parsedOfferSchema = z.object({
  unitPrice: z.number().positive(),
  deliveryDays: z.number().int().positive(),
  warrantyMonths: z.number().int().positive(),
  advancePaymentPercent: z.number().min(0).max(100),
});

/**
 * Zod schema for LLM structured vendor offer extraction.
 */
const vendorOfferExtractionSchema = z.object({
  isCompleteOffer: z
    .boolean()
    .describe(
      'Set to true ONLY if the response contains explicit commercial terms including unit price, delivery timeline, warranty, and advance payment percentage. Set to false if any of these are missing, incomplete, or if it is just a vague message.'
    ),
  unitPrice: z
    .number()
    .positive()
    .nullable()
    .optional()
    .describe(
      'Extracted unit price in INR (e.g. 55000, 1.85L -> 185000, 2 lakhs -> 200000)'
    ),
  deliveryDays: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe('Delivery timeline in days (e.g. 21, "3 weeks" -> 21)'),
  warrantyMonths: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe('Warranty duration in months (e.g. 24, "3 years" -> 36)'),
  advancePaymentPercent: z
    .number()
    .min(0)
    .max(100)
    .nullable()
    .optional()
    .describe('Advance/upfront payment percentage (0-100)'),
  paymentTerms: z
    .string()
    .nullable()
    .optional()
    .describe('Explanation of payment terms, e.g. "20% advance, balance on delivery"'),
  validityDays: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe('Validity period in days if stated'),
  additionalConditions: z
    .array(z.string())
    .optional()
    .describe('Any additional terms or conditions mentioned by the vendor'),
});

/**
 * Fallback regex pattern matching for offline/test environments or LLM failures.
 */
export function parseOfferRegexFallback(
  rawResponse: string,
  requestId: string,
  vendor: Vendor,
  roundNumber: number,
  quantity: number
): Offer {
  const raw = rawResponse.trim();
  if (raw.length < 5) {
    throw new ParsingError('Commercial response is incomplete or malformed.');
  }

  // Regex pattern extractions
  const lakhMatch = raw.match(
    /(?:(?:at|for|supply|quote)\s*)?(?:₹\s*)?(\d+(?:\.\d+)?)\s*(?:lakhs?|lacs?|l\b)/i
  );
  let parsedUnitPrice: number | null = null;
  if (lakhMatch?.[1]) {
    parsedUnitPrice = Math.round(Number(lakhMatch[1]) * 100000);
  } else {
    const unitPriceMatch = raw
      .match(/(?:₹\s*([\d,]+)|([\d,]+)\s*(?:INR|rupees))/i)
      ?.slice(1)
      .find(Boolean);
    if (unitPriceMatch) {
      parsedUnitPrice = Number(unitPriceMatch.replace(/,/g, ''));
    }
  }

  let parsedDelivery: number | null = null;
  const weeksMatch = raw.match(
    /(?:delivery|deliver(?:y)?\s*(?:in|within|of)?)\s*(\d+)\s*weeks?/i
  );
  if (weeksMatch?.[1]) {
    parsedDelivery = Number(weeksMatch[1]) * 7;
  } else {
    const deliveryMatch = raw.match(
      /(?:delivery|deliver(?:y)?\s*(?:in|within|of)?)\s*(\d+)\s*days?/i
    )?.[1];
    if (deliveryMatch) parsedDelivery = Number(deliveryMatch);
  }

  let parsedWarranty: number | null = null;
  const yearsMatch = raw.match(
    /(\d+)\s*[- ]?(?:year|yr)s?\s*(?:warranty|coverage|guarantee)/i
  )?.[1];
  if (yearsMatch) {
    parsedWarranty = Number(yearsMatch) * 12;
  } else {
    const warrantyMatch = raw.match(
      /(\d+)\s*[- ]?month(?:s)?\s*(?:warranty|coverage|guarantee)/i
    )?.[1];
    if (warrantyMatch) parsedWarranty = Number(warrantyMatch);
  }

  const advanceMatch = raw.match(
    /(\d+)%\s*(?:advance|upfront|down payment)/i
  )?.[1];
  const parsedAdvance = advanceMatch ? Number(advanceMatch) : null;

  // Fail-closed validation if essential commercial parameters are missing
  if (
    parsedUnitPrice === null ||
    parsedDelivery === null ||
    parsedWarranty === null ||
    parsedAdvance === null
  ) {
    throw new ParsingError('Commercial response is incomplete or malformed.');
  }

  // Validate parsed numeric values through Zod schema
  const validation = parsedOfferSchema.safeParse({
    unitPrice: parsedUnitPrice,
    deliveryDays: parsedDelivery,
    warrantyMonths: parsedWarranty,
    advancePaymentPercent: parsedAdvance,
  });

  if (!validation.success) {
    throw new ParsingError('Commercial response contains invalid commercial fields.');
  }

  const paymentTerms =
    raw.match(/\(([^)]+)\)/)?.[1] ?? 'Commercial terms supplied by vendor';

  const validityDays =
    Number(raw.match(/valid for\s+(\d+)\s*days?/i)?.[1] ?? 0) || null;

  return {
    id: createId(),
    requestId,
    vendorId: vendor.id,
    roundNumber,
    rawResponse,
    unitPrice: parsedUnitPrice,
    totalPrice: parsedUnitPrice * quantity,
    deliveryDays: parsedDelivery,
    warrantyMonths: parsedWarranty,
    advancePaymentPercent: parsedAdvance,
    paymentTerms,
    validityDays,
    additionalConditions: [],
    extractionConfidence: 0.96,
  };
}

function buildOfferFromExtracted(
  extracted: z.infer<typeof vendorOfferExtractionSchema>,
  raw: string,
  requestId: string,
  vendor: Vendor,
  roundNumber: number,
  quantity: number
): Offer {
  if (
    !extracted.isCompleteOffer ||
    extracted.unitPrice == null ||
    extracted.deliveryDays == null ||
    extracted.warrantyMonths == null ||
    extracted.advancePaymentPercent == null
  ) {
    throw new ParsingError('Commercial response is incomplete or malformed.');
  }

  return {
    id: createId(),
    requestId,
    vendorId: vendor.id,
    roundNumber,
    rawResponse: raw,
    unitPrice: extracted.unitPrice,
    totalPrice: extracted.unitPrice * quantity,
    deliveryDays: extracted.deliveryDays,
    warrantyMonths: extracted.warrantyMonths,
    advancePaymentPercent: extracted.advancePaymentPercent,
    paymentTerms: extracted.paymentTerms || 'Commercial terms supplied by vendor',
    validityDays: extracted.validityDays ?? null,
    additionalConditions: extracted.additionalConditions || [],
    extractionConfidence: 0.99,
  };
}

/**
 * Extracts commercial negotiation terms (unit price, delivery schedule, warranty, advance payment)
 * from unstructured vendor responses using Gemini generateObject with strict Zod schema,
 * with deterministic regex fallback.
 */
export async function parseOffer(
  rawResponse: string,
  requestId: string,
  vendor: Vendor,
  roundNumber: number,
  quantity: number
): Promise<Offer> {
  const raw = rawResponse.trim();
  if (raw.length < 5) {
    throw new ParsingError('Commercial response is incomplete or malformed.');
  }

  const prompt = `You are a strict commercial procurement offer parser.
Extract structured commercial terms from the following raw vendor response.
Vendor Name: ${vendor.name}
Round Number: ${roundNumber}

Required commercial fields to extract:
1. unitPrice: Unit price in INR (convert words/lakhs to numeric INR, e.g. "1.85L" or "1.85 lakhs" -> 185000, "55,500 INR" -> 55500)
2. deliveryDays: Delivery timeline in days (e.g. "21 days" -> 21, "3 weeks" -> 21)
3. warrantyMonths: Warranty in months (e.g. "24-month warranty" -> 24, "3 years" -> 36)
4. advancePaymentPercent: Upfront/advance payment percent (0-100, e.g. "20% advance" -> 20)
5. paymentTerms: Summary of payment structure (e.g. "20% advance, balance on delivery")
6. validityDays: Validity in days if stated

CRITICAL:
- If the vendor response is malformed, generic, conversational without commercial terms (e.g. "We can probably meet your request. Please contact our team for commercial details."), or missing ANY of the 4 essential parameters (unit price, delivery days, warranty months, advance payment), set "isCompleteOffer": false.
- Do NOT hallucinate or assume numbers that are not in the raw text.

Raw vendor response:
"""
${raw}
"""`;

  // 1. Try Primary Google Gemini Provider
  if (config.googleApiKey) {
    try {
      const google = createGoogleGenerativeAI({ apiKey: config.googleApiKey });
      const result = await generateObject({
        model: google(config.primaryModel),
        schema: vendorOfferExtractionSchema,
        prompt,
        temperature: 0.1,
        abortSignal: AbortSignal.timeout(5000),
      });

      return buildOfferFromExtracted(
        result.object,
        raw,
        requestId,
        vendor,
        roundNumber,
        quantity
      );
    } catch (error) {
      if (error instanceof ParsingError) {
        throw error;
      }
      // If network/provider error, fall through to fallback
    }
  }

  // 2. Try OpenRouter Fallback Provider
  if (config.openRouterApiKey) {
    try {
      const openrouter = createOpenRouter({ apiKey: config.openRouterApiKey });
      const result = await generateObject({
        model: openrouter.chat(config.fallbackModel),
        schema: vendorOfferExtractionSchema,
        prompt,
        temperature: 0.1,
        abortSignal: AbortSignal.timeout(5000),
      });

      return buildOfferFromExtracted(
        result.object,
        raw,
        requestId,
        vendor,
        roundNumber,
        quantity
      );
    } catch (error) {
      if (error instanceof ParsingError) {
        throw error;
      }
      // Fall through to regex fallback
    }
  }

  // 3. Resilient Secondary Fallback: Regex-based extraction
  return parseOfferRegexFallback(raw, requestId, vendor, roundNumber, quantity);
}

/**
 * Recalculates total contract price based on quantity.
 */
export function normalizeOffer(offer: Offer, request: ProcurementRequest): Offer {
  return {
    ...offer,
    totalPrice: offer.unitPrice * request.quantity,
  };
}

