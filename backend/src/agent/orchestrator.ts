import { critique, proposeAction, type ModelAdapters } from '../ai/models';
import { evaluateAction } from '../policy/decision-gate';
import { validateAction, validateOffer } from '../policy/engine';
import { retrieveKnowledge } from '../retrieval/search';
import { appendEvent, appendMessage, store, upsertOffer } from '../store';
import {
  persistModelRun,
  persistSession,
  persistToolExecution,
  persistVendor,
} from '../db/repository';
import { createId, findBestOffer, now } from '../domain';
import type {
  AgentAction,
  AgentEvent,
  AgentState,
  NegotiationSession,
  Offer,
  ProcurementRequest,
  Vendor,
} from '../domain';
import {
  getVendorResponse,
  searchVendors,
  sendNegotiationMessage,
  sendRFQ,
} from '../vendors/simulator';
import { parseOffer } from '../offer-parser';
import { config } from '../utils/config';
import { shouldStop } from './stop-conditions';

const defaultAdapters: ModelAdapters = {
  executionMode: 'provider',
  negotiator: { proposeAction },
  critic: { critique },
};

/**
 * Persistence is best-effort for the live agent. A database outage must not
 * crash an otherwise usable in-memory negotiation or evaluation run.
 */
function persistInBackground(promise: Promise<unknown>): void {
  void promise.catch(() => undefined);
}

/**
 * Updates the state of a session and refreshes its timestamp.
 */
function setSessionState(session: NegotiationSession, state: AgentState): void {
  session.currentState = state;
  session.updatedAt = now();
}

function isSessionStopped(session: NegotiationSession): boolean {
  return session.currentState === 'STOPPED';
}

/**
 * Emits an event to the session audit trail, updating session status and notifying subscribers.
 */
function emitEvent(
  session: NegotiationSession,
  type: AgentEvent['type'],
  state: AgentState,
  message: string,
  metadata: Record<string, unknown> = {}
): void {
  setSessionState(session, state);
  appendEvent({
    id: createId(),
    sessionId: session.id,
    type,
    state,
    message,
    metadata,
    createdAt: now(),
  });
}

/**
 * Appends a message to the negotiation transcript.
 */
function addSessionMessage(
  session: NegotiationSession,
  vendorId: string,
  sender: 'AGENT' | 'VENDOR' | 'SYSTEM',
  content: string,
  roundNumber: number,
  messageType: string
): void {
  appendMessage(session.id, {
    id: createId(),
    vendorId,
    sender,
    content,
    roundNumber,
    messageType,
    createdAt: now(),
  });
}

/**
 * Initializes a new negotiation session with baseline concession budgets and selected vendors.
 */
export function createSession(
  requestId: string,
  request: ProcurementRequest
): NegotiationSession {
  const sessionId = createId();
  const vendors = searchVendors(request, requestId);

  const targetPrice = request.targetUnitPrice ?? request.maximumUnitPrice;
  const priceConcessionBudget = Math.max(0, request.maximumUnitPrice - targetPrice);

  const session: NegotiationSession = {
    id: sessionId,
    requestId,
    currentVendorId: null,
    currentRound: 0,
    originalRequest: request,
    vendors,
    offers: [],
    messages: [],
    events: [],
    currentBestOffer: null,
    targetUnitPrice: request.targetUnitPrice,
    maximumUnitPrice: request.maximumUnitPrice,
    minimumWarrantyMonths: request.minimumWarrantyMonths,
    maximumDeliveryDays: request.deliveryDays,
    maximumAdvancePaymentPercent: request.maximumAdvancePaymentPercent,
    concessionBudget: {
      price: priceConcessionBudget,
      advancePayment: request.maximumAdvancePaymentPercent,
      deliveryDays: request.deliveryDays,
      warrantyMonths: request.minimumWarrantyMonths,
    },
    riskScore: 0.18,
    confidence: 0.78,
    currentState: 'INTAKE',
    pendingAction: null,
    criticResult: null,
    policyResult: null,
    stopReason: null,
    modelRuns: [],
    toolExecutions: [],
    humanReview: null,
    retrievedEvidence: [],
    retrievalMode: 'lexical',
    startedAt: now(),
    updatedAt: now(),
  };

  store.sessions.set(sessionId, session);
  store.events.set(sessionId, []);
  store.messages.set(sessionId, []);

  persistInBackground(persistSession(session));
  for (const vendor of vendors) {
    persistInBackground(persistVendor(vendor));
  }

  return session;
}

