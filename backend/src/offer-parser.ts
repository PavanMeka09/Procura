import { createId } from './domain';
import type { Offer, ProcurementRequest, Vendor } from './domain';
import { z } from 'zod';

export class ParsingError extends Error {}
const parsedOfferSchema = z.object({ unitPrice: z.number().finite().positive(), deliveryDays: z.number().int().positive(), warrantyMonths: z.number().int().positive(), advancePaymentPercent: z.number().int().min(0).max(100) });

export function parseOffer(rawResponse: string, requestId: string, vendor: Vendor, roundNumber: number, quantity: number): Offer {
  const unitPrice = rawResponse.match(/(?:₹\s*([\d,]+)|([\d,]+)\s*INR)/i)?.slice(1).find(Boolean);
  const delivery = rawResponse.match(/(?:delivery|deliver(?:y)?\s+in)\s*(?:of\s*)?(\d+)\s*days?/i)?.[1];
  const warranty = rawResponse.match(/(\d+)\s*[- ]?month(?:s)?\s*warranty/i)?.[1];
  const advance = rawResponse.match(/(\d+)%\s*advance/i)?.[1];
  if (!unitPrice || !delivery || !warranty || !advance) throw new ParsingError('Commercial response is incomplete or malformed.');
  const parsedUnitPrice = Number(unitPrice.replace(/,/g, ''));
  const parsedDelivery = Number(delivery);
  const parsedWarranty = Number(warranty);
  const parsedAdvance = Number(advance);
  const parsed = parsedOfferSchema.safeParse({ unitPrice: parsedUnitPrice, deliveryDays: parsedDelivery, warrantyMonths: parsedWarranty, advancePaymentPercent: parsedAdvance });
  if (!parsed.success) throw new ParsingError('Commercial response contains invalid commercial fields.');
  return { id: createId(), requestId, vendorId: vendor.id, roundNumber, rawResponse, unitPrice: parsedUnitPrice, totalPrice: parsedUnitPrice * quantity, deliveryDays: parsedDelivery, warrantyMonths: parsedWarranty, advancePaymentPercent: parsedAdvance, paymentTerms: rawResponse.match(/\(([^)]+)\)/)?.[1] ?? 'Commercial terms supplied by vendor', validityDays: Number(rawResponse.match(/valid for\s+(\d+)\s*days?/i)?.[1] ?? 0) || null, additionalConditions: [], extractionConfidence: 0.96 };
}

export const normalizeOffer = (offer: Offer, request: ProcurementRequest) => ({ ...offer, totalPrice: offer.unitPrice * request.quantity });
