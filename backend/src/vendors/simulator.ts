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
export function seededVendors(
  requestId: string,
  request?: ProcurementRequest
): Vendor[] {
  const targetPrice = request?.targetUnitPrice ?? request?.maximumUnitPrice ?? 55000;
  const maxPrice = request?.maximumUnitPrice ?? 57000;
  const delivery = request?.deliveryDays ?? 21;
  const warranty = request?.minimumWarrantyMonths ?? 24;
  const maxAdvance = request?.maximumAdvancePaymentPercent ?? 20;
  const category = request?.item ?? 'Business hardware';

  const apexRound1Price = request ? Math.round(maxPrice * 1.08) : 60000;
  const apexRound2Price = request ? Math.round(maxPrice * 1.02) : 57000;
  const apexRound3Price = request ? Math.round(targetPrice * 1.01) : 56500;
  const apexFloorPrice = request ? Math.round(targetPrice * 1.01) : 55500;
  const apexDeliveryDays = request ? Math.max(1, delivery - 1) : 20;

  const northstarRound1Price = request ? Math.round(maxPrice * 1.10) : 62000;
  const northstarRound2Price = request ? Math.round(maxPrice * 1.03) : 57500;
  const northstarRound3Price = request ? Math.round(targetPrice * 1.01) : 56000;
  const northstarFloorPrice = request ? Math.round(targetPrice * 1.01) : 56000;
  const northstarDeliveryDays = request ? Math.max(1, Math.floor(delivery * 0.7)) : 14;
  const northstarWarrantyMonths = request ? Math.max(warranty, 36) : 36;

  const vertexRound1Price = request ? Math.round(maxPrice * 1.04) : 58000;
  const vertexRound2Price = request ? Math.round(maxPrice * 1.01) : 56000;
  const vertexRound3Price = request ? targetPrice : 55000;
  const vertexFloorPrice = request ? targetPrice : 55000;

  return [
    {
      id: VENDOR_IDS.apex,
      slug: 'vendor-a',
      name: 'Apex Devices',
      category,
      approved: true,
      reliabilityScore: 0.84,
      contact: 'sales@apex.example',
      vendorType: 'ai_agent',
      channel: 'Autonomous AI Sales Agent',
      salesPersona:
        'Fast-paced commercial hardware supplier. Prioritizes deal volume and quick closure over maximum margin; willing to make larger price concessions if advance payment terms are met.',
      privateConstraints: {
        floorUnitPrice: apexFloorPrice,
        targetUnitPrice: apexRound1Price,
        minAdvancePercent: maxAdvance,
        minDeliveryDays: apexDeliveryDays,
        maxWarrantyMonths: warranty,
        concessionStrategy: 'eager_closer',
        salesPersona: `Apex Devices sales director. Open to cutting price down to ₹${apexFloorPrice.toLocaleString('en-IN')} for rapid closing.`,
      },
      behavior: {
        initial: createSyntheticOffer(
          requestId,
          VENDOR_IDS.apex,
          1,
          apexRound1Price,
          apexDeliveryDays,
          warranty,
          50,
          '50% advance, balance before dispatch'
        ),
        rounds: [
          createSyntheticOffer(
            requestId,
            VENDOR_IDS.apex,
            2,
            apexRound2Price,
            apexDeliveryDays,
            warranty,
            30,
            '30% advance, balance on dispatch'
          ),
          createSyntheticOffer(
            requestId,
            VENDOR_IDS.apex,
            3,
            apexRound3Price,
            apexDeliveryDays,
            warranty,
            maxAdvance,
            `${maxAdvance}% advance, balance on delivery`
          ),
        ],
        failure: 'DELAY_ONCE',
      },
    },
    {
      id: VENDOR_IDS.northstar,
      slug: 'vendor-b',
      name: 'Northstar IT',
      category,
      approved: true,
      reliabilityScore: 0.91,
      contact: 'rfq@northstar.example',
      vendorType: 'ai_agent',
      channel: 'Autonomous AI Sales Agent',
      salesPersona:
        'Enterprise IT hardware distributor. Backed by extensive 36-month warranties and rapid 14-day delivery; enforces strict minimum margin floors.',
      privateConstraints: {
        floorUnitPrice: northstarFloorPrice,
        targetUnitPrice: northstarRound1Price,
        minAdvancePercent: maxAdvance,
        minDeliveryDays: northstarDeliveryDays,
        maxWarrantyMonths: northstarWarrantyMonths,
        concessionStrategy: 'tough_bargainer',
        salesPersona: `Northstar IT enterprise sales VP. Emphasizes superior ${northstarWarrantyMonths}-month warranty and rapid fulfillment; holds a firm floor of ₹${northstarFloorPrice.toLocaleString('en-IN')}.`,
      },
      behavior: {
        initial: createSyntheticOffer(
          requestId,
          VENDOR_IDS.northstar,
          1,
          northstarRound1Price,
          northstarDeliveryDays,
          northstarWarrantyMonths,
          maxAdvance,
          `${maxAdvance}% advance, balance on delivery`
        ),
        rounds: [
          createSyntheticOffer(
            requestId,
            VENDOR_IDS.northstar,
            2,
            northstarRound2Price,
            northstarDeliveryDays,
            northstarWarrantyMonths,
            maxAdvance,
            `${maxAdvance}% advance, balance on delivery`
          ),
          createSyntheticOffer(
            requestId,
            VENDOR_IDS.northstar,
            3,
            northstarRound3Price,
            northstarDeliveryDays,
            northstarWarrantyMonths,
            maxAdvance,
            `${maxAdvance}% advance, balance on delivery`
          ),
        ],
        failure: 'MALFORMED_ONCE',
      },
    },
    {
      id: VENDOR_IDS.vertex,
      slug: 'vendor-c',
      name: 'Vertex Systems',
      category,
      approved: true,
      reliabilityScore: 0.96,
      contact: 'commercial@vertex.example',
      vendorType: 'ai_agent',
      channel: 'Autonomous AI Sales Agent',
      salesPersona:
        'Established IT systems integrator. Offers balanced commercial terms with predictable step-by-step price concessions down to target price.',
      privateConstraints: {
        floorUnitPrice: vertexFloorPrice,
        targetUnitPrice: vertexRound1Price,
        minAdvancePercent: maxAdvance,
        minDeliveryDays: delivery,
        maxWarrantyMonths: warranty,
        concessionStrategy: 'balanced',
        salesPersona:
          'Vertex Systems commercial account manager. Bids competitively with high reliability and balanced concession curves.',
      },
      behavior: {
        initial: createSyntheticOffer(
          requestId,
          VENDOR_IDS.vertex,
          1,
          vertexRound1Price,
          delivery,
          warranty,
          maxAdvance,
          `${maxAdvance}% advance, balance on delivery`
        ),
        rounds: [
          createSyntheticOffer(
            requestId,
            VENDOR_IDS.vertex,
            2,
            vertexRound2Price,
            delivery,
            warranty,
            maxAdvance,
            `${maxAdvance}% advance, balance on delivery`
          ),
          createSyntheticOffer(
            requestId,
            VENDOR_IDS.vertex,
            3,
            vertexRound3Price,
            delivery,
            warranty,
            maxAdvance,
            `${maxAdvance}% advance, balance on delivery`
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
  return seededVendors(requestId, request).filter(
    (vendor) => vendor.approved
  );
}

export function getVendorProfile(
  vendorId: string,
  requestId: string,
  request?: ProcurementRequest
): Vendor | null {
  return seededVendors(requestId, request).find((v) => v.id === vendorId) ?? null;
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