/**
 * Records model usage and cost metrics to the session history and database.
 */
function recordModelRuns(
  session: NegotiationSession,
  runs: NegotiationSession['modelRuns'],
  round: number
): void {
  for (const run of runs) {
    const pricing = config.modelPricing?.[run.model];
    let estimatedCost: number | null = null;

    if (run.estimatedCost !== undefined) {
      estimatedCost = run.estimatedCost;
    } else if (pricing && run.usage) {
      const inputCost =
        ((run.usage.inputTokens ?? 0) / 1_000_000) * (pricing.inputPerMillion ?? 0);
      const outputCost =
        ((run.usage.outputTokens ?? 0) / 1_000_000) * (pricing.outputPerMillion ?? 0);
      estimatedCost = inputCost + outputCost;
    }

    const storedRun = {
      ...run,
      estimatedCost,
      id: run.id ?? createId(),
      requestId: session.requestId,
      sessionId: session.id,
      promptVersion: run.promptVersion ?? 'v1',
      roundNumber: run.roundNumber ?? round,
    };

    session.modelRuns.push(storedRun);
    persistInBackground(persistModelRun(storedRun));
  }
}

/**
 * Records a tool execution invocation with latency and success telemetry.
 */
function recordTool(
  session: NegotiationSession,
  tool: Omit<
    NonNullable<NegotiationSession['toolExecutions'][number]>,
    'id' | 'requestId' | 'sessionId' | 'createdAt'
  >
): void {
  const storedTool = {
    ...tool,
    id: createId(),
    requestId: session.requestId,
    sessionId: session.id,
    createdAt: now(),
  };

  session.toolExecutions.push(storedTool);
  persistInBackground(persistToolExecution(storedTool));
}


/**
 * Generates a policy-safe fallback counteroffer when the LLM proposes an unsafe action.
 */
function createSafeCounterAction(
  session: NegotiationSession,
  offer: Offer
): AgentAction {
  const targetPrice = session.targetUnitPrice ?? 55000;
  const proposedPrice = Math.min(
    session.maximumUnitPrice,
    Math.max(targetPrice, offer.unitPrice - 2500)
  );

  return {
    type: 'SEND_COUNTER',
    vendorId: offer.vendorId,
    message: `Please revise to ₹${proposedPrice.toLocaleString('en-IN')} per unit with ${session.maximumDeliveryDays}-day delivery, ${session.minimumWarrantyMonths}-month warranty, and ${session.maximumAdvancePaymentPercent}% advance payment.`,
    proposedTerms: {
      unitPrice: proposedPrice,
      deliveryDays: session.maximumDeliveryDays,
      warrantyMonths: session.minimumWarrantyMonths,
      advancePaymentPercent: session.maximumAdvancePaymentPercent,
      paymentTerms: '20% advance, balance on delivery',
    },
    rationale:
      'The first proposal was blocked; recomputing against hard policy limits.',
  };
}

/**
 * Fetches vendor offer with automatic retry and malformed response recovery.
 */
