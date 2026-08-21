import { asc, eq, or } from 'drizzle-orm';
import db from './index';
import {
  agentEvents,
  evaluationCases,
  evaluationRuns,
  humanApprovals,
  knowledgeChunks,
  knowledgeDocuments,
  modelRuns,
  negotiationMessages,
  negotiationSessions,
  policyRules,
  procurementRequests,
  toolExecutions,
  vendorOffers,
  vendors,
} from './schema';
import { findBestOffer } from '../domain';
import type {
  AgentAction,
  AgentEvent,
  EvaluationRun,
  HumanReview,
  ModelRun,
  NegotiationMessage,
  NegotiationSession,
  Offer,
  ToolExecution,
} from '../domain';
import { seededVendors } from '../vendors/simulator';

function toNumericString(value: number | null | undefined): string | null {
  return value == null ? null : String(value);
}

function toJsonField(value: unknown): unknown {
  return value == null ? null : value;
}

export function isDatabaseEnabled(): boolean {
  return db !== null;
}

export interface PersistRequestRecord {
  id: string;
  rawRequest: string;
  item: string;
  quantity: number;
  targetUnitPrice: number | null;
  maximumUnitPrice: number;
  deliveryDays: number;
  minimumWarrantyMonths: number;
  maximumAdvancePaymentPercent: number;
  status: string;
  createdAt: string;
}

export async function persistRequest(request: PersistRequestRecord): Promise<void> {
  if (!db) return;

  await db
    .insert(procurementRequests)
    .values({
      id: request.id,
      rawRequest: request.rawRequest,
      item: request.item,
      quantity: request.quantity,
      targetUnitPrice: toNumericString(request.targetUnitPrice),
      maximumUnitPrice: toNumericString(request.maximumUnitPrice)!,
      deliveryDays: request.deliveryDays,
      minimumWarrantyMonths: request.minimumWarrantyMonths,
      maximumAdvancePaymentPercent: request.maximumAdvancePaymentPercent,
      status: request.status,
      createdAt: new Date(request.createdAt),
      updatedAt: new Date(request.createdAt),
    })
    .onConflictDoUpdate({
      target: procurementRequests.id,
      set: {
        rawRequest: request.rawRequest,
        item: request.item,
        quantity: request.quantity,
        targetUnitPrice: toNumericString(request.targetUnitPrice),
        maximumUnitPrice: toNumericString(request.maximumUnitPrice)!,
        deliveryDays: request.deliveryDays,
        minimumWarrantyMonths: request.minimumWarrantyMonths,
        maximumAdvancePaymentPercent: request.maximumAdvancePaymentPercent,
        status: request.status,
        updatedAt: new Date(),
      },
    });
}

