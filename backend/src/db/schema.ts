import { boolean, integer, jsonb, numeric, pgTable, real, text, timestamp, uuid, vector } from 'drizzle-orm/pg-core';

const id = () => uuid('id').defaultRandom().primaryKey();
const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();

export const procurementRequests = pgTable('procurement_requests', {
  id: id(), rawRequest: text('raw_request').notNull(), item: text('item').notNull(), quantity: integer('quantity').notNull(),
  targetUnitPrice: numeric('target_unit_price', { precision: 12, scale: 2 }), maximumUnitPrice: numeric('maximum_unit_price', { precision: 12, scale: 2 }).notNull(),
  deliveryDays: integer('delivery_days').notNull(), minimumWarrantyMonths: integer('minimum_warranty_months').notNull(),
  maximumAdvancePaymentPercent: integer('maximum_advance_payment_percent').notNull(), status: text('status').notNull().default('DRAFT'),
  createdAt: createdAt(), updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const vendors = pgTable('vendors', {
  id: id(), slug: text('slug').notNull().unique(), name: text('name').notNull(), category: text('category').notNull(), approved: boolean('approved').notNull().default(true),
  reliabilityScore: real('reliability_score').notNull(), contact: text('contact').notNull(), metadata: jsonb('metadata'), createdAt: createdAt(),
});

export const vendorOffers = pgTable('vendor_offers', {
  id: id(), requestId: uuid('request_id').notNull(), vendorId: uuid('vendor_id').notNull(), roundNumber: integer('round_number').notNull(), rawResponse: text('raw_response').notNull(),
  unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(), totalPrice: numeric('total_price', { precision: 14, scale: 2 }).notNull(), deliveryDays: integer('delivery_days').notNull(),
  warrantyMonths: integer('warranty_months').notNull(), advancePaymentPercent: integer('advance_payment_percent').notNull(), paymentTerms: text('payment_terms').notNull(), validUntil: timestamp('valid_until', { withTimezone: true }), criticStatus: text('critic_status'), policyStatus: text('policy_status'), createdAt: createdAt(),
});

export const negotiationSessions = pgTable('negotiation_sessions', {
  id: id(), requestId: uuid('request_id').notNull(), status: text('status').notNull(), currentVendorId: uuid('current_vendor_id'), currentRound: integer('current_round').notNull().default(0), currentBestOfferId: uuid('current_best_offer_id'), pendingAction: jsonb('pending_action'), riskScore: real('risk_score').notNull().default(0), confidence: real('confidence').notNull().default(0), stopReason: text('stop_reason'), createdAt: createdAt(), updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const negotiationMessages = pgTable('negotiation_messages', {
  id: id(), sessionId: uuid('session_id').notNull(), vendorId: uuid('vendor_id').notNull(), sender: text('sender').notNull(), content: text('content').notNull(), roundNumber: integer('round_number').notNull(), messageType: text('message_type').notNull(), createdAt: createdAt(),
});

export const agentEvents = pgTable('agent_events', {
  id: id(), sessionId: uuid('session_id').notNull(), eventType: text('event_type').notNull(), state: text('state').notNull(), message: text('message').notNull(), metadata: jsonb('metadata'), createdAt: createdAt(),
});

export const policyRules = pgTable('policy_rules', {
  id: id(), name: text('name').notNull(), field: text('field').notNull(), operator: text('operator').notNull(), threshold: numeric('threshold'), severity: text('severity').notNull(), action: text('action').notNull(), description: text('description').notNull(),
});

export const knowledgeDocuments = pgTable('knowledge_documents', {
  id: id(), type: text('type').notNull(), title: text('title').notNull(), content: text('content').notNull(), metadata: jsonb('metadata'), createdAt: createdAt(),
});

export const knowledgeChunks = pgTable('knowledge_chunks', {
  id: id(), documentId: uuid('document_id').notNull(), content: text('content').notNull(), embedding: vector('embedding', { dimensions: 768 }), metadata: jsonb('metadata'), createdAt: createdAt(),
});

export const humanApprovals = pgTable('human_approvals', {
  id: id(), sessionId: uuid('session_id').notNull(), reason: text('reason').notNull(), proposedAction: jsonb('proposed_action').notNull(), evidence: jsonb('evidence').notNull(), status: text('status').notNull().default('PENDING'), createdAt: createdAt(), resolvedAt: timestamp('resolved_at', { withTimezone: true }),
});

export const evaluationCases = pgTable('evaluation_cases', {
  id: id(), name: text('name').notNull(), input: text('input').notNull(), scenarioConfig: jsonb('scenario_config').notNull(), expectedBehavior: text('expected_behavior').notNull(),
});

export const evaluationRuns = pgTable('evaluation_runs', {
  id: id(), total: integer('total').notNull(), passed: integer('passed').notNull(), failed: integer('failed').notNull(), metrics: jsonb('metrics').notNull(), results: jsonb('results').notNull(), createdAt: createdAt(),
});

export const modelRuns = pgTable('model_runs', {
  id: id(), requestId: uuid('request_id').notNull(), sessionId: uuid('session_id').notNull(), model: text('model').notNull(), role: text('role').notNull(), promptVersion: text('prompt_version').notNull(), durationMs: integer('duration_ms').notNull(), retryCount: integer('retry_count').notNull().default(0), fallback: boolean('fallback').notNull().default(false), success: boolean('success').notNull(), roundNumber: integer('round_number'), inputTokens: integer('input_tokens'), outputTokens: integer('output_tokens'), estimatedCost: numeric('estimated_cost', { precision: 12, scale: 8 }), createdAt: createdAt(),
});

export const toolExecutions = pgTable('tool_executions', {
  id: id(), requestId: uuid('request_id').notNull(), sessionId: uuid('session_id').notNull(), toolName: text('tool_name').notNull(), durationMs: integer('duration_ms').notNull(), success: boolean('success').notNull(), retryCount: integer('retry_count').notNull().default(0), input: jsonb('input'), error: text('error'), createdAt: createdAt(),
});
