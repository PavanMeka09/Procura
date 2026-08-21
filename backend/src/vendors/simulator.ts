import { VendorError } from '../errors';
import { createId } from '../domain';
import type { Offer, ProcurementRequest, Vendor } from '../domain';

export const VENDOR_IDS = {
  apex: '4bce3f2e-ef21-4c93-b2bb-4e8a2a2f5c01',
  northstar: '5b7d2c42-f11e-4f0f-a3c3-8b8c4a1d9b02',
  vertex: '6c9e4d53-a22f-4a1f-b4d4-9c9d5b2e0c03',
} as const;

/**
 * Creates a synthetic vendor offer structure.
 */
function createSyntheticOffer(
  requestId: string,
  vendorId: string,
  roundNumber: number,
  unitPrice: number,
  deliveryDays: number,
  warrantyMonths: number,
  advancePaymentPercent: number,
  paymentTerms: string
): Offer {
  const proposalType = roundNumber === 1 ? 'the initial quote' : 'this revised proposal';
  const rawResponse = `We can supply ${unitPrice.toLocaleString('en-IN')} INR per unit for ${proposalType}, delivery in ${deliveryDays} days, ${warrantyMonths}-month warranty, and ${advancePaymentPercent}% advance payment (${paymentTerms}). Offer valid for 15 days.`;

  return {
    id: createId(),
    requestId,
    vendorId,
    roundNumber,
    rawResponse,
    unitPrice,
    totalPrice: unitPrice,
    deliveryDays,
    warrantyMonths,
    advancePaymentPercent,
    paymentTerms,
    validityDays: 15,
    additionalConditions: [],
    extractionConfidence: 0.98,
  };
}

/**
 * Returns seeded test vendors with predefined multi-round concession curves and simulated failure triggers.
 */
export function seededVendors(requestId: string): Vendor[] {
  return [
    {
      id: VENDOR_IDS.apex,
      slug: 'vendor-a',
      name: 'Apex Devices',
      category: 'Business hardware',
      approved: true,
      reliabilityScore: 0.84,
      contact: 'sales@apex.example',
      behavior: {
        initial: createSyntheticOffer(
          requestId,
          VENDOR_IDS.apex,
          1,
          60000,
          20,
          24,
          50,
          '50% advance, balance before dispatch'
        ),
        rounds: [
          createSyntheticOffer(
            requestId,
            VENDOR_IDS.apex,
            2,
            57000,
            20,
            24,
            30,
            '30% advance, balance on dispatch'
          ),
          createSyntheticOffer(
            requestId,
            VENDOR_IDS.apex,
            3,
            56500,
            20,
            24,
            20,
            '20% advance, balance on delivery'
          ),
        ],
        failure: 'DELAY_ONCE',
      },
    },
    {
      id: VENDOR_IDS.northstar,
      slug: 'vendor-b',
      name: 'Northstar IT',
      category: 'Business hardware',
      approved: true,
      reliabilityScore: 0.91,
      contact: 'rfq@northstar.example',
      behavior: {
        initial: createSyntheticOffer(
          requestId,
          VENDOR_IDS.northstar,
          1,
          62000,
          14,
          36,
          20,
          '20% advance, balance on delivery'
        ),
        rounds: [
          createSyntheticOffer(
            requestId,
            VENDOR_IDS.northstar,
            2,
            57500,
            14,
            36,
            20,
            '20% advance, balance on delivery'
          ),
          createSyntheticOffer(
            requestId,
            VENDOR_IDS.northstar,
            3,
            56000,
            14,
            36,
            20,
            '20% advance, balance on delivery'
          ),
        ],
        failure: 'MALFORMED_ONCE',
      },
    },
    {
      id: VENDOR_IDS.vertex,
      slug: 'vendor-c',
      name: 'Vertex Systems',
      category: 'Business hardware',
      approved: true,
      reliabilityScore: 0.96,
      contact: 'commercial@vertex.example',
      behavior: {
        initial: createSyntheticOffer(
          requestId,
          VENDOR_IDS.vertex,
          1,
          58000,
          21,
          24,
          20,
          '20% advance, balance on delivery'
        ),
        rounds: [
          createSyntheticOffer(
            requestId,
            VENDOR_IDS.vertex,
            2,
            56000,
            21,
            24,
            20,
            '20% advance, balance on delivery'
          ),
          createSyntheticOffer(
            requestId,
            VENDOR_IDS.vertex,
            3,
            55500,
            21,
            24,
            20,
            '20% advance, balance on delivery'
          ),
        ],
        failure: 'TEMPORARY_FAILURE_ONCE',
      },
    },
  ];
}

export function searchVendors(
  request: ProcurementRequest,
  requestId: string
): Vendor[] {
  return seededVendors(requestId).filter(
    (vendor) => vendor.category.toLowerCase().includes('hardware') && vendor.approved
  );
}

export function getVendorProfile(
  vendorId: string,
  requestId: string
): Vendor | null {
  return seededVendors(requestId).find((v) => v.id === vendorId) ?? null;
}

export function sendRFQ(vendor: Vendor, request: ProcurementRequest): string {
  const targetFormatted = request.targetUnitPrice
    ? `₹${request.targetUnitPrice.toLocaleString('en-IN')}`
    : 'not specified';

  return `RFQ: ${request.quantity} ${request.item}; target ${targetFormatted} / unit; hard cap ₹${request.maximumUnitPrice.toLocaleString('en-IN')}; delivery ≤ ${request.deliveryDays} days; warranty ≥ ${request.minimumWarrantyMonths} months; advance ≤ ${request.maximumAdvancePaymentPercent}%.`;
}

export function sendNegotiationMessage(vendor: Vendor, message: string): string {
  return `Counteroffer sent to ${vendor.name}: ${message}`;
}

export type VendorResponse =
  | { failure: 'timeout' | 'tool failure' }
  | { raw: string }
  | { offer: Offer };

export function getVendorResponse(
  vendor: Vendor,
  roundNumber: number,
  requestId: string,
  request: ProcurementRequest,
  failureConsumed: boolean
): VendorResponse {
  // Simulate controlled tool/vendor failures on first attempt
  if (!failureConsumed && vendor.behavior.failure === 'DELAY_ONCE') {
    return { failure: 'timeout' };
  }

  if (!failureConsumed && vendor.behavior.failure === 'TEMPORARY_FAILURE_ONCE') {
    return { failure: 'tool failure' };
  }

  if (!failureConsumed && vendor.behavior.failure === 'MALFORMED_ONCE') {
    return {
      raw: 'We can probably meet your request. Please contact our team for commercial details.',
    };
  }

  const roundIndex = Math.min(roundNumber - 2, vendor.behavior.rounds.length - 1);
  const sourceOffer =
    roundNumber === 1 ? vendor.behavior.initial : vendor.behavior.rounds[roundIndex];

  if (!sourceOffer) {
    throw new VendorError('Vendor has no further commercial response.');
  }

  return {
    offer: {
      ...sourceOffer,
      id: createId(),
      requestId,
      totalPrice: sourceOffer.unitPrice * request.quantity,
    },
  };
}