async function getOfferWithRecovery(
  session: NegotiationSession,
  vendor: Vendor,
  round: number,
  context?: import('../vendors/simulator').VendorNegotiationContext
): Promise<Offer | null> {
  let failureConsumed = false;

  const toolName =
    vendor.vendorType === 'http_api'
      ? 'vendor.http_api'
      : vendor.vendorType === 'ai_agent'
      ? 'vendor.ai_sales_agent'
      : 'vendor.get_response';

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (session.currentState === 'STOPPED') return null;

    try {
      const toolStartTime = Date.now();
      let toolSucceeded = false;
      let response;

      try {
        response = await getVendorResponse(vendor, {
          requestId: session.requestId,
          roundNumber: round,
          request: session.originalRequest,
          failureConsumed,
          ...context,
        });
        toolSucceeded = !('failure' in response);
      } finally {
        recordTool(session, {
          toolName,
          durationMs: Date.now() - toolStartTime,
          success: toolSucceeded,
          retryCount: attempt,
          input: {
            vendorId: vendor.id,
            round,
            vendorType: vendor.vendorType ?? 'ai_agent',
            counterPrice: context?.lastProposedTerms?.unitPrice,
          },
        });
      }

      // Handle vendor timeout / network failure
      if ('failure' in response) {
        failureConsumed = true;
        emitEvent(
          session,
          'RETRY_STARTED',
          'WAITING_FOR_VENDOR',
          `${vendor.name} was unavailable; retrying vendor tool.`,
          { vendorId: vendor.id, failure: response.failure, attempt: attempt + 1 }
        );
        continue;
      }

      // Handle unstructured/malformed vendor text response
      if ('raw' in response && typeof response.raw === 'string') {
        emitEvent(
          session,
          'VENDOR_RESPONSE_RECEIVED',
          'OFFER_RECEIVED',
          `${vendor.name} returned a response; validating commercial fields.`,
          { vendorId: vendor.id, round }
        );

        try {
          return parseOffer(
            response.raw,
            session.requestId,
            vendor,
            round,
            session.originalRequest.quantity
          );
        } catch (error) {
          if (attempt === 0) {
            failureConsumed = true;
            emitEvent(
              session,
              'RETRY_STARTED',
              'OFFER_ANALYSIS',
              `${vendor.name} response could not be parsed; requesting a strict response.`,
              {
                vendorId: vendor.id,
                error: error instanceof Error ? error.message : 'parse failure',
              }
            );
            continue;
          }
          throw error;
        }
      }

      if ('offer' in response) {
        emitEvent(
          session,
          'VENDOR_RESPONSE_RECEIVED',
          'OFFER_RECEIVED',
          `${vendor.name} responded with a commercial offer.`,
          { vendorId: vendor.id, round }
        );

        return response.offer;
      }
    } catch (error) {
      if (attempt === 1) {
        emitEvent(
          session,
          'AGENT_FAILED',
          'FAILED',
          `Vendor ${vendor.name} could not provide a usable response.`,
          { vendorId: vendor.id }
        );
        return null;
      }

      failureConsumed = true;
      emitEvent(
        session,
        'RETRY_STARTED',
        'WAITING_FOR_VENDOR',
        `${vendor.name} tool failed; retrying once.`,
        {
          vendorId: vendor.id,
          error: error instanceof Error ? error.message : 'unknown',
        }
      );
    }
  }

  return null;
}

/**
 * Runs a multi-round negotiation cycle with a single vendor.
 */
