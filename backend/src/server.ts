import fastify from 'fastify';
import cors from '@fastify/cors';
import { extractRequirements } from './requirements';
import { createSession, runSession } from './agent/orchestrator';
import { appendEvent, store, subscribe } from './store';
import { createId, now } from './domain';
import { runEvaluation } from './evaluation/runner';
import { config } from './utils/config';
import { ValidationError } from './errors';

const server = fastify({ logger: true });
server.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => done(null, body || {}));
await server.register(cors, { origin: config.clientOrigin, credentials: true });

const publicSession = (session: ReturnType<typeof createSession>) => ({ ...session, vendors: session.vendors.map(({ behavior, ...vendor }) => vendor), modelRuns: session.modelRuns.map(({ model, role, durationMs, retryCount, fallback, success, usage }) => ({ model, role, durationMs, retryCount, fallback, success, usage })) });
const getSessionByRequestId = (requestId: string) => [...store.sessions.values()].find((session) => session.requestId === requestId);

server.get('/', async () => ({ name: 'Procura', status: 'ok', description: 'Policy-bounded autonomous procurement negotiator' }));
server.get('/api/health', async () => ({ status: 'ok', mode: config.googleApiKey || config.openRouterApiKey ? 'provider-enabled' : 'deterministic-demo' }));

server.post<{ Body: { rawRequest?: string } }>('/api/procurements', async (request, reply) => {
  try {
    const rawRequest = request.body?.rawRequest?.trim(); if (!rawRequest) throw new ValidationError('rawRequest is required.');
    const parsed = extractRequirements(rawRequest); const id = createId();
    const record = { id, rawRequest, ...parsed, status: 'READY', createdAt: now() };
    store.requests.set(id, record);
    return reply.code(201).send({ request: record });
  } catch (error) { return reply.code(error instanceof ValidationError ? 400 : 500).send({ error: error instanceof Error ? error.message : 'Unable to create procurement.' }); }
});

server.post<{ Params: { id: string } }>('/api/procurements/:id/start', async (request, reply) => {
  const record = store.requests.get(request.params.id); if (!record) return reply.code(404).send({ error: 'Procurement not found.' });
  const session = createSession(record.id, record); record.status = 'RUNNING';
  void runSession(session.id);
  return reply.code(202).send({ requestId: record.id, sessionId: session.id, session: publicSession(session) });
});

server.get<{ Params: { id: string } }>('/api/procurements/:id', async (request, reply) => { const session = getSessionByRequestId(request.params.id) ?? store.sessions.get(request.params.id); if (!session) return reply.code(404).send({ error: 'Procurement session not found.' }); return { request: store.requests.get(session.requestId), session: publicSession(session) }; });
server.get<{ Params: { id: string } }>('/api/procurements/:id/offers', async (request, reply) => { const session = getSessionByRequestId(request.params.id) ?? store.sessions.get(request.params.id); if (!session) return reply.code(404).send({ error: 'Procurement session not found.' }); return { offers: session.offers, bestOffer: session.currentBestOffer }; });
server.get<{ Params: { id: string } }>('/api/procurements/:id/messages', async (request, reply) => { const session = getSessionByRequestId(request.params.id) ?? store.sessions.get(request.params.id); if (!session) return reply.code(404).send({ error: 'Procurement session not found.' }); return { messages: session.messages }; });
server.get<{ Params: { id: string } }>('/api/procurements/:id/events', async (request, reply) => { const session = getSessionByRequestId(request.params.id) ?? store.sessions.get(request.params.id); if (!session) return reply.code(404).send({ error: 'Procurement session not found.' }); return { events: store.events.get(session.id) ?? [] }; });

server.get<{ Params: { id: string } }>('/api/procurements/:id/events/stream', async (request, reply) => {
  const session = getSessionByRequestId(request.params.id) ?? store.sessions.get(request.params.id); if (!session) return reply.code(404).send({ error: 'Procurement session not found.' });
  reply.hijack(); const raw = reply.raw; raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': config.clientOrigin });
  for (const event of store.events.get(session.id) ?? []) raw.write(`data: ${JSON.stringify(event)}\n\n`);
  const unsubscribe = subscribe(session.id, (event) => raw.write(`data: ${JSON.stringify(event)}\n\n`));
  const heartbeat = setInterval(() => raw.write(': heartbeat\n\n'), 15000);
  request.raw.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
});

server.post<{ Params: { id: string; decision: string } }>('/api/procurements/:id/:decision', async (request, reply) => {
  const session = getSessionByRequestId(request.params.id) ?? store.sessions.get(request.params.id); if (!session) return reply.code(404).send({ error: 'Procurement session not found.' });
  const decision = request.params.decision; if (!['approve', 'reject', 'stop'].includes(decision)) return reply.code(400).send({ error: 'Unsupported decision.' });
  if (!session.humanReview && decision !== 'stop') return reply.code(409).send({ error: 'No pending human review.' });
  const review = session.humanReview; if (review) { review.status = decision === 'approve' ? 'APPROVED' : decision === 'reject' ? 'REJECTED' : 'STOPPED'; review.resolvedAt = now(); store.reviews.set(review.id, review); }
  if (decision === 'approve') { session.currentState = 'ACCEPTED'; session.stopReason = 'Human approved the held action.'; appendEvent({ id: createId(), sessionId: session.id, type: 'HUMAN_APPROVED', state: 'ACCEPTED', message: 'Human approved the held procurement action.', metadata: { reviewId: review?.id }, createdAt: now() }); }
  else { session.currentState = 'STOPPED'; session.stopReason = decision === 'reject' ? 'Human rejected the proposed action.' : 'Human stopped negotiation.'; appendEvent({ id: createId(), sessionId: session.id, type: decision === 'reject' ? 'HUMAN_REJECTED' : 'NEGOTIATION_STOPPED', state: 'STOPPED', message: session.stopReason, metadata: { reviewId: review?.id }, createdAt: now() }); }
  return { session: publicSession(session) };
});

server.post('/api/evaluation/run', async () => ({ run: await runEvaluation() }));
server.get<{ Params: { id: string } }>('/api/evaluation/:id', async (request, reply) => { const run = store.evaluationRuns.get(request.params.id); if (!run) return reply.code(404).send({ error: 'Evaluation run not found.' }); return { run }; });

server.setErrorHandler((error, _request, reply) => { server.log.error(error); reply.code(500).send({ error: 'Internal server error.' }); });

await server.listen({ port: config.port, host: '0.0.0.0' });
console.log(`Procura backend listening on http://localhost:${config.port}`);
