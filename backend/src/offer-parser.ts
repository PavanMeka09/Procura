import { z } from 'zod';
import { createId } from './domain';
import type { Offer, ProcurementRequest, Vendor } from './domain';

export class ParsingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParsingError';
  }
}

const parsedOfferSchema = z.object({
  unitPrice: z.number().finite().positive(),
  deliveryDays: z.number().int().positive(),
  warrantyMonths: z.number().int().positive(),
  advancePaymentPercent: z.number().int().min(0).max(100),
});

/**
 * Extracts commercial negotiation terms (unit price, delivery schedule, warranty, advance payment)
 * from unstructured vendor responses using regex pattern matching.
 */
export function parseOffer(
  rawResponse: string,
  requestId: string,
  vendor: Vendor,
  roundNumber: number,
  quantity: number
): Offer {
  // Regex pattern extractions
  const unitPriceMatch = rawResponse
    .match(/(?:₹\s*([\d,]+)|([\d,]+)\s*(?:INR|rupees))/i)
    ?.slice(1)
    .find(Boolean);

  const deliveryMatch = rawResponse.match(
    /(?:delivery|deliver(?:y)?\s*(?:in|within|of)?)\s*(\d+)\s*days?/i
  )?.[1];

  const warrantyMatch = rawResponse.match(
    /(\d+)\s*[- ]?month(?:s)?\s*(?:warranty|coverage|guarantee)/i
  )?.[1];

  const advanceMatch = rawResponse.match(/(\d+)%\s*(?:advance|upfront|down payment)/i)?.[1];

  // Fail-closed validation if essential commercial parameters are missing
  if (!unitPriceMatch || !deliveryMatch || !warrantyMatch || !advanceMatch) {
    throw new ParsingError('Commercial response is incomplete or malformed.');
  }

  const parsedUnitPrice = Number(unitPriceMatch.replace(/,/g, ''));
  const parsedDelivery = Number(deliveryMatch);
  const parsedWarranty = Number(warrantyMatch);
  const parsedAdvance = Number(advanceMatch);

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
    rawResponse.match(/\(([^)]+)\)/)?.[1] ?? 'Commercial terms supplied by vendor';

  const validityDays =
    Number(rawResponse.match(/valid for\s+(\d+)\s*days?/i)?.[1] ?? 0) || null;

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

/**
 * Recalculates total contract price based on quantity.
 */
export function normalizeOffer(offer: Offer, request: ProcurementRequest): Offer {
  return {
    ...offer,
    totalPrice: offer.unitPrice * request.quantity,
  };
}
