import fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { extractRequirements } from './requirements';
import { createSession, resumeSession, runSession } from './agent/orchestrator';
import { appendEvent, persistStoredApproval, store, subscribe } from './store';
import { createId, now, type ProcurementRequest } from './domain';
import { runEvaluation } from './evaluation/runner';
import { config, assertProductionConfig } from './utils/config';
import { ApplicationError, ValidationError } from './errors';
import { findEvaluation, findRequest, hydrateSession, persistRequest } from './db/repository';

const server = fastify({ logger: true });
server.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => done(null, body || {}));
await server.register(cors, { origin: config.clientOrigin, credentials: true });

const idSchema = z.string().uuid();
const procurementBodySchema = z.object({ rawRequest: z.string().trim().min(8).max(5000) }).strict();
const decisionSchema = z.enum(['approve', 'reject', 'stop']);
const evaluationBodySchema = z.object({ mode: z.enum(['provider', 'test-adapter']).optional() }).default({});
type LocalRecord = ProcurementRequest & { id: string; rawRequest: string; status: string; createdAt: string };

const publicSession = (session: ReturnType<typeof createSession>) => ({ ...session, vendors: session.vendors.map(({ behavior, ...vendor }) => vendor) });
const cacheSession = (session: ReturnType<typeof createSession>) => { store.sessions.set(session.id, session); store.events.set(session.id, session.events); store.messages.set(session.id, session.messages); return session; };
const parseId = (value: string) => idSchema.parse(value);
const getSession = async (identifier: string) => {
  parseId(identifier);
  const local = store.sessions.get(identifier) ?? [...store.sessions.values()].find((session) => session.requestId === identifier);
  if (local) return local;
  const hydrated = await hydrateSession(identifier);
  return hydrated ? cacheSession(hydrated) : null;
};
const getRequest = async (requestId: string) => store.requests.get(requestId) ?? await findRequest(requestId);
const parseBody = (body: unknown) => procurementBodySchema.parse(typeof body === 'string' ? (() => { try { return JSON.parse(body); } catch { return {}; } })() : body);
const safeError = (error: unknown) => error instanceof ApplicationError ? { status: 400, body: { error: error.message, code: error.code } } : { status: 500, body: { error: 'Internal server error.', code: 'INTERNAL_ERROR' } };

server.get('/', async () => ({ name: 'Procura', status: 'ok', description: 'Policy-bounded autonomous procurement negotiator' }));
server.get('/api/health', async () => ({ status: 'ok', mode: 'provider-enabled', database: 'neon' }));

server.post('/api/procurements', async (request, reply) => {
  try {
    const { rawRequest } = parseBody(request.body);
    const parsed = extractRequirements(rawRequest);
    const record: LocalRecord = { id: createId(), rawRequest, ...parsed, status: 'READY', createdAt: now() };
    store.requests.set(record.id, record);
    await persistRequest(record);
    return reply.code(201).send({ request: record });
  } catch (error) {
    const result = safeError(error);
    return reply.code(result.status).send(result.body);
  }
});

server.post<{ Params: { id: string } }>('/api/procurements/:id/start', async (request, reply) => {
  try {
    const id = parseId(request.params.id);
    const record = await getRequest(id);
    if (!record) return reply.code(404).send({ error: 'Procurement not found.', code: 'NOT_FOUND' });
    const existing = await getSession(id);
    if (existing) return reply.code(200).send({ requestId: record.id, sessionId: existing.id, session: publicSession(existing) });
    const session = cacheSession(createSession(record.id, record));
    record.status = 'RUNNING';
    await persistRequest(record);
    void runSession(session.id);
    return reply.code(202).send({ requestId: record.id, sessionId: session.id, session: publicSession(session) });
  } catch (error) {
    const result = safeError(error);
    return reply.code(result.status).send(result.body);
  }
});

