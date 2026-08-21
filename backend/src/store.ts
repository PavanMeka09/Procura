import type { AgentEvent, EvaluationRun, HumanReview, NegotiationMessage, NegotiationSession, Offer, ProcurementRequest } from './domain';
import { persistApproval, persistEvaluation, persistEvent, persistMessage, persistOffer, persistRequest, persistSession } from './db/repository';

export type Store = { requests: Map<string, ProcurementRequest & { id: string; rawRequest: string; status: string; createdAt: string }>; sessions: Map<string, NegotiationSession>; offers: Map<string, Offer>; events: Map<string, AgentEvent[]>; messages: Map<string, NegotiationMessage[]>; reviews: Map<string, HumanReview>; evaluationRuns: Map<string, EvaluationRun> };
export const store: Store = { requests: new Map(), sessions: new Map(), offers: new Map(), events: new Map(), messages: new Map(), reviews: new Map(), evaluationRuns: new Map() };
type Listener = (event: AgentEvent) => void;
const listeners = new Map<string, Set<Listener>>();
const persist = (work: Promise<unknown>) => { void work.catch(() => undefined); };
export const subscribe = (sessionId: string, listener: Listener) => { const set = listeners.get(sessionId) ?? new Set<Listener>(); set.add(listener); listeners.set(sessionId, set); return () => set.delete(listener); };
export const appendEvent = (event: AgentEvent) => { const items = store.events.get(event.sessionId) ?? []; items.push(event); store.events.set(event.sessionId, items); const session = store.sessions.get(event.sessionId); if (session) { session.events = items; session.updatedAt = event.createdAt; persist(persistSession(session)); const request = store.requests.get(session.requestId); if (request) { request.status = session.currentState; persist(persistRequest(request)); } } persist(persistEvent(event)); listeners.get(event.sessionId)?.forEach((listener) => listener(event)); };
export const appendMessage = (sessionId: string, message: NegotiationMessage) => { const items = store.messages.get(sessionId) ?? []; items.push(message); store.messages.set(sessionId, items); const session = store.sessions.get(sessionId); if (session) { session.messages = items; persist(persistSession(session)); } persist(persistMessage(sessionId, message)); };
export const upsertOffer = (offer: Offer) => { store.offers.set(offer.id, offer); persist(persistOffer(offer)); const session = [...store.sessions.values()].find((item) => item.requestId === offer.requestId); if (session) { session.offers = [...store.offers.values()].filter((item) => item.requestId === offer.requestId); persist(persistSession(session)); } };
export const persistStoredApproval = (sessionId: string, review: HumanReview) => persist(persistApproval(sessionId, review));
export const persistStoredEvaluation = (run: EvaluationRun) => persist(persistEvaluation(run));
