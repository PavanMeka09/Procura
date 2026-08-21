/**
 * Core domain types and state machine definitions for the Procura autonomous negotiation system.
 */

export type AgentState =
  | 'INTAKE'
  | 'POLICY_CHECK'
  | 'KNOWLEDGE_RETRIEVAL'
  | 'VENDOR_SELECTION'
  | 'RFQ_GENERATION'
  | 'RFQ_SENT'
  | 'WAITING_FOR_VENDOR'
  | 'OFFER_RECEIVED'
  | 'OFFER_ANALYSIS'
  | 'NEGOTIATION_PLANNING'
  | 'ACTION_PROPOSED'
  | 'CRITIC_REVIEW'
  | 'POLICY_REVIEW'
  | 'EXECUTION'
  | 'HUMAN_REVIEW'
  | 'ACCEPTED'
  | 'STOPPED'
  | 'FAILED';

export type EventType =
  | 'REQUIREMENT_EXTRACTED'
  | 'POLICY_RETRIEVED'
  | 'VENDORS_SELECTED'
  | 'RFQ_SENT'
  | 'VENDOR_RESPONSE_RECEIVED'
  | 'OFFER_PARSED'
  | 'NEGOTIATION_PLAN_CREATED'
  | 'ACTION_PROPOSED'
  | 'CRITIC_STARTED'
  | 'CRITIC_RESULT'
  | 'POLICY_RESULT'
  | 'ACTION_BLOCKED'
  | 'COUNTEROFFER_SENT'
  | 'HUMAN_REVIEW_REQUIRED'
  | 'HUMAN_APPROVED'
  | 'HUMAN_REJECTED'
  | 'RETRY_STARTED'
  | 'FALLBACK_ACTIVATED'
  | 'NEGOTIATION_STOPPED'
  | 'DEAL_ACCEPTED'
  | 'AGENT_FAILED';

/**
 * Normalized purchase requirements parsed from natural language.
 */
export interface ProcurementRequest {
  item: string;
  quantity: number;
  targetUnitPrice: number | null;
  maximumUnitPrice: number;
  deliveryDays: number;
  minimumWarrantyMonths: number;
  maximumAdvancePaymentPercent: number;
  negotiableTerms: string[];
  nonNegotiableTerms: string[];
}

export interface VendorPrivateConstraints {
  floorUnitPrice: number;
  targetUnitPrice: number;
  minAdvancePercent: number;
  minDeliveryDays: number;
  maxWarrantyMonths: number;
  concessionStrategy: 'eager_closer' | 'tough_bargainer' | 'balanced';
  salesPersona: string;
}

export interface Vendor {
  id: string;
  slug: string;
  name: string;
  category: string;
  approved: boolean;
  reliabilityScore: number;
  contact: string;
  vendorType?: 'ai_agent' | 'http_api' | 'seeded';
  channel?: string;
  salesPersona?: string;
  endpointUrl?: string;
  privateConstraints?: VendorPrivateConstraints;
  behavior: {
    initial: Offer;
    rounds: Offer[];
    failure?: 'DELAY_ONCE' | 'MALFORMED_ONCE' | 'TEMPORARY_FAILURE_ONCE';
  };
}

export interface Offer {
  id: string;
  requestId: string;
  vendorId: string;
  roundNumber: number;
  rawResponse: string;
  unitPrice: number;
  totalPrice: number;
  deliveryDays: number;
  warrantyMonths: number;
  advancePaymentPercent: number;
  paymentTerms: string;
  validityDays: number | null;
  additionalConditions: string[];
  extractionConfidence: number;
  criticStatus?: CriticResult['decision'];
  policyStatus?: PolicyResult['decision'];
}

export interface ProposedTerms {
  unitPrice: number;
  deliveryDays?: number;
  warrantyMonths?: number;
  advancePaymentPercent?: number;
  paymentTerms?: string;
}

export type AgentAction =
  | {
      type: 'SEND_COUNTER';
      vendorId: string;
      message: string;
      proposedTerms: ProposedTerms;
      rationale: string;
    }
  | {
      type: 'ACCEPT';
      vendorId: string;
      offerId: string;
      rationale: string;
    }
  | {
      type: 'ESCALATE';
      reason: string;
    }
  | {
      type: 'STOP';
      reason: string;
    };