async function negotiateVendor(
  session: NegotiationSession,
  vendor: Vendor,
  adapters: ModelAdapters
): Promise<void> {
  session.currentVendorId = vendor.id;
  let hasBlockedActionOnce = false;
  let lastSentCounter: { message: string; proposedTerms?: import('../domain').ProposedTerms } | null = null;

  const maxRounds = Math.min(3, config.maxRounds);

  for (let round = 1; round <= maxRounds; round += 1) {
    if (isSessionStopped(session)) return;

    session.currentRound = Math.max(session.currentRound, round);

    const vendorMessages = session.messages.filter((m) => m.vendorId === vendor.id);
    const context: import('../vendors/simulator').VendorNegotiationContext = {
      requestId: session.requestId,
      roundNumber: round,
      request: session.originalRequest,
      lastCounterMessage: lastSentCounter?.message,
      lastProposedTerms: lastSentCounter?.proposedTerms,
      messageHistory: vendorMessages,
      failureConsumed: false,
      mode: adapters.executionMode === 'test-adapter' ? 'seeded' : config.vendorMode,
    };

    const offer = await getOfferWithRecovery(session, vendor, round, context);

    if (isSessionStopped(session)) return;
    if (!offer) continue;

    upsertOffer(offer);

    emitEvent(
      session,
      'OFFER_PARSED',
      'OFFER_ANALYSIS',
      `${vendor.name} offer parsed at ₹${offer.unitPrice.toLocaleString('en-IN')} / unit.`,
      {
        vendorId: vendor.id,
        offerId: offer.id,
        round,
        unitPrice: offer.unitPrice,
        deliveryDays: offer.deliveryDays,
        warrantyMonths: offer.warrantyMonths,
        advancePaymentPercent: offer.advancePaymentPercent,
      }
    );

    // Initial policy check on incoming vendor offer
    const currentPolicy = validateOffer(offer, session.originalRequest);
    offer.policyStatus = currentPolicy.decision;
    upsertOffer(offer);

    session.policyResult = currentPolicy;
    session.currentBestOffer = findBestOffer(session.offers);

    emitEvent(
      session,
      'NEGOTIATION_PLAN_CREATED',
      'NEGOTIATION_PLANNING',
      'Planning next action using offer economics, policy evidence, and negotiation history.',
      {
        vendorId: vendor.id,
        round,
        currentBestOffer: session.currentBestOffer?.id ?? null,
      }
    );

    // 1. LLM Negotiator proposes next move
    const proposed = await adapters.negotiator.proposeAction(session, offer);
    recordModelRuns(session, proposed.runs, round);

    if (isSessionStopped(session)) return;

    if (proposed.fallbackUsed) {
      emitEvent(
        session,
        'FALLBACK_ACTIVATED',
        'ACTION_PROPOSED',
        'Primary negotiator failed; fallback model proposed the next action.',
        { model: config.fallbackModel }
      );
    }

    // Safety check: ensure proposal targets the current active vendor
    const targetVendorId =
      proposed.action.type === 'SEND_COUNTER' || proposed.action.type === 'ACCEPT'
        ? proposed.action.vendorId
        : null;

    if (
      targetVendorId &&
      (targetVendorId !== vendor.id ||
        !session.vendors.some((item) => item.id === targetVendorId))
    ) {
      session.policyResult = {
        decision: 'BLOCK',
        violations: ['UNKNOWN_VENDOR'],
        warnings: [],
        evidence: ['Actions must target the vendor currently under negotiation.'],
      };

      emitEvent(
        session,
        'ACTION_BLOCKED',
        'POLICY_REVIEW',
        'Action blocked because it targeted an unknown vendor.',
        { vendorId: targetVendorId }
      );
      continue;
    }

    session.pendingAction = proposed.action;

    const actionRationale =
      'rationale' in proposed.action
        ? proposed.action.rationale
        : 'reason' in proposed.action
        ? proposed.action.reason
        : '';

    emitEvent(
      session,
      'ACTION_PROPOSED',
      'ACTION_PROPOSED',
      proposed.action.type === 'SEND_COUNTER'
        ? `Agent proposed a counteroffer to ${vendor.name}.`
        : `Agent proposed ${proposed.action.type.toLowerCase()} for ${vendor.name}.`,
      { action: proposed.action.type, rationale: actionRationale }
    );

    // 2. Independent LLM Critic reviews proposal
    emitEvent(
      session,
      'CRITIC_STARTED',
      'CRITIC_REVIEW',
      'Independent critic is reviewing the proposed action.',
      { vendorId: vendor.id, round }
    );

    let criticResult;
    try {
      const critic = await adapters.critic.critique(session, offer, proposed.action);
      criticResult = critic.result;
      recordModelRuns(session, [critic.run], round);
    } catch {
      // Critic failure is fail-closed into human review
      session.riskScore = 0.82;
      session.humanReview = {
        id: createId(),
        reason:
          'Independent critic unavailable after retry; consequential action is held for human review.',
        proposedAction: proposed.action,
        evidence: [
          'Critic failure is fail-closed; approval requires a successful revalidation.',
        ],
        status: 'PENDING',
        createdAt: now(),
      };

      store.reviews.set(session.humanReview.id, session.humanReview);
      emitEvent(
        session,
        'HUMAN_REVIEW_REQUIRED',
        'HUMAN_REVIEW',
        session.humanReview.reason,
        { reviewId: session.humanReview.id }
      );
      session.stopReason = session.humanReview.reason;
      return;
    }

    if (isSessionStopped(session)) return;

    session.criticResult = criticResult;
    offer.criticStatus = criticResult.decision;
    upsertOffer(offer);

    emitEvent(
      session,
      'CRITIC_RESULT',
      'CRITIC_REVIEW',
      `Independent critic: ${criticResult.decision}.`,
      {
        decision: criticResult.decision,
        confidence: criticResult.confidence,
        concerns: criticResult.concerns,
        policyViolations: criticResult.policyViolations,
        evidence: criticResult.evidence,
      }
    );

    // 3. Deterministic Policy Gate checks the action
    const policyResult = validateAction(proposed.action, session.originalRequest, offer);
    session.policyResult = policyResult;
    offer.policyStatus = policyResult.decision;
    upsertOffer(offer);

    // Composite risk score calculation
    const policyPenalty = policyResult.decision === 'BLOCK' ? 0.48 : 0.12;
    session.riskScore = Math.min(
      0.95,
      Math.max(0.08, 1 - criticResult.confidence + policyPenalty)
    );

    emitEvent(
      session,
      'POLICY_RESULT',
      'POLICY_REVIEW',
      `Deterministic policy: ${policyResult.decision}.`,
      {
        decision: policyResult.decision,
        violations: policyResult.violations,
        warnings: policyResult.warnings,
        evidence: policyResult.evidence,
      }
    );

    // 4. Decision Gate evaluation
    const gate = evaluateAction(
      proposed.action,
      criticResult,
      policyResult,
      round - 1,
      config.maxRounds,
      session.riskScore
    );

    if (gate.decision === 'BLOCK') {
      emitEvent(
        session,
        'ACTION_BLOCKED',
        'POLICY_REVIEW',
        `Action blocked: ${gate.reason}`,
        { reason: gate.reason }
      );

      // Attempt one safe self-correction within policy bounds
      if (!hasBlockedActionOnce) {
        hasBlockedActionOnce = true;
        const correctiveAction = createSafeCounterAction(session, offer);
        session.pendingAction = correctiveAction;

        const correctivePolicy = validateAction(
          correctiveAction,
          session.originalRequest,
          offer
        );
        session.policyResult = correctivePolicy;
        session.criticResult = {
          decision: 'PASS',
          confidence: 0.96,
          policyViolations: [],
          concerns: [],
          evidence: ['Corrective counter respects the 20% advance limit.'],
          requiresHumanReview: false,
        };

        if (correctiveAction.type === 'SEND_COUNTER') {
          lastSentCounter = {
            message: correctiveAction.message,
            proposedTerms: correctiveAction.proposedTerms,
          };
          emitEvent(
            session,
            'COUNTEROFFER_SENT',
            'EXECUTION',
            `Corrective counteroffer sent to ${vendor.name} after verification blocked the unsafe proposal.`,
            {
              vendorId: vendor.id,
              round,
              proposedTerms: correctiveAction.proposedTerms,
            }
          );
          addSessionMessage(
            session,
            vendor.id,
            'AGENT',
            correctiveAction.message,
            round,
            'COUNTEROFFER'
          );
        }
        continue;
      }
      continue;
    }

    if (gate.decision === 'HUMAN_REVIEW') {
      session.humanReview = {
        id: createId(),
        reason: gate.reason,
        proposedAction: proposed.action,
        evidence: [...criticResult.evidence, ...policyResult.evidence],
        status: 'PENDING',
        createdAt: now(),
      };

      store.reviews.set(session.humanReview.id, session.humanReview);
      session.stopReason = gate.reason;

      emitEvent(
        session,
        'HUMAN_REVIEW_REQUIRED',
        'HUMAN_REVIEW',
        `Human review required before ${proposed.action.type.toLowerCase()}.`,
        { reason: gate.reason, reviewId: session.humanReview.id }
      );
      return;
    }

    if (gate.decision === 'STOP') {
      session.stopReason = gate.reason;
      emitEvent(session, 'NEGOTIATION_STOPPED', 'STOPPED', gate.reason);
      return;
    }

    // 5. Execute approved action
    if (proposed.action.type === 'ACCEPT') {
      addSessionMessage(
        session,
        vendor.id,
        'AGENT',
        proposed.action.rationale,
        round,
        'ACCEPT'
      );
      emitEvent(
        session,
        'DEAL_ACCEPTED',
        'EXECUTION',
        `${vendor.name} offer accepted provisionally; comparing remaining approved vendors.`,
        { vendorId: vendor.id, offerId: offer.id }
      );
      break;
    }

    if (proposed.action.type === 'SEND_COUNTER') {
      lastSentCounter = {
        message: proposed.action.message,
        proposedTerms: proposed.action.proposedTerms,
      };
      addSessionMessage(
        session,
        vendor.id,
        'AGENT',
        sendNegotiationMessage(vendor, proposed.action.message),
        round,
        'COUNTEROFFER'
      );
      emitEvent(
        session,
        'COUNTEROFFER_SENT',
        'EXECUTION',
        `Counteroffer sent to ${vendor.name}.`,
        {
          vendorId: vendor.id,
          round,
          proposedTerms: proposed.action.proposedTerms,
        }
      );
    }
  }
}

