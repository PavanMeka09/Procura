import type { Offer, ProcurementRequest, ProposedTerms, Vendor } from '../domain';

export type VendorExecutionMode = 'dynamic' | 'seeded' | 'external' | 'hybrid';

export type VendorResponse =
  | { failure: 'timeout' | 'tool failure' }
  | { raw: string }
  | { offer: Offer };

export interface VendorNegotiationMessageRecord {
  sender: 'AGENT' | 'VENDOR' | 'SYSTEM';
  content: string;
  roundNumber: number;
}

export interface VendorNegotiationContext {
  requestId: string;
  roundNumber: number;
  request: ProcurementRequest;
  lastCounterMessage?: string;
  lastProposedTerms?: ProposedTerms;
  messageHistory?: VendorNegotiationMessageRecord[];
  failureConsumed?: boolean;
  mode?: VendorExecutionMode;
}

export interface VendorConnector {
  searchVendors(
    request: ProcurementRequest,
    requestId: string
  ): Promise<Vendor[]> | Vendor[];

  sendRFQ(vendor: Vendor, request: ProcurementRequest): Promise<string> | string;

  sendNegotiationMessage(vendor: Vendor, message: string): string;

  getVendorResponse(
    vendor: Vendor,
    context: VendorNegotiationContext
  ): Promise<VendorResponse> | VendorResponse;
}

