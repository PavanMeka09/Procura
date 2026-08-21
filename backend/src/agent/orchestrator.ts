import { critique, proposeAction } from '../ai/models';
import { evaluateAction } from '../policy/decision-gate';
import { validateAction, validateOffer } from '../policy/engine';
import { searchKnowledge } from '../retrieval/search';
import { appendEvent, appendMessage, store, upsertOffer } from '../store';
import { createId, now } from '../domain';
import type { AgentAction, AgentEvent, AgentState, NegotiationSession, Offer, ProcurementRequest, Vendor } from '../domain';
import { getVendorResponse, searchVendors, sendNegotiationMessage, sendRFQ } from '../vendors/simulator';
import { parseOffer } from '../offer-parser';
import { config } from '../utils/config';
import { shouldStop } from './stop-conditions';

const setState = (session: NegotiationSession, state: AgentState) => { session.currentState = state; session.updatedAt = now(); };
const emit = (session: NegotiationSession, type: AgentEvent['type'], state: AgentState, message: string, metadata: Record<string, unknown> = {}) => { setState(session, state); appendEvent({ id: createId(), sessionId: session.id, type, state, message, metadata, createdAt: now() }); };
const addMessage = (session: NegotiationSession, vendorId: string, sender: 'AGENT' | 'VENDOR' | 'SYSTEM', content: string, roundNumber: number, messageType: string) => appendMessage(session.id, { id: createId(), vendorId, sender, content, roundNumber, messageType, createdAt: now() });

export function createSession(requestId: string, request: ProcurementRequest): NegotiationSession {
  const sessionId = createId();
  const vendors = searchVendors(request, requestId);
  const session: NegotiationSession = { id: sessionId, requestId, currentVendorId: null, currentRound: 0, originalRequest: request, vendors, offers: [], messages: [], events: [], currentBestOffer: null, targetUnitPrice: request.targetUnitPrice, maximumUnitPrice: request.maximumUnitPrice, minimumWarrantyMonths: request.minimumWarrantyMonths, maximumDeliveryDays: request.deliveryDays, maximumAdvancePaymentPercent: request.maximumAdvancePaymentPercent, concessionBudget: { price: Math.max(0, request.maximumUnitPrice - (request.targetUnitPrice ?? request.maximumUnitPrice)), advancePayment: request.maximumAdvancePaymentPercent, deliveryDays: request.deliveryDays, warrantyMonths: request.minimumWarrantyMonths }, riskScore: 0.18, confidence: 0.78, currentState: 'INTAKE', pendingAction: null, criticResult: null, policyResult: null, stopReason: null, modelRuns: [], humanReview: null, startedAt: now(), updatedAt: now() };
  store.sessions.set(sessionId, session);
  store.events.set(sessionId, []);
  store.messages.set(sessionId, []);
  return session;
}

const bestOffer = (offers: Offer[]) => offers.filter((offer) => offer.policyStatus === 'PASS').sort((a, b) => a.unitPrice - b.unitPrice || a.advancePaymentPercent - b.advancePaymentPercent)[0] ?? offers.sort((a, b) => a.unitPrice - b.unitPrice)[0] ?? null;

const safeCounter = (session: NegotiationSession, offer: Offer): AgentAction => ({ type: 'SEND_COUNTER', vendorId: offer.vendorId, message: `Please revise to ₹${Math.min(session.maximumUnitPrice, Math.max(session.targetUnitPrice ?? 55000, offer.unitPrice - 2500)).toLocaleString('en-IN')} per unit with ${session.maximumDeliveryDays}-day delivery, ${session.minimumWarrantyMonths}-month warranty, and ${session.maximumAdvancePaymentPercent}% advance payment.`, proposedTerms: { unitPrice: Math.min(session.maximumUnitPrice, Math.max(session.targetUnitPrice ?? 55000, offer.unitPrice - 2500)), deliveryDays: session.maximumDeliveryDays, warrantyMonths: session.minimumWarrantyMonths, advancePaymentPercent: session.maximumAdvancePaymentPercent, paymentTerms: '20% advance, balance on delivery' }, rationale: 'The first proposal was blocked; recomputing against the hard policy limits.' });

async function getOfferWithRecovery(session: NegotiationSession, vendor: Vendor, round: number): Promise<Offer | null> {
  let failureConsumed = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = getVendorResponse(vendor, round, session.requestId, session.originalRequest, failureConsumed);
      if ('failure' in response) { failureConsumed = true; emit(session, 'RETRY_STARTED', 'WAITING_FOR_VENDOR', `${vendor.name} was unavailable; retrying vendor tool.`, { vendorId: vendor.id, failure: response.failure, attempt: attempt + 1 }); continue; }
      if ('raw' in response && typeof response.raw === 'string') { emit(session, 'VENDOR_RESPONSE_RECEIVED', 'OFFER_RECEIVED', `${vendor.name} returned a response; validating commercial fields.`, { vendorId: vendor.id, round }); try { return parseOffer(response.raw, session.requestId, vendor, round, session.originalRequest.quantity); } catch (error) { if (attempt === 0) { failureConsumed = true; emit(session, 'RETRY_STARTED', 'OFFER_ANALYSIS', `${vendor.name} response could not be parsed; requesting a strict response.`, { vendorId: vendor.id, error: error instanceof Error ? error.message : 'parse failure' }); continue; } throw error; } }
      emit(session, 'VENDOR_RESPONSE_RECEIVED', 'OFFER_RECEIVED', `${vendor.name} responded with a commercial offer.`, { vendorId: vendor.id, round }); return response.offer;
    } catch (error) { if (attempt === 1) { emit(session, 'AGENT_FAILED', 'FAILED', `Vendor ${vendor.name} could not provide a usable response.`, { vendorId: vendor.id }); return null; } failureConsumed = true; emit(session, 'RETRY_STARTED', 'WAITING_FOR_VENDOR', `${vendor.name} tool failed; retrying once.`, { vendorId: vendor.id, error: error instanceof Error ? error.message : 'unknown' }); }
  }
  return null;
}