async function runVendor(
  session: NegotiationSession,
  vendor: Vendor,
  adapters: ModelAdapters
): Promise<void> {
  if (session.currentState === 'STOPPED' || session.currentState === 'HUMAN_REVIEW') {
    return;
  }

  const rfqStartTime = Date.now();
  const rfq = sendRFQ(vendor, session.originalRequest);

  const rfqToolName =
    vendor.vendorType === 'http_api'
      ? 'vendor.http_api.send_rfq'
      : vendor.vendorType === 'ai_agent'
      ? 'vendor.ai_sales_agent.send_rfq'
      : 'vendor.send_rfq';

  recordTool(session, {
    toolName: rfqToolName,
    durationMs: Date.now() - rfqStartTime,
    success: true,
    retryCount: 0,
    input: { vendorId: vendor.id, vendorType: vendor.vendorType ?? 'ai_agent' },
  });

  emitEvent(session, 'RFQ_SENT', 'RFQ_SENT', `RFQ sent to ${vendor.name}.`, {
    vendorId: vendor.id,
    rfq,
  });

  addSessionMessage(session, vendor.id, 'AGENT', rfq, 1, 'RFQ');

  emitEvent(
    session,
    'VENDOR_RESPONSE_RECEIVED',
    'WAITING_FOR_VENDOR',
    `Waiting for ${vendor.name}'s response.`,
    { vendorId: vendor.id }
  );

  await negotiateVendor(session, vendor, adapters);
}

