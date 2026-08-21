import { createId, type Offer, type ProcurementRequest, type Vendor } from '../domain';
import type { VendorNegotiationContext, VendorResponse } from './types';

export interface HttpVendorPayload {
  requestId: string;
  vendorId: string;
  roundNumber: number;
  request: ProcurementRequest;
  lastCounterMessage?: string;
  lastProposedTerms?: Record<string, unknown>;
}

export interface HttpVendorResponseBody {
  unitPrice: number;
  deliveryDays: number;
  warrantyMonths: number;
  advancePaymentPercent: number;
  paymentTerms: string;
  validityDays?: number;
  rawResponse?: string;
}

/**
 * External REST API connector for real external vendor quote endpoints and webhooks.
 */
export async function getHttpVendorResponse(
  vendor: Vendor,
  context: VendorNegotiationContext
): Promise<VendorResponse> {
  const endpointUrl = vendor.endpointUrl;

  if (!endpointUrl) {
    return { failure: 'tool failure' };
  }

  const { requestId, roundNumber, request } = context;

  const payload: HttpVendorPayload = {
    requestId,
    vendorId: vendor.id,
    roundNumber,
    request,
    lastCounterMessage: context.lastCounterMessage,
    lastProposedTerms: context.lastProposedTerms as unknown as Record<string, unknown>,
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Procura-Autonomous-Procurement/2.0',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 408 || response.status === 504) {
        return { failure: 'timeout' };
      }
      return { failure: 'tool failure' };
    }

    const data = (await response.json()) as HttpVendorResponseBody;

    const rawResponse =
      data.rawResponse ??
      `External quote received: ₹${data.unitPrice.toLocaleString('en-IN')} / unit, delivery in ${data.deliveryDays} days, ${data.warrantyMonths}-month warranty, and ${data.advancePaymentPercent}% advance (${data.paymentTerms}).`;

    const offer: Offer = {
      id: createId(),
      requestId,
      vendorId: vendor.id,
      roundNumber,
      rawResponse,
      unitPrice: data.unitPrice,
      totalPrice: data.unitPrice * request.quantity,
      deliveryDays: data.deliveryDays,
      warrantyMonths: data.warrantyMonths,
      advancePaymentPercent: data.advancePaymentPercent,
      paymentTerms: data.paymentTerms,
      validityDays: data.validityDays ?? 15,
      additionalConditions: [],
      extractionConfidence: 0.99,
    };

    return { offer };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { failure: 'timeout' };
    }
    return { failure: 'tool failure' };
  }
}
