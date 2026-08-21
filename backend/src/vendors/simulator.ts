import { VendorError } from '../errors';
import { createId } from '../domain';
import type { Offer, ProcurementRequest, Vendor } from '../domain';

const offer = (requestId: string, vendorId: string, roundNumber: number, unitPrice: number, deliveryDays: number, warrantyMonths: number, advancePaymentPercent: number, paymentTerms: string): Offer => ({ id: createId(), requestId, vendorId, roundNumber, rawResponse: `We can supply ${unitPrice.toLocaleString('en-IN')} INR per unit for ${roundNumber === 1 ? 'the initial quote' : 'this revised proposal'}, delivery in ${deliveryDays} days, ${warrantyMonths}-month warranty, and ${advancePaymentPercent}% advance payment (${paymentTerms}). Offer valid for 15 days.`, unitPrice, totalPrice: unitPrice, deliveryDays, warrantyMonths, advancePaymentPercent, paymentTerms, validityDays: 15, additionalConditions: [], extractionConfidence: 0.98 });

export const seededVendors = (requestId: string): Vendor[] => [
  { id: 'vendor-a', name: 'Apex Devices', category: 'Business hardware', approved: true, reliabilityScore: 0.84, contact: 'sales@apex.example', behavior: { initial: offer(requestId, 'vendor-a', 1, 60000, 20, 24, 50, '50% advance, balance before dispatch'), rounds: [offer(requestId, 'vendor-a', 2, 57000, 20, 24, 30, '30% advance, balance on dispatch'), offer(requestId, 'vendor-a', 3, 56500, 20, 24, 20, '20% advance, balance on delivery')], failure: 'DELAY_ONCE' } },
  { id: 'vendor-b', name: 'Northstar IT', category: 'Business hardware', approved: true, reliabilityScore: 0.91, contact: 'rfq@northstar.example', behavior: { initial: offer(requestId, 'vendor-b', 1, 62000, 14, 36, 20, '20% advance, balance on delivery'), rounds: [offer(requestId, 'vendor-b', 2, 57500, 14, 36, 20, '20% advance, balance on delivery'), offer(requestId, 'vendor-b', 3, 56000, 14, 36, 20, '20% advance, balance on delivery')], failure: 'MALFORMED_ONCE' } },
  { id: 'vendor-c', name: 'Vertex Systems', category: 'Business hardware', approved: true, reliabilityScore: 0.96, contact: 'commercial@vertex.example', behavior: { initial: offer(requestId, 'vendor-c', 1, 58000, 21, 24, 20, '20% advance, balance on delivery'), rounds: [offer(requestId, 'vendor-c', 2, 56000, 21, 24, 20, '20% advance, balance on delivery'), offer(requestId, 'vendor-c', 3, 55500, 21, 24, 20, '20% advance, balance on delivery')], failure: 'TEMPORARY_FAILURE_ONCE' } },
];

export const searchVendors = (request: ProcurementRequest, requestId: string) => seededVendors(requestId).filter((vendor) => vendor.category.toLowerCase().includes('hardware') && vendor.approved);
export const getVendorProfile = (vendorId: string, requestId: string) => seededVendors(requestId).find((vendor) => vendor.id === vendorId) ?? null;
export const sendRFQ = (vendor: Vendor, request: ProcurementRequest) => `RFQ: ${request.quantity} ${request.item}; target ₹${request.targetUnitPrice?.toLocaleString('en-IN') ?? 'not specified'} / unit; hard cap ₹${request.maximumUnitPrice.toLocaleString('en-IN')}; delivery ≤ ${request.deliveryDays} days; warranty ≥ ${request.minimumWarrantyMonths} months; advance ≤ ${request.maximumAdvancePaymentPercent}%.`;
export const sendNegotiationMessage = (vendor: Vendor, message: string) => `Counteroffer sent to ${vendor.name}: ${message}`;
export const getVendorResponse = (vendor: Vendor, roundNumber: number, requestId: string, request: ProcurementRequest, failureConsumed: boolean) => {
  if (!failureConsumed && vendor.behavior.failure === 'DELAY_ONCE') return { failure: 'timeout' as const };
  if (!failureConsumed && vendor.behavior.failure === 'TEMPORARY_FAILURE_ONCE') return { failure: 'tool failure' as const };
  if (!failureConsumed && vendor.behavior.failure === 'MALFORMED_ONCE') return { raw: 'We can probably meet your request. Please contact our team for commercial details.' };
  const source = roundNumber === 1 ? vendor.behavior.initial : vendor.behavior.rounds[Math.min(roundNumber - 2, vendor.behavior.rounds.length - 1)];
  if (!source) throw new VendorError('Vendor has no further commercial response.');
  return { offer: { ...source, id: createId(), requestId, totalPrice: source.unitPrice * request.quantity } };
};