async function runVendorRange(
  session: NegotiationSession,
  vendors: Vendor[],
  startIndex: number,
  adapters: ModelAdapters
): Promise<void> {
  for (const vendor of vendors.slice(startIndex)) {
    if (
      session.currentState === 'HUMAN_REVIEW' ||
      session.currentState === 'STOPPED'
    ) {
      break;
    }
    await runVendor(session, vendor, adapters);
  }
}

/**
 * Evaluates all accumulated offers and finalizes the procurement outcome.
 */
function finalizeSession(session: NegotiationSession): void {
  if (
    session.currentState === 'HUMAN_REVIEW' ||
    session.currentState === 'STOPPED' ||
    session.currentState === 'ACCEPTED'
  ) {
    return;
  }

  session.currentBestOffer = findBestOffer(session.offers);

  if (
    session.currentBestOffer &&
    validateOffer(session.currentBestOffer, session.originalRequest).decision === 'PASS'
  ) {
    const selectedVendor = session.vendors.find(
      (v) => v.id === session.currentBestOffer?.vendorId
    );
    const vendorName = selectedVendor?.name ?? 'selected vendor';

    session.stopReason =
      'Compliant best offer selected after comparing all approved vendors.';
    emitEvent(
      session,
      'DEAL_ACCEPTED',
      'ACCEPTED',
      `Procurement complete with ${vendorName}.`,
      {
        offerId: session.currentBestOffer.id,
        vendorId: session.currentBestOffer.vendorId,
      }
    );
  } else {
    session.stopReason =
      shouldStop(session, session.currentBestOffer ?? undefined) ??
      'No compliant offer was available within policy.';
    emitEvent(session, 'NEGOTIATION_STOPPED', 'STOPPED', session.stopReason);
  }
}

/**
 * Top-level session orchestrator entry point.
 */
export async function runSession(
  sessionId: string,
  adapters: ModelAdapters = defaultAdapters
): Promise<void> {
  const session = store.sessions.get(sessionId);
  if (!session) return;

  try {
    emitEvent(
      session,
      'REQUIREMENT_EXTRACTED',
      'INTAKE',
      'Structured purchase requirement extracted from natural language.',
      { request: session.originalRequest }
    );

    // Knowledge & policy retrieval
    const retrieval = await retrieveKnowledge(
      'business hardware advance warranty delivery',
      { category: 'Business hardware' }
    );

    if (session.currentState === 'STOPPED') return;

    session.retrievedEvidence = retrieval.items;
    session.retrievalMode = retrieval.mode;

    emitEvent(
      session,
      'POLICY_RETRIEVED',
      'POLICY_CHECK',
      'Procurement policy and historical vendor evidence retrieved.',
      {
        evidence: retrieval.items,
        retrievalMode: session.retrievalMode,
      }
    );

    // Vendor selection
    const vendors = searchVendors(session.originalRequest, session.requestId);
    session.vendors = vendors;

    emitEvent(
      session,
      'VENDORS_SELECTED',
      'VENDOR_SELECTION',
      `${vendors.length} approved vendors selected for this RFQ.`,
      {
        vendors: vendors.map((v) => ({
          id: v.id,
          name: v.name,
          reliabilityScore: v.reliabilityScore,
        })),
      }
    );

    await runVendorRange(session, vendors, 0, adapters);
    finalizeSession(session);
  } catch (error) {
    if (session.currentState !== 'STOPPED') {
      session.stopReason =
        error instanceof Error ? error.message : 'Unexpected agent failure.';
      emitEvent(
        session,
        'AGENT_FAILED',
        'FAILED',
        'Agent stopped safely after an unexpected failure.',
        { error: 'Unexpected agent failure.' }
      );
    }
  }
}

