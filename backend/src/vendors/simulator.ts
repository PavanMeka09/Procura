import { VendorError } from '../errors';
import { createId } from '../domain';
import type { Offer, ProcurementRequest, Vendor } from '../domain';
import { config } from '../utils/config';
import { getAIVendorResponse } from './ai-vendor-agent';
import { getHttpVendorResponse } from './http-vendor-connector';
import type { VendorNegotiationContext, VendorResponse } from './types';

export type { VendorResponse, VendorNegotiationContext, VendorConnector, VendorExecutionMode } from './types';

export const VENDOR_IDS = {
  apex: '4bce3f2e-ef21-4c93-b2bb-4e8a2a2f5c01',
  northstar: '5b7d2c42-f11e-4f0f-a3c3-8b8c4a1d9b02',
  vertex: '6c9e4d53-a22f-4a1f-b4d4-9c9d5b2e0c03',
} as const;

/**
 * Creates a synthetic vendor offer structure for deterministic test suites.
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
 * Returns autonomous vendor profiles equipped with private commercial constraints,
 * sales personas, and fallback multi-round concession curves.
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
      vendorType: 'ai_agent',
      channel: 'Autonomous AI Sales Agent',
      salesPersona:
        'Fast-paced commercial hardware supplier. Prioritizes deal volume and quick closure over maximum margin; willing to make larger price concessions if advance payment terms are met.',
      privateConstraints: {
        floorUnitPrice: 55500,
        targetUnitPrice: 60000,
        minAdvancePercent: 20,
        minDeliveryDays: 20,
        maxWarrantyMonths: 24,
        concessionStrategy: 'eager_closer',
        salesPersona:
          'Apex Devices sales director. Open to cutting price down to ₹55,500 for rapid closing.',
      },
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
      vendorType: 'ai_agent',
      channel: 'Autonomous AI Sales Agent',
      salesPersona:
        'Enterprise IT hardware distributor. Backed by extensive 36-month warranties and rapid 14-day delivery; enforces strict minimum margin floors.',
      privateConstraints: {
        floorUnitPrice: 56000,
        targetUnitPrice: 62000,
        minAdvancePercent: 20,
        minDeliveryDays: 14,
        maxWarrantyMonths: 36,
        concessionStrategy: 'tough_bargainer',
        salesPersona:
          'Northstar IT enterprise sales VP. Emphasizes superior 36-month warranty and rapid fulfillment; holds a firm floor of ₹56,000.',
      },
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
      vendorType: 'ai_agent',
      channel: 'Autonomous AI Sales Agent',
      salesPersona:
        'Established IT systems integrator. Offers balanced commercial terms with predictable step-by-step price concessions down to ₹55,000.',
      privateConstraints: {
        floorUnitPrice: 55000,
        targetUnitPrice: 58000,
        minAdvancePercent: 20,
        minDeliveryDays: 21,
        maxWarrantyMonths: 24,
        concessionStrategy: 'balanced',
        salesPersona:
          'Vertex Systems commercial account manager. Bids competitively with high reliability and balanced concession curves.',
      },
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

/**
 * Returns a vendor response by dynamically routing to the appropriate connector:
 * - Autonomous AI Vendor Agent (Default): Reacts dynamically to buyer counter-offers using private constraints and LLM sales persona.
 * - HTTP External Connector: Dispatches to external REST endpoints.
 * - Seeded Benchmark Simulator: Replays deterministic concession curves for test suites.
 */
export function getVendorResponse(
  vendor: Vendor,
  context: VendorNegotiationContext
): Promise<VendorResponse> | VendorResponse {
  const { roundNumber, requestId, request, failureConsumed = false } = context;
  const activeMode = context.mode ?? config.vendorMode ?? 'dynamic';

  // 1. Seeded deterministic execution mode for regression benchmarks
  if (activeMode === 'seeded' || vendor.vendorType === 'seeded') {
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

    const roundIndex = Math.min(roundNumber - 2, (vendor.behavior?.rounds?.length ?? 1) - 1);
    const sourceOffer =
      roundNumber === 1 ? vendor.behavior?.initial : vendor.behavior?.rounds?.[roundIndex];

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

  // 2. HTTP External API Connector for live REST vendor services
  if (vendor.vendorType === 'http_api' || activeMode === 'external') {
    return getHttpVendorResponse(vendor, context);
  }

  // 3. Autonomous AI Vendor Agent counter-party (Default)
  return getAIVendorResponse(vendor, context);
}