export async function findRequest(requestId: string) {
  if (!db) return null;

  const row = (
    await db
      .select()
      .from(procurementRequests)
      .where(eq(procurementRequests.id, requestId))
      .limit(1)
  )[0];

  if (!row) return null;

  return {
    id: row.id,
    rawRequest: row.rawRequest,
    item: row.item,
    quantity: row.quantity,
    targetUnitPrice:
      row.targetUnitPrice == null ? null : Number(row.targetUnitPrice),
    maximumUnitPrice: Number(row.maximumUnitPrice),
    deliveryDays: row.deliveryDays,
    minimumWarrantyMonths: row.minimumWarrantyMonths,
    maximumAdvancePaymentPercent: row.maximumAdvancePaymentPercent,
    negotiableTerms: ['unit price', 'delivery schedule', 'payment terms'],
    nonNegotiableTerms: [
      'maximum unit price',
      'minimum warranty',
      'maximum advance payment',
    ],
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function persistVendor(
  vendor: NegotiationSession['vendors'][number]
): Promise<void> {
  if (!db) return;

  await db
    .insert(vendors)
    .values({
      id: vendor.id,
      slug: vendor.slug,
      name: vendor.name,
      category: vendor.category,
      approved: vendor.approved,
      reliabilityScore: vendor.reliabilityScore,
      contact: vendor.contact,
      metadata: toJsonField({ behavior: vendor.behavior }),
    })
    .onConflictDoUpdate({
      target: vendors.id,
      set: {
        slug: vendor.slug,
        name: vendor.name,
        category: vendor.category,
        approved: vendor.approved,
        reliabilityScore: vendor.reliabilityScore,
        contact: vendor.contact,
        metadata: toJsonField({ behavior: vendor.behavior }),
      },
    });
}

export async function persistSession(session: NegotiationSession): Promise<void> {
  if (!db) return;

  await db
    .insert(negotiationSessions)
    .values({
      id: session.id,
      requestId: session.requestId,
      status: session.currentState,
      currentVendorId: session.currentVendorId,
      currentRound: session.currentRound,
      currentBestOfferId: session.currentBestOffer?.id ?? null,
      pendingAction: toJsonField(session.pendingAction),
      riskScore: session.riskScore,
      confidence: session.confidence,
      stopReason: session.stopReason,
      createdAt: new Date(session.startedAt),
      updatedAt: new Date(session.updatedAt),
    })
    .onConflictDoUpdate({
      target: negotiationSessions.id,
      set: {
        status: session.currentState,
        currentVendorId: session.currentVendorId,
        currentRound: session.currentRound,
        currentBestOfferId: session.currentBestOffer?.id ?? null,
        pendingAction: toJsonField(session.pendingAction),
        riskScore: session.riskScore,
        confidence: session.confidence,
        stopReason: session.stopReason,
        updatedAt: new Date(session.updatedAt),
      },
    });
}

export async function persistOffer(offer: Offer): Promise<void> {
  if (!db) return;

  const validUntilDate = offer.validityDays
    ? new Date(Date.now() + offer.validityDays * 86400000)
    : null;

  await db
    .insert(vendorOffers)
    .values({
      id: offer.id,
      requestId: offer.requestId,
      vendorId: offer.vendorId,
      roundNumber: offer.roundNumber,
      rawResponse: offer.rawResponse,
      unitPrice: toNumericString(offer.unitPrice)!,
      totalPrice: toNumericString(offer.totalPrice)!,
      deliveryDays: offer.deliveryDays,
      warrantyMonths: offer.warrantyMonths,
      advancePaymentPercent: offer.advancePaymentPercent,
      paymentTerms: offer.paymentTerms,
      validUntil: validUntilDate,
      criticStatus: offer.criticStatus ?? null,
      policyStatus: offer.policyStatus ?? null,
    })
    .onConflictDoUpdate({
      target: vendorOffers.id,
      set: {
        criticStatus: offer.criticStatus ?? null,
        policyStatus: offer.policyStatus ?? null,
        unitPrice: toNumericString(offer.unitPrice)!,
        totalPrice: toNumericString(offer.totalPrice)!,
      },
    });
}

export async function persistMessage(
  sessionId: string,
  message: NegotiationMessage
): Promise<void> {
  if (!db) return;

  await db
    .insert(negotiationMessages)
    .values({
      id: message.id,
      sessionId,
      vendorId: message.vendorId,
      sender: message.sender,
      content: message.content,
      roundNumber: message.roundNumber,
      messageType: message.messageType,
      createdAt: new Date(message.createdAt),
    })
    .onConflictDoNothing();
}

export async function persistEvent(event: AgentEvent): Promise<void> {
  if (!db) return;

  await db
    .insert(agentEvents)
    .values({
      id: event.id,
      sessionId: event.sessionId,
      eventType: event.type,
      state: event.state,
      message: event.message,
      metadata: event.metadata,
      createdAt: new Date(event.createdAt),
    })
    .onConflictDoNothing();
}

export async function persistApproval(
  sessionId: string,
  review: HumanReview
): Promise<void> {
  if (!db) return;

  await db
    .insert(humanApprovals)
    .values({
      id: review.id,
      sessionId,
      reason: review.reason,
      proposedAction: review.proposedAction,
      evidence: review.evidence,
      status: review.status,
      createdAt: new Date(review.createdAt),
      resolvedAt: review.resolvedAt ? new Date(review.resolvedAt) : null,
    })
    .onConflictDoUpdate({
      target: humanApprovals.id,
      set: {
        status: review.status,
        resolvedAt: review.resolvedAt ? new Date(review.resolvedAt) : null,
      },
    });
}

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(val: string | null | undefined): boolean {
  return Boolean(val && uuidRegex.test(val));
}

export async function persistModelRun(run: ModelRun): Promise<void> {
  if (!db || !run.id || !run.requestId || !run.sessionId) return;
  if (!isValidUuid(run.id) || !isValidUuid(run.requestId) || !isValidUuid(run.sessionId)) return;

  try {
    await db
      .insert(modelRuns)
      .values({
        id: run.id,
        requestId: run.requestId,
        sessionId: run.sessionId,
        model: run.model,
        role: run.role,
        promptVersion: run.promptVersion ?? 'v1',
        durationMs: run.durationMs,
        retryCount: run.retryCount,
        fallback: run.fallback,
        success: run.success,
        roundNumber: run.roundNumber ?? null,
        inputTokens: run.usage?.inputTokens ?? null,
        outputTokens: run.usage?.outputTokens ?? null,
        estimatedCost: toNumericString(run.estimatedCost),
      })
      .onConflictDoNothing();
  } catch {
    // Best-effort persistence
  }
}

export async function persistToolExecution(tool: ToolExecution): Promise<void> {
  if (!db || !tool.id || !tool.requestId || !tool.sessionId) return;
  if (!isValidUuid(tool.id) || !isValidUuid(tool.requestId) || !isValidUuid(tool.sessionId)) return;

  try {
    await db
      .insert(toolExecutions)
      .values({
        id: tool.id,
        requestId: tool.requestId,
        sessionId: tool.sessionId,
        toolName: tool.toolName,
        durationMs: tool.durationMs,
        success: tool.success,
        retryCount: tool.retryCount,
        input: tool.input ?? null,
        error: tool.error ?? null,
        createdAt: tool.createdAt ? new Date(tool.createdAt) : new Date(),
      })
      .onConflictDoNothing();
  } catch {
    // Best-effort persistence
  }
}

export async function persistEvaluation(run: EvaluationRun): Promise<void> {
  if (!db) return;

  await db
    .insert(evaluationRuns)
    .values({
      id: run.id,
      total: run.total,
      passed: run.passed,
      failed: run.failed,
      metrics: run.metrics,
      results: run.results,
      createdAt: new Date(run.createdAt),
    })
    .onConflictDoNothing();
}

export async function findEvaluation(id: string): Promise<EvaluationRun | null> {
  if (!db) return null;

  const row = (
    await db
      .select()
      .from(evaluationRuns)
      .where(eq(evaluationRuns.id, id))
      .limit(1)
  )[0];

  if (!row) return null;

  return {
    id: row.id,
    total: row.total,
    passed: row.passed,
    failed: row.failed,
    metrics: row.metrics as Record<string, number>,
    results: row.results as EvaluationRun['results'],
    createdAt: row.createdAt.toISOString(),
  };
}

export async function persistPolicyRule(rule: {
  id: string;
  name: string;
  field: string;
  operator: string;
  threshold?: number;
  severity: string;
  action: string;
  description: string;
}): Promise<void> {
  if (!db) return;

  await db
    .insert(policyRules)
    .values({
      id: rule.id,
      name: rule.name,
      field: rule.field,
      operator: rule.operator,
      threshold: toNumericString(rule.threshold),
      severity: rule.severity,
      action: rule.action,
      description: rule.description,
    })
    .onConflictDoUpdate({
      target: policyRules.id,
      set: {
        name: rule.name,
        field: rule.field,
        operator: rule.operator,
        threshold: toNumericString(rule.threshold),
        severity: rule.severity,
        action: rule.action,
        description: rule.description,
      },
    });
}

export async function persistEvaluationCase(testCase: {
  id: string;
  name: string;
  input: string;
  scenarioConfig: Record<string, unknown>;
  expectedBehavior: string;
}): Promise<void> {
  if (!db) return;

  await db
    .insert(evaluationCases)
    .values({
      id: testCase.id,
      name: testCase.name,
      input: testCase.input,
      scenarioConfig: testCase.scenarioConfig,
      expectedBehavior: testCase.expectedBehavior,
    })
    .onConflictDoUpdate({
      target: evaluationCases.id,
      set: {
        name: testCase.name,
        input: testCase.input,
        scenarioConfig: testCase.scenarioConfig,
        expectedBehavior: testCase.expectedBehavior,
      },
    });
}

export async function persistKnowledgeDocument(document: {
  id: string;
  type: string;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!db) return;

  await db
    .insert(knowledgeDocuments)
    .values({
      id: document.id,
      type: document.type,
      title: document.title,
      content: document.content,
      metadata: document.metadata ?? null,
    })
    .onConflictDoUpdate({
      target: knowledgeDocuments.id,
      set: {
        type: document.type,
        title: document.title,
        content: document.content,
        metadata: document.metadata ?? null,
      },
    });
}

export async function persistKnowledgeChunk(chunk: {
  id: string;
  documentId: string;
  content: string;
  embedding?: number[] | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!db) return;

  await db
    .insert(knowledgeChunks)
    .values({
      id: chunk.id,
      documentId: chunk.documentId,
      content: chunk.content,
      embedding: chunk.embedding ?? null,
      metadata: chunk.metadata ?? null,
    })
    .onConflictDoUpdate({
      target: knowledgeChunks.id,
      set: {
        content: chunk.content,
        embedding: chunk.embedding ?? null,
        metadata: chunk.metadata ?? null,
      },
    });
}

function hydrateCriticFromEvents(events: AgentEvent[]) {
  const event = [...events].reverse().find((item) => item.type === 'CRITIC_RESULT');
  if (!event) return null;

  const metadata = event.metadata;
  return {
    decision: metadata.decision as 'PASS' | 'WARN' | 'BLOCK',
    confidence: Number(metadata.confidence ?? 0),
    policyViolations: (metadata.policyViolations ?? []) as string[],
    concerns: (metadata.concerns ?? []) as string[],
    evidence: (metadata.evidence ?? []) as string[],
    requiresHumanReview: false,
  };
}

function hydratePolicyFromEvents(events: AgentEvent[]) {
  const event = [...events].reverse().find((item) => item.type === 'POLICY_RESULT');
  if (!event) return null;

  const metadata = event.metadata;
  return {
    decision: metadata.decision as 'PASS' | 'BLOCK' | 'HUMAN_REVIEW',
    violations: (metadata.violations ?? []) as string[],
    warnings: (metadata.warnings ?? []) as string[],
    evidence: (metadata.evidence ?? []) as string[],
  };
}

/**
 * Hydrates a full NegotiationSession object from persistent SQL records.
 */
export async function hydrateSession(
  identifier: string
): Promise<NegotiationSession | null> {
  if (!db) return null;

  const sessionRow = (
    await db
      .select()
      .from(negotiationSessions)
      .where(
        or(
          eq(negotiationSessions.id, identifier),
          eq(negotiationSessions.requestId, identifier)
        )
      )
      .limit(1)
  )[0];

  if (!sessionRow) return null;

  const requestRow = (
    await db
      .select()
      .from(procurementRequests)
      .where(eq(procurementRequests.id, sessionRow.requestId))
      .limit(1)
  )[0];

  if (!requestRow) return null;

  const request = {
    item: requestRow.item,
    quantity: requestRow.quantity,
    targetUnitPrice:
      requestRow.targetUnitPrice == null
        ? null
        : Number(requestRow.targetUnitPrice),
    maximumUnitPrice: Number(requestRow.maximumUnitPrice),
    deliveryDays: requestRow.deliveryDays,
    minimumWarrantyMonths: requestRow.minimumWarrantyMonths,
    maximumAdvancePaymentPercent: requestRow.maximumAdvancePaymentPercent,
    negotiableTerms: ['unit price', 'delivery schedule', 'payment terms'],
    nonNegotiableTerms: [
      'maximum unit price',
      'minimum warranty',
      'maximum advance payment',
    ],
  };

  const vendorRows = await db
    .select()
    .from(vendors)
    .where(eq(vendors.approved, true));

  const seeded = seededVendors(sessionRow.requestId);
  const sessionVendors = vendorRows.map((row) => {
    const existing = seeded.find((v) => v.id === row.id);
    return existing
      ? {
          ...existing,
          slug: row.slug,
          name: row.name,
          category: row.category,
          approved: row.approved,
          reliabilityScore: row.reliabilityScore,
          contact: row.contact,
        }
      : {
          id: row.id,
          slug: row.slug,
          name: row.name,
          category: row.category,
          approved: row.approved,
          reliabilityScore: row.reliabilityScore,
          contact: row.contact,
          behavior: { initial: {} as Offer, rounds: [] },
        };
  });

  const offerRows = await db
    .select()
    .from(vendorOffers)
    .where(eq(vendorOffers.requestId, sessionRow.requestId));

  const offers: Offer[] = offerRows.map((row) => ({
    id: row.id,
    requestId: row.requestId,
    vendorId: row.vendorId,
    roundNumber: row.roundNumber,
    rawResponse: row.rawResponse,
    unitPrice: Number(row.unitPrice),
    totalPrice: Number(row.totalPrice),
    deliveryDays: row.deliveryDays,
    warrantyMonths: row.warrantyMonths,
    advancePaymentPercent: row.advancePaymentPercent,
    paymentTerms: row.paymentTerms,
    validityDays: row.validUntil
      ? Math.max(0, Math.ceil((row.validUntil.getTime() - Date.now()) / 86400000))
      : null,
    additionalConditions: [],
    extractionConfidence: 1,
    criticStatus: row.criticStatus as Offer['criticStatus'],
    policyStatus: row.policyStatus as Offer['policyStatus'],
  }));

  const [messageRows, eventRows, approvalRows, modelRows, toolRows] =
    await Promise.all([
      db
        .select()
        .from(negotiationMessages)
        .where(eq(negotiationMessages.sessionId, sessionRow.id))
        .orderBy(asc(negotiationMessages.createdAt)),
      db
        .select()
        .from(agentEvents)
        .where(eq(agentEvents.sessionId, sessionRow.id))
        .orderBy(asc(agentEvents.createdAt)),
      db
        .select()
        .from(humanApprovals)
        .where(eq(humanApprovals.sessionId, sessionRow.id)),
      db
        .select()
        .from(modelRuns)
        .where(eq(modelRuns.sessionId, sessionRow.id))
        .orderBy(asc(modelRuns.createdAt)),
      db
        .select()
        .from(toolExecutions)
        .where(eq(toolExecutions.sessionId, sessionRow.id))
        .orderBy(asc(toolExecutions.createdAt)),
    ]);

  const events: AgentEvent[] = eventRows.map((event) => ({
    id: event.id,
    sessionId: event.sessionId,
    type: event.eventType as AgentEvent['type'],
    state: event.state as AgentEvent['state'],
    message: event.message,
    metadata: (event.metadata ?? {}) as Record<string, unknown>,
    createdAt: event.createdAt.toISOString(),
  }));

  const approval = [...approvalRows].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  )[0];

  const bestOffer =
    offers.find((offer) => offer.id === sessionRow.currentBestOfferId) ??
    findBestOffer(offers);

  const retrievalEvent = [...events]
    .reverse()
    .find((event) => event.type === 'POLICY_RETRIEVED');

  const retrievedEvidence = Array.isArray(retrievalEvent?.metadata.evidence)
    ? (retrievalEvent.metadata.evidence as NegotiationSession['retrievedEvidence'])
    : [];

  const retrievalMode =
    retrievalEvent?.metadata.retrievalMode === 'pgvector' ? 'pgvector' : 'lexical';

  const concessionBudget = {
    price: Math.max(
      0,
      request.maximumUnitPrice -
        (request.targetUnitPrice ?? request.maximumUnitPrice)
    ),
    advancePayment: request.maximumAdvancePaymentPercent,
    deliveryDays: request.deliveryDays,
    warrantyMonths: request.minimumWarrantyMonths,
  };

  return {
    id: sessionRow.id,
    requestId: sessionRow.requestId,
    currentVendorId: sessionRow.currentVendorId,
    currentRound: sessionRow.currentRound,
    originalRequest: request,
    vendors: sessionVendors,
    offers,
    messages: messageRows.map((message) => ({
      id: message.id,
      vendorId: message.vendorId,
      sender: message.sender as NegotiationMessage['sender'],
      content: message.content,
      roundNumber: message.roundNumber,
      messageType: message.messageType,
      createdAt: message.createdAt.toISOString(),
    })),
    events,
    currentBestOffer: bestOffer,
    targetUnitPrice: request.targetUnitPrice,
    maximumUnitPrice: request.maximumUnitPrice,
    minimumWarrantyMonths: request.minimumWarrantyMonths,
    maximumDeliveryDays: request.deliveryDays,
    maximumAdvancePaymentPercent: request.maximumAdvancePaymentPercent,
    concessionBudget,
    riskScore: sessionRow.riskScore,
    confidence: sessionRow.confidence,
    currentState: sessionRow.status as NegotiationSession['currentState'],
    pendingAction: sessionRow.pendingAction as AgentAction | null,
    criticResult: hydrateCriticFromEvents(events),
    policyResult: hydratePolicyFromEvents(events),
    stopReason: sessionRow.stopReason,
    modelRuns: modelRows.map((run) => ({
      id: run.id,
      requestId: run.requestId,
      sessionId: run.sessionId,
      model: run.model,
      role: run.role as ModelRun['role'],
      promptVersion: run.promptVersion,
      durationMs: run.durationMs,
      retryCount: run.retryCount,
      fallback: run.fallback,
      success: run.success,
      roundNumber: run.roundNumber ?? undefined,
      estimatedCost:
        run.estimatedCost == null ? null : Number(run.estimatedCost),
      usage: {
        inputTokens: run.inputTokens ?? undefined,
        outputTokens: run.outputTokens ?? undefined,
      },
    })),
    toolExecutions: toolRows.map((tool) => ({
      id: tool.id,
      requestId: tool.requestId,
      sessionId: tool.sessionId,
      toolName: tool.toolName,
      durationMs: tool.durationMs,
      success: tool.success,
      retryCount: tool.retryCount,
      input: (tool.input ?? undefined) as Record<string, unknown> | undefined,
      error: tool.error ?? undefined,
      createdAt: tool.createdAt.toISOString(),
    })),
    humanReview: approval
      ? {
          id: approval.id,
          reason: approval.reason,
          proposedAction: approval.proposedAction as AgentAction,
          evidence: approval.evidence as string[],
          status: approval.status as HumanReview['status'],
          createdAt: approval.createdAt.toISOString(),
          resolvedAt: approval.resolvedAt?.toISOString(),
        }
      : null,
    retrievedEvidence,
    retrievalMode,
    startedAt: sessionRow.createdAt.toISOString(),
    updatedAt: sessionRow.updatedAt.toISOString(),
  };
}