export interface CriticResult {
  decision: 'PASS' | 'WARN' | 'BLOCK';
  confidence: number;
  policyViolations: string[];
  concerns: string[];
  evidence: string[];
  requiresHumanReview: boolean;
}

export interface PolicyResult {
  decision: 'PASS' | 'BLOCK' | 'HUMAN_REVIEW';
  violations: string[];
  warnings: string[];
  evidence: string[];
}

export interface DecisionResult {
  decision: 'EXECUTE' | 'BLOCK' | 'HUMAN_REVIEW' | 'STOP';
  reason: string;
}

export interface NegotiationMessage {
  id: string;
  vendorId: string;
  sender: 'AGENT' | 'VENDOR' | 'SYSTEM';
  content: string;
  roundNumber: number;
  messageType: string;
  createdAt: string;
}

export interface AgentEvent {
  id: string;
  sessionId: string;
  type: EventType;
  state: AgentState;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ConcessionBudget {
  price: number;
  advancePayment: number;
  deliveryDays: number;
  warrantyMonths: number;
}

export interface ModelRun {
  id?: string;
  requestId?: string;
  sessionId?: string;
  model: string;
  role: 'NEGOTIATOR' | 'CRITIC' | 'FALLBACK';
  promptVersion?: string;
  durationMs: number;
  retryCount: number;
  fallback: boolean;
  success: boolean;
  roundNumber?: number;
  estimatedCost?: number | null;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface ToolExecution {
  id?: string;
  requestId?: string;
  sessionId?: string;
  toolName: string;
  durationMs: number;
  success: boolean;
  retryCount: number;
  input?: Record<string, unknown>;
  error?: string;
  createdAt?: string;
}

export interface HumanReview {
  id: string;
  reason: string;
  proposedAction: AgentAction;
  evidence: string[];
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'STOPPED';
  createdAt: string;
  resolvedAt?: string;
}

export interface EvaluationResult {
  caseId: string;
  passed: boolean;
  expectedBehavior: string;
  actualBehavior: string;
  details: string[];
}

export interface EvaluationRun {
  id: string;
  total: number;
  passed: number;
  failed: number;
  metrics: Record<string, number>;
  results: EvaluationResult[];
  executionMode?: 'provider' | 'test-adapter';
  createdAt: string;
}

export interface RetrievedEvidenceItem {
  id: string;
  type: string;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface NegotiationSession {
  id: string;
  requestId: string;
  currentVendorId: string | null;
  currentRound: number;
  maxRoundsPerVendor: number;
  originalRequest: ProcurementRequest;
  vendors: Vendor[];
  offers: Offer[];
  messages: NegotiationMessage[];
  events: AgentEvent[];
  currentBestOffer: Offer | null;
  targetUnitPrice: number | null;
  maximumUnitPrice: number;
  minimumWarrantyMonths: number;
  maximumDeliveryDays: number;
  maximumAdvancePaymentPercent: number;
  concessionBudget: ConcessionBudget;
  riskScore: number;
  confidence: number;
  currentState: AgentState;
  pendingAction: AgentAction | null;
  criticResult: CriticResult | null;
  policyResult: PolicyResult | null;
  stopReason: string | null;
  modelRuns: ModelRun[];
  toolExecutions: ToolExecution[];
  humanReview: HumanReview | null;
  retrievedEvidence: RetrievedEvidenceItem[];
  retrievalMode: 'pgvector' | 'lexical';
  startedAt: string;
  updatedAt: string;
}

/**
 * Generates an ISO 8601 UTC timestamp.
 */
export const now = (): string => new Date().toISOString();

/**
 * Generates a standard UUID v4 identifier.
 */
export const createId = (): string => crypto.randomUUID();

/**
 * Identifies the best compliant offer (prioritizing lowest unit price and advance payment),
 * falling back to lowest unit price if no compliant offer exists.
 */
export function findBestOffer(offers: Offer[]): Offer | null {
  const compliantOffers = offers.filter((offer) => offer.policyStatus === 'PASS');

  if (compliantOffers.length > 0) {
    return (
      compliantOffers.sort(
        (a, b) =>
          a.unitPrice - b.unitPrice ||
          a.advancePaymentPercent - b.advancePaymentPercent
      )[0] ?? null
    );
  }

  return [...offers].sort((a, b) => a.unitPrice - b.unitPrice)[0] ?? null;
}