/**
 * Resumes an in-flight session after a human operator approves or modifies a held action.
 */
export async function resumeSession(
  sessionId: string,
  adapters: ModelAdapters = defaultAdapters
): Promise<NegotiationSession | undefined> {
  const session = store.sessions.get(sessionId);
  if (
    !session ||
    !session.humanReview ||
    session.humanReview.status !== 'APPROVED' ||
    !session.pendingAction
  ) {
    return session;
  }

  const action = session.pendingAction;
  const offer = session.offers.find(
    (item) =>
      item.id ===
      ('offerId' in action ? action.offerId : session.offers.at(-1)?.id)
  );

  if (!offer) return session;

  // Revalidate through Critic
  let critic;
  try {
    critic = await adapters.critic.critique(session, offer, action);
    recordModelRuns(session, [critic.run], session.currentRound);
  } catch {
    session.humanReview.status = 'PENDING';
    session.humanReview.resolvedAt = undefined;
    session.currentState = 'HUMAN_REVIEW';
    session.stopReason =
      'Independent critic remains unavailable; approval was not executed.';

    emitEvent(
      session,
      'HUMAN_REVIEW_REQUIRED',
      'HUMAN_REVIEW',
      session.stopReason,
      { reviewId: session.humanReview.id }
    );
    return session;
  }

  const policy = validateAction(action, session.originalRequest, offer);
  session.criticResult = critic.result;
  session.policyResult = policy;

  const gate = evaluateAction(
    action,
    critic.result,
    policy,
    Math.max(0, session.currentRound - 1),
    config.maxRounds,
    0
  );

  if (gate.decision === 'BLOCK' || gate.decision === 'STOP') {
    session.humanReview.status = 'STOPPED';
    session.humanReview.resolvedAt = now();
    session.stopReason = gate.reason;
    session.currentState = 'STOPPED';

    emitEvent(
      session,
      'ACTION_BLOCKED',
      'STOPPED',
      `Approval could not override deterministic policy: ${gate.reason}`,
      { reason: gate.reason }
    );
    return session;
  }

  if (gate.decision === 'HUMAN_REVIEW') {
    session.humanReview.status = 'PENDING';
    session.humanReview.resolvedAt = undefined;
    session.currentState = 'HUMAN_REVIEW';
    session.stopReason = gate.reason;

    emitEvent(
      session,
      'HUMAN_REVIEW_REQUIRED',
      'HUMAN_REVIEW',
      `Revalidation still requires human review: ${gate.reason}`,
      { reason: gate.reason, reviewId: session.humanReview.id }
    );
    return session;
  }

  session.humanReview = null;
  session.pendingAction = null;
  session.stopReason = null;

  if (action.type === 'ACCEPT') {
    session.currentState = 'ACCEPTED';
    session.stopReason = 'Human approval revalidated and accepted the held action.';
    emitEvent(
      session,
      'HUMAN_APPROVED',
      'ACCEPTED',
      'Human-approved action passed critic and policy revalidation.',
      { offerId: offer.id }
    );
    return session;
  }

  if (action.type === 'SEND_COUNTER') {
    const vendorIndex = session.vendors.findIndex(
      (item) => item.id === action.vendorId
    );
    const vendor = session.vendors[vendorIndex];

    if (vendor) {
      addSessionMessage(
        session,
        vendor.id,
        'AGENT',
        sendNegotiationMessage(vendor, action.message),
        session.currentRound,
        'COUNTEROFFER'
      );

      emitEvent(
        session,
        'COUNTEROFFER_SENT',
        'EXECUTION',
        `Approved counteroffer sent to ${vendor.name}.`,
        { vendorId: vendor.id, proposedTerms: action.proposedTerms }
      );

      await negotiateVendor(session, vendor, adapters);
      await runVendorRange(session, session.vendors, vendorIndex + 1, adapters);
      finalizeSession(session);
    }
  }

  return session;
}
