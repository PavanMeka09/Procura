import type {
  AgentEvent,
  EvaluationRun,
  HumanReview,
  NegotiationMessage,
  NegotiationSession,
  Offer,
  ProcurementRequest,
} from './domain';
import {
  findRequest,
  hydrateSession,
  persistApproval,
  persistEvaluation,
  persistEvent,
  persistMessage,
  persistOffer,
  persistRequest,
  persistSession,
} from './db/repository';

export interface StoredRequestRecord extends ProcurementRequest {
  id: string;
  rawRequest: string;
  status: string;
  createdAt: string;
}

export interface Store {
  requests: Map<string, StoredRequestRecord>;
  sessions: Map<string, NegotiationSession>;
  offers: Map<string, Offer>;
  events: Map<string, AgentEvent[]>;
  messages: Map<string, NegotiationMessage[]>;
  reviews: Map<string, HumanReview>;
  evaluationRuns: Map<string, EvaluationRun>;
}

export const store: Store = {
  requests: new Map(),
  sessions: new Map(),
  offers: new Map(),
  events: new Map(),
  messages: new Map(),
  reviews: new Map(),
  evaluationRuns: new Map(),
};

const startLocks = new Map<
  string,
  Promise<{ session: NegotiationSession; created: boolean }>
>();

/**
 * Caches an in-memory session and its event/message stores.
 */
export function cacheSession(session: NegotiationSession): NegotiationSession {
  store.sessions.set(session.id, session);
  store.events.set(session.id, session.events);
  store.messages.set(session.id, session.messages);
  return session;
}

/**
 * Retrieves a session from memory or hydrates it from the persistent database.
 */
export async function getSession(identifier: string): Promise<NegotiationSession | null> {
  const localSession =
    store.sessions.get(identifier) ??
    [...store.sessions.values()].find((s) => s.requestId === identifier);

  if (localSession) {
    return localSession;
   }

  const hydrated = await hydrateSession(identifier);
  return hydrated ? cacheSession(hydrated) : null;
}

/**
 * Retrieves a procurement request record from memory or database.
 */
export async function getRequest(requestId: string): Promise<StoredRequestRecord | null> {
  return store.requests.get(requestId) ?? ((await findRequest(requestId)) as StoredRequestRecord | null);
}

/**
 * Returns an existing in-flight session start promise if one is already running.
 */
export function getPendingSessionStart(
  requestId: string
): Promise<{ session: NegotiationSession; created: boolean }> | undefined {
  return startLocks.get(requestId);
}

/**
 * Executes session initialization within an in-memory mutex to prevent duplicate spin-ups.
 */
export async function runWithSessionStartLock(
  requestId: string,
  startFn: () => Promise<{ session: NegotiationSession; created: boolean }>
): Promise<{ session: NegotiationSession; created: boolean }> {
  const existingLock = startLocks.get(requestId);
  if (existingLock) {
    return existingLock;
  }

  const promise = startFn();
  startLocks.set(requestId, promise);
  try {
    return await promise;
  } finally {
    startLocks.delete(requestId);
  }
}

type Listener = (event: AgentEvent) => void;
const listeners = new Map<string, Set<Listener>>();

/**
 * Fire-and-forget helper for asynchronous database writes without throwing into main loop.
 */
function safePersist(promise: Promise<unknown>): void {
  void promise.catch(() => undefined);
}

/**
 * Subscribes a listener callback to real-time events for a specific session ID.
 */
export function subscribe(sessionId: string, listener: Listener): () => boolean {
  const set = listeners.get(sessionId) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(sessionId, set);

  return () => set.delete(listener);
}

/**
 * Appends a trace event to the in-memory store, syncs session timestamps,
 * persists to DB, and notifies active SSE listeners.
 */
export function appendEvent(event: AgentEvent): void {
  const sessionEvents = store.events.get(event.sessionId) ?? [];
  sessionEvents.push(event);
  store.events.set(event.sessionId, sessionEvents);

  const session = store.sessions.get(event.sessionId);
  if (session) {
    session.events = sessionEvents;
    session.updatedAt = event.createdAt;
    safePersist(persistSession(session));

    const request = store.requests.get(session.requestId);
    if (request) {
      request.status = session.currentState;
      safePersist(persistRequest(request));
    }
  }

  safePersist(persistEvent(event));

  // Notify live WebSocket/SSE subscribers
  const sessionListeners = listeners.get(event.sessionId);
  if (sessionListeners) {
    sessionListeners.forEach((listener) => listener(event));
  }
}

/**
 * Appends a negotiation message to memory and persists to database.
 */
export function appendMessage(sessionId: string, message: NegotiationMessage): void {
  const sessionMessages = store.messages.get(sessionId) ?? [];
  sessionMessages.push(message);
  store.messages.set(sessionId, sessionMessages);

  const session = store.sessions.get(sessionId);
  if (session) {
    session.messages = sessionMessages;
    safePersist(persistSession(session));
  }

  safePersist(persistMessage(sessionId, message));
}

/**
 * Inserts or updates an offer in memory and database, refreshing the active session snapshot.
 */
export function upsertOffer(offer: Offer): void {
  store.offers.set(offer.id, offer);
  safePersist(persistOffer(offer));

  const session = [...store.sessions.values()].find(
    (item) => item.requestId === offer.requestId
  );

  if (session) {
    session.offers = [...store.offers.values()].filter(
      (item) => item.requestId === offer.requestId
    );
    safePersist(persistSession(session));
  }
}

/**
 * Persists a human review decision to the database.
 */
export function persistStoredApproval(sessionId: string, review: HumanReview): void {
  safePersist(persistApproval(sessionId, review));
}

/**
 * Persists an evaluation run record to the database.
 */
export function persistStoredEvaluation(run: EvaluationRun): void {
  safePersist(persistEvaluation(run));
}