server.get<{ Params: { id: string } }>('/api/procurements/:id', async (request, reply) => {
  try { const session = await getSession(request.params.id); if (!session) return reply.code(404).send({ error: 'Procurement session not found.', code: 'NOT_FOUND' }); return { request: await getRequest(session.requestId), session: publicSession(session) }; } catch (error) { const result = safeError(error); return reply.code(result.status).send(result.body); }
});
server.get<{ Params: { id: string } }>('/api/procurements/:id/offers', async (request, reply) => {
  try { const session = await getSession(request.params.id); if (!session) return reply.code(404).send({ error: 'Procurement session not found.', code: 'NOT_FOUND' }); return { offers: session.offers, bestOffer: session.currentBestOffer }; } catch (error) { const result = safeError(error); return reply.code(result.status).send(result.body); }
});
server.get<{ Params: { id: string } }>('/api/procurements/:id/messages', async (request, reply) => {
  try { const session = await getSession(request.params.id); if (!session) return reply.code(404).send({ error: 'Procurement session not found.', code: 'NOT_FOUND' }); return { messages: session.messages }; } catch (error) { const result = safeError(error); return reply.code(result.status).send(result.body); }
});
server.get<{ Params: { id: string } }>('/api/procurements/:id/events', async (request, reply) => {
  try { const session = await getSession(request.params.id); if (!session) return reply.code(404).send({ error: 'Procurement session not found.', code: 'NOT_FOUND' }); return { events: session.events }; } catch (error) { const result = safeError(error); return reply.code(result.status).send(result.body); }
});

server.get<{ Params: { id: string } }>('/api/procurements/:id/events/stream', async (request, reply) => {
  try {
    const session = await getSession(request.params.id);
    if (!session) return reply.code(404).send({ error: 'Procurement session not found.', code: 'NOT_FOUND' });
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': config.clientOrigin });
    for (const event of session.events) raw.write(`data: ${JSON.stringify(event)}\n\n`);
    const unsubscribe = subscribe(session.id, (event) => raw.write(`data: ${JSON.stringify(event)}\n\n`));
    const heartbeat = setInterval(() => raw.write(': heartbeat\n\n'), 15000);
    request.raw.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
  } catch (error) { const result = safeError(error); return reply.code(result.status).send(result.body); }
});

server.post<{ Params: { id: string; decision: string } }>('/api/procurements/:id/:decision', async (request, reply) => {
  try {
    const session = await getSession(request.params.id);
    if (!session) return reply.code(404).send({ error: 'Procurement session not found.', code: 'NOT_FOUND' });
    const decision = decisionSchema.parse(request.params.decision);
    const review = session.humanReview;
    if (decision !== 'stop' && !review) return reply.code(409).send({ error: 'No pending human review.', code: 'NO_PENDING_REVIEW' });
    if (review && review.status !== 'PENDING') {
      const resolved = decision === 'approve' ? 'APPROVED' : decision === 'reject' ? 'REJECTED' : 'STOPPED';
      if (review.status !== resolved) return reply.code(409).send({ error: 'Approval decision is already resolved.', code: 'DUPLICATE_DECISION' });
      return { session: publicSession(session), idempotent: true };
    }
    if (review) { review.status = decision === 'approve' ? 'APPROVED' : decision === 'reject' ? 'REJECTED' : 'STOPPED'; review.resolvedAt = now(); store.reviews.set(review.id, review); persistStoredApproval(session.id, review); }
    if (decision === 'approve') {
      await resumeSession(session.id);
      if (session.humanReview) persistStoredApproval(session.id, session.humanReview);
    } else {
      session.currentState = 'STOPPED'; session.pendingAction = null; session.stopReason = decision === 'reject' ? 'Human rejected the proposed action.' : 'Human stopped negotiation.';
      appendEvent({ id: createId(), sessionId: session.id, type: decision === 'reject' ? 'HUMAN_REJECTED' : 'NEGOTIATION_STOPPED', state: 'STOPPED', message: session.stopReason, metadata: { reviewId: review?.id }, createdAt: now() });
    }
    return { session: publicSession(session) };
  } catch (error) {
    const result = safeError(error);
    return reply.code(result.status).send(result.body);
  }
});

server.post('/api/evaluation/run', async (request, reply) => {
  try { const body = evaluationBodySchema.parse(request.body ?? {}); return { run: await runEvaluation(body.mode) }; } catch (error) { const result = safeError(error); return reply.code(result.status).send(result.body); }
});
server.get<{ Params: { id: string } }>('/api/evaluation/:id', async (request, reply) => { try { parseId(request.params.id); const run = store.evaluationRuns.get(request.params.id) ?? await findEvaluation(request.params.id); if (!run) return reply.code(404).send({ error: 'Evaluation run not found.', code: 'NOT_FOUND' }); return { run }; } catch (error) { const result = safeError(error); return reply.code(result.status).send(result.body); } });

server.setErrorHandler((error, _request, reply) => { server.log.error({ err: error }, 'request failed'); reply.code(500).send({ error: 'Internal server error.', code: 'INTERNAL_ERROR' }); });

assertProductionConfig();
await server.listen({ port: config.port, host: '0.0.0.0' });
console.log(`Procura backend listening on http://localhost:${config.port}`);