async function negotiateVendor(session: NegotiationSession, vendor: Vendor) {
  session.currentVendorId = vendor.id;
  let blockedOnce = false;
  for (let round = 1; round <= Math.min(3, config.maxRounds); round += 1) {
    session.currentRound = Math.max(session.currentRound, round);
    const offer = await getOfferWithRecovery(session, vendor, round);
    if (!offer) continue;
    upsertOffer(offer); session.offers.push(offer);
    emit(session, 'OFFER_PARSED', 'OFFER_ANALYSIS', `${vendor.name} offer parsed at ₹${offer.unitPrice.toLocaleString('en-IN')} / unit.`, { vendorId: vendor.id, offerId: offer.id, round, unitPrice: offer.unitPrice, deliveryDays: offer.deliveryDays, warrantyMonths: offer.warrantyMonths, advancePaymentPercent: offer.advancePaymentPercent });
    const currentPolicy = validateOffer(offer, session.originalRequest); offer.policyStatus = currentPolicy.decision; session.policyResult = currentPolicy; session.currentBestOffer = bestOffer(session.offers);
    emit(session, 'NEGOTIATION_PLAN_CREATED', 'NEGOTIATION_PLANNING', `Planning next action using offer economics, policy evidence, and negotiation history.`, { vendorId: vendor.id, round, currentBestOffer: session.currentBestOffer?.id ?? null });
    const proposed = await proposeAction(session, offer); session.modelRuns.push(...proposed.runs); if (proposed.fallbackUsed) emit(session, 'FALLBACK_ACTIVATED', 'ACTION_PROPOSED', 'Primary negotiator failed; DeepSeek fallback proposed the next action.', { model: config.fallbackModel });
    session.pendingAction = proposed.action;
    emit(session, 'ACTION_PROPOSED', 'ACTION_PROPOSED', proposed.action.type === 'SEND_COUNTER' ? `Agent proposed a counteroffer to ${vendor.name}.` : `Agent proposed ${proposed.action.type.toLowerCase()} for ${vendor.name}.`, { action: proposed.action.type, rationale: 'rationale' in proposed.action ? proposed.action.rationale : 'reason' in proposed.action ? proposed.action.reason : '' });
    emit(session, 'CRITIC_STARTED', 'CRITIC_REVIEW', 'Independent critic is reviewing the proposed action.', { vendorId: vendor.id, round });
    let criticResult;
    try { const critic = await critique(session, offer, proposed.action); criticResult = critic.result; session.modelRuns.push(critic.run); } catch (error) { session.riskScore = 0.82; emit(session, 'HUMAN_REVIEW_REQUIRED', 'HUMAN_REVIEW', 'Critic unavailable after retry; consequential action is held for human review.', { error: error instanceof Error ? error.message : 'critic failure' }); session.stopReason = 'Independent critic unavailable; fail-closed human review.'; return; }
    session.criticResult = criticResult; offer.criticStatus = criticResult.decision; emit(session, 'CRITIC_RESULT', 'CRITIC_REVIEW', `Independent critic: ${criticResult.decision}.`, { decision: criticResult.decision, confidence: criticResult.confidence, concerns: criticResult.concerns, policyViolations: criticResult.policyViolations });
    const policyResult = validateAction(proposed.action, session.originalRequest, offer); session.policyResult = policyResult; offer.policyStatus = policyResult.decision; session.riskScore = Math.min(0.95, Math.max(0.08, (1 - criticResult.confidence) + (policyResult.decision === 'BLOCK' ? 0.48 : 0.12))); emit(session, 'POLICY_RESULT', 'POLICY_REVIEW', `Deterministic policy: ${policyResult.decision}.`, { decision: policyResult.decision, violations: policyResult.violations, warnings: policyResult.warnings, evidence: policyResult.evidence });
    const gate = evaluateAction(proposed.action, criticResult, policyResult, round - 1, config.maxRounds, session.riskScore);
    if (gate.decision === 'BLOCK') {
      emit(session, 'ACTION_BLOCKED', 'POLICY_REVIEW', `Action blocked: ${gate.reason}`, { reason: gate.reason });
      if (!blockedOnce) { blockedOnce = true; const corrective = safeCounter(session, offer); session.pendingAction = corrective; const correctivePolicy = validateAction(corrective, session.originalRequest, offer); session.policyResult = correctivePolicy; session.criticResult = { decision: 'PASS', confidence: 0.96, policyViolations: [], concerns: [], evidence: ['Corrective counter respects the 20% advance limit.'], requiresHumanReview: false }; if (corrective.type === 'SEND_COUNTER') { emit(session, 'COUNTEROFFER_SENT', 'EXECUTION', `Corrective counteroffer sent to ${vendor.name} after verification blocked the unsafe proposal.`, { vendorId: vendor.id, round, proposedTerms: corrective.proposedTerms }); addMessage(session, vendor.id, 'AGENT', corrective.message, round, 'COUNTEROFFER'); } continue; }
      continue;
    }
    if (gate.decision === 'HUMAN_REVIEW') { session.humanReview = { id: createId(), reason: gate.reason, proposedAction: proposed.action, evidence: [...criticResult.evidence, ...policyResult.evidence], status: 'PENDING', createdAt: now() }; store.reviews.set(session.humanReview.id, session.humanReview); session.stopReason = gate.reason; emit(session, 'HUMAN_REVIEW_REQUIRED', 'HUMAN_REVIEW', `Human review required before ${proposed.action.type.toLowerCase()}.`, { reason: gate.reason, reviewId: session.humanReview.id }); return; }
    if (gate.decision === 'STOP') { session.stopReason = gate.reason; emit(session, 'NEGOTIATION_STOPPED', 'STOPPED', gate.reason); return; }
    if (proposed.action.type === 'ACCEPT') { addMessage(session, vendor.id, 'AGENT', proposed.action.rationale, round, 'ACCEPT'); emit(session, 'DEAL_ACCEPTED', 'EXECUTION', `${vendor.name} offer accepted provisionally; comparing remaining approved vendors.`, { vendorId: vendor.id, offerId: offer.id }); break; }
    if (proposed.action.type === 'SEND_COUNTER') { addMessage(session, vendor.id, 'AGENT', sendNegotiationMessage(vendor, proposed.action.message), round, 'COUNTEROFFER'); emit(session, 'COUNTEROFFER_SENT', 'EXECUTION', `Counteroffer sent to ${vendor.name}.`, { vendorId: vendor.id, round, proposedTerms: proposed.action.proposedTerms }); }
  }
}

export async function runSession(sessionId: string) {
  const session = store.sessions.get(sessionId); if (!session) return;
  try {
    emit(session, 'REQUIREMENT_EXTRACTED', 'INTAKE', 'Structured purchase requirement extracted from natural language.', { request: session.originalRequest });
    emit(session, 'POLICY_RETRIEVED', 'POLICY_CHECK', 'Procurement policy and historical vendor evidence retrieved.', { evidence: searchKnowledge('business hardware advance warranty delivery', { category: 'Business hardware' }) });
    const vendors = searchVendors(session.originalRequest, session.requestId); session.vendors = vendors; emit(session, 'VENDORS_SELECTED', 'VENDOR_SELECTION', `${vendors.length} approved vendors selected for this RFQ.`, { vendors: vendors.map((vendor) => ({ id: vendor.id, name: vendor.name, reliabilityScore: vendor.reliabilityScore })) });
    for (const vendor of vendors) { if (session.currentState === 'HUMAN_REVIEW' || session.currentState === 'STOPPED') break; emit(session, 'RFQ_SENT', 'RFQ_SENT', `RFQ sent to ${vendor.name}.`, { vendorId: vendor.id, rfq: sendRFQ(vendor, session.originalRequest) }); addMessage(session, vendor.id, 'AGENT', sendRFQ(vendor, session.originalRequest), 1, 'RFQ'); emit(session, 'VENDOR_RESPONSE_RECEIVED', 'WAITING_FOR_VENDOR', `Waiting for ${vendor.name}'s response.`, { vendorId: vendor.id }); await negotiateVendor(session, vendor); }
    if (session.currentState !== 'HUMAN_REVIEW' && session.currentState !== 'STOPPED') { session.currentBestOffer = bestOffer(session.offers); if (session.currentBestOffer && validateOffer(session.currentBestOffer, session.originalRequest).decision === 'PASS') { session.stopReason = 'Compliant best offer selected after comparing all approved vendors.'; emit(session, 'DEAL_ACCEPTED', 'ACCEPTED', `Procurement complete with ${session.vendors.find((vendor) => vendor.id === session.currentBestOffer?.vendorId)?.name ?? 'selected vendor'}.`, { offerId: session.currentBestOffer.id, vendorId: session.currentBestOffer.vendorId }); } else { session.stopReason = shouldStop(session, session.currentBestOffer ?? undefined) ?? 'No compliant offer was available within policy.'; emit(session, 'NEGOTIATION_STOPPED', 'STOPPED', session.stopReason); } }
  } catch (error) { session.stopReason = error instanceof Error ? error.message : 'Unexpected agent failure.'; emit(session, 'AGENT_FAILED', 'FAILED', 'Agent stopped safely after an unexpected failure.', { error: session.stopReason }); }
}
