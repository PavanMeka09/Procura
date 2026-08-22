import fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { extractRequirements } from './requirements';
import { createSession, resumeSession, runSession } from './agent/orchestrator';
import {
  appendEvent,
  cacheSession,
  getPendingSessionStart,
  getRequest,
  getSession,
  persistStoredApproval,
  runWithSessionStartLock,
  store,
  subscribe,
  type StoredRequestRecord,
} from './store';
import { createId, now, type NegotiationSession, type ProcurementRequest } from './domain';
import { runEvaluation } from './evaluation/runner';
import { config, assertProductionConfig } from './utils/config';
import { ApplicationError } from './errors';
import { findEvaluation, persistRequest } from './db/repository';

const server = fastify({ logger: false });

// Register content parsers and CORS
server.addContentTypeParser(
  'application/x-www-form-urlencoded',
  { parseAs: 'string' },
  (_request, body, done) => done(null, body || {})
);

await server.register(cors, {
  origin: config.clientOrigin,
  credentials: true,
});

/**
 * Authentication Hook:
 * Validates Bearer token on all /api/ endpoints (excluding health check and CORS preflight).
 */
server.addHook('onRequest', async (request, reply) => {
  const path = request.url.split('?')[0] ?? '';

  if (!path.startsWith('/api/') || path === '/api/health' || request.method === 'OPTIONS') {
    return;
  }

  if (request.headers.authorization !== `Bearer ${config.apiKey}`) {
    return reply.code(401).send({
      error: 'Authentication required.',
      code: 'UNAUTHORIZED',
    });
  }
});

// Zod Validation Schemas
const idSchema = z.string().uuid();

const procurementBodySchema = z
  .object({
    rawRequest: z.string().trim().min(8).max(5000),
  })
  .strict();

const decisionSchema = z.enum(['approve', 'reject', 'stop']);
const DECISION_STATUS_MAP: Record<z.infer<typeof decisionSchema>, 'APPROVED' | 'REJECTED' | 'STOPPED'> = {
  approve: 'APPROVED',
  reject: 'REJECTED',
  stop: 'STOPPED',
};
const evaluationBodySchema = z.object({
  mode: z.enum(['provider', 'test-adapter']).default('test-adapter'),
});

/**
 * Sanitizes vendor internal simulation behavior before returning session to client.
 */
function toPublicSession(session: NegotiationSession) {
  return {
    ...session,
    vendors: session.vendors.map(({ behavior, ...vendor }) => vendor),
  };
}
/**
 * Safely parses request body JSON.
 */
function parseJsonSafe(body: unknown): Record<string, unknown> {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return (body as Record<string, unknown>) ?? {};
}

function parseProcurementBody(body: unknown) {
  return procurementBodySchema.parse(parseJsonSafe(body));
}

/**
 * Maps domain errors and validation errors to standard HTTP response formats.
 */
function formatErrorResponse(error: unknown): {
  status: number;
  body: { error: string; code: string };
} {
  if (error instanceof ApplicationError) {
    return {
      status: 400,
      body: { error: error.message, code: error.code },
    };
  }

  if (error instanceof z.ZodError) {
    return {
      status: 400,
      body: { error: 'Request validation failed.', code: 'VALIDATION_ERROR' },
    };
  }

  return {
    status: 500,
    body: { error: 'Internal server error.', code: 'INTERNAL_ERROR' },
  };
}

// ---------------------------------------------------------------------------
// Health & Info Routes
// ---------------------------------------------------------------------------

server.get('/', async () => ({
  name: 'Procura',
  status: 'ok',
  description: 'Policy-bounded autonomous procurement negotiator',
}));

server.get('/api/health', async () => ({
  status: 'ok',
  mode: 'provider-enabled',
  database: config.databaseUrl ? 'neon' : 'unconfigured',
}));

// ---------------------------------------------------------------------------
// Procurement Lifecycle Routes
// ---------------------------------------------------------------------------

/**
 * POST /api/procurements
 * Ingests natural language requirement and creates a structured procurement record.
 */
server.post('/api/procurements', async (request, reply) => {
  try {
    const { rawRequest } = parseProcurementBody(request.body);
    const parsedRequirements = await extractRequirements(rawRequest);
    const record: StoredRequestRecord = {
      id: createId(),
      rawRequest,
      ...parsedRequirements,
      status: 'INTAKE',
      createdAt: now(),
    };

    store.requests.set(record.id, record);
    await persistRequest(record);

    return reply.code(201).send({ request: record });
  } catch (error) {
    const { status, body } = formatErrorResponse(error);
    return reply.code(status).send(body);
  }
});

/**
 * POST /api/procurements/:id/start
 * Starts or rejoins an autonomous multi-vendor negotiation session.
 */
server.post<{ Params: { id: string } }>(
  '/api/procurements/:id/start',
  async (request, reply) => {
    try {
      const id = idSchema.parse(request.params.id);
      const record = await getRequest(id);

      if (!record) {
        return reply.code(404).send({
          error: 'Procurement not found.',
          code: 'NOT_FOUND',
        });
      }

      // Return immediately if session is already in-flight from another concurrent request
      const pendingStart = getPendingSessionStart(id);
      if (pendingStart) {
        const result = await pendingStart;
        return reply.code(200).send({
          requestId: record.id,
          sessionId: result.session.id,
          session: toPublicSession(result.session),
        });
      }

      const result = await runWithSessionStartLock(id, async () => {
        const existing = await getSession(id);
        if (existing) {
          return { session: existing, created: false };
        }

        const session = cacheSession(createSession(record.id, record));
        record.status = 'RUNNING';
        await persistRequest(record);

        void runSession(session.id);
        return { session, created: true };
      });

      return reply.code(result.created ? 202 : 200).send({
        requestId: record.id,
        sessionId: result.session.id,
        session: toPublicSession(result.session),
      });
    } catch (error) {
      const { status, body } = formatErrorResponse(error);
      return reply.code(status).send(body);
    }
  }
);

/**
 * GET /api/procurements/:id
 * Fetches latest session snapshot.
 */
server.get<{ Params: { id: string } }>(
  '/api/procurements/:id',
  async (request, reply) => {
    try {
      const session = await getSession(request.params.id);
      if (!session) {
        return reply.code(404).send({
          error: 'Procurement session not found.',
          code: 'NOT_FOUND',
        });
      }

      const originalRequest = await getRequest(session.requestId);
      return reply.code(200).send({
        request: originalRequest,
        session: toPublicSession(session),
      });
    } catch (error) {
      const { status, body } = formatErrorResponse(error);
      return reply.code(status).send(body);
    }
  }
);

/**
 * GET /api/procurements/:id/offers
 * Fetches all accumulated vendor offers.
 */
server.get<{ Params: { id: string } }>(
  '/api/procurements/:id/offers',
  async (request, reply) => {
    try {
      const session = await getSession(request.params.id);
      if (!session) {
        return reply.code(404).send({
          error: 'Procurement session not found.',
          code: 'NOT_FOUND',
        });
      }

      return reply.code(200).send({
        offers: session.offers,
        bestOffer: session.currentBestOffer,
      });
    } catch (error) {
      const { status, body } = formatErrorResponse(error);
      return reply.code(status).send(body);
    }
  }
);

/**
 * GET /api/procurements/:id/messages
 * Fetches full RFQ and counteroffer message transcript.
 */
server.get<{ Params: { id: string } }>(
  '/api/procurements/:id/messages',
  async (request, reply) => {
    try {
      const session = await getSession(request.params.id);
      if (!session) {
        return reply.code(404).send({
          error: 'Procurement session not found.',
          code: 'NOT_FOUND',
        });
      }

      return reply.code(200).send({ messages: session.messages });
    } catch (error) {
      const { status, body } = formatErrorResponse(error);
      return reply.code(status).send(body);
    }
  }
);

/**
 * GET /api/procurements/:id/events
 * Fetches full agent audit log events.
 */
server.get<{ Params: { id: string } }>(
  '/api/procurements/:id/events',
  async (request, reply) => {
    try {
      const session = await getSession(request.params.id);
      if (!session) {
        return reply.code(404).send({
          error: 'Procurement session not found.',
          code: 'NOT_FOUND',
        });
      }

      return reply.code(200).send({ events: session.events });
    } catch (error) {
      const { status, body } = formatErrorResponse(error);
      return reply.code(status).send(body);
    }
  }
);

/**
 * GET /api/procurements/:id/events/stream
 * Server-Sent Events (SSE) stream for live negotiation traces.
 */
server.get<{ Params: { id: string } }>(
  '/api/procurements/:id/events/stream',
  async (request, reply) => {
    try {
      const session = await getSession(request.params.id);
      if (!session) {
        return reply.code(404).send({
          error: 'Procurement session not found.',
          code: 'NOT_FOUND',
        });
      }

      reply.hijack();
      const raw = reply.raw;

      raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': config.clientOrigin,
      });

      // Stream existing historical events
      for (const event of session.events) {
        raw.write(`data: ${JSON.stringify(event)}\n\n`);
      }

      // Stream incoming live events
      const unsubscribe = subscribe(session.id, (event) => {
        raw.write(`data: ${JSON.stringify(event)}\n\n`);
      });

      // Periodic heartbeat to prevent client socket timeout
      const heartbeat = setInterval(() => {
        raw.write(': heartbeat\n\n');
      }, 15000);

      request.raw.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    } catch (error) {
      const { status, body } = formatErrorResponse(error);
      return reply.code(status).send(body);
    }
  }
);

/**
 * POST /api/procurements/:id/:decision
 * Handles human-in-the-loop decisions ('approve' | 'reject' | 'stop').
 */
server.post<{ Params: { id: string; decision: string } }>(
  '/api/procurements/:id/:decision',
  async (request, reply) => {
    try {
      const session = await getSession(request.params.id);
      if (!session) {
        return reply.code(404).send({
          error: 'Procurement session not found.',
          code: 'NOT_FOUND',
        });
      }

      const decision = decisionSchema.parse(request.params.decision);

      // Terminal sessions cannot be stopped
      if (
        decision === 'stop' &&
        ['ACCEPTED', 'STOPPED', 'FAILED'].includes(session.currentState)
      ) {
        return reply.code(409).send({
          error: 'Terminal procurement sessions cannot be stopped.',
          code: 'SESSION_TERMINAL',
        });
      }

      const review = session.humanReview;
      if (decision !== 'stop' && !review) {
        return reply.code(409).send({
          error: 'No pending human review.',
          code: 'NO_PENDING_REVIEW',
        });
      }

      // Handle duplicate decision idempotency
      if (review && review.status !== 'PENDING') {
        const resolved = DECISION_STATUS_MAP[decision];

        if (review.status !== resolved) {
          return reply.code(409).send({
            error: 'Approval decision is already resolved.',
            code: 'DUPLICATE_DECISION',
          });
        }

        return reply.code(200).send({
          session: toPublicSession(session),
          idempotent: true,
        });
      }

      if (review) {
        review.status = DECISION_STATUS_MAP[decision];
        review.resolvedAt = now();
        store.reviews.set(review.id, review);
        persistStoredApproval(session.id, review);
      }

      if (decision === 'approve') {
        await resumeSession(session.id);
        if (session.humanReview) {
          persistStoredApproval(session.id, session.humanReview);
        }
      } else {
        session.currentState = 'STOPPED';
        session.pendingAction = null;
        session.stopReason =
          decision === 'reject'
            ? 'Human rejected the proposed action.'
            : 'Human stopped negotiation.';

        appendEvent({
          id: createId(),
          sessionId: session.id,
          type: decision === 'reject' ? 'HUMAN_REJECTED' : 'NEGOTIATION_STOPPED',
          state: 'STOPPED',
          message: session.stopReason,
          metadata: { reviewId: review?.id },
          createdAt: now(),
        });
      }

      return reply.code(200).send({ session: toPublicSession(session) });
    } catch (error) {
      const { status, body } = formatErrorResponse(error);
      return reply.code(status).send(body);
    }
  }
);

// ---------------------------------------------------------------------------
// Automated Evaluation Lab Routes
// ---------------------------------------------------------------------------

/**
 * POST /api/evaluation/run
 * Executes the 20-case evaluation suite.
 */
server.post('/api/evaluation/run', async (request, reply) => {
  try {
    const body = evaluationBodySchema.parse(request.body ?? {});
    const runResult = await runEvaluation(body.mode);
    return reply.code(200).send({ run: runResult });
  } catch (error) {
    const { status, body } = formatErrorResponse(error);
    return reply.code(status).send(body);
  }
});

/**
 * GET /api/evaluation/:id
 * Fetches previous evaluation run results.
 */
server.get<{ Params: { id: string } }>(
  '/api/evaluation/:id',
  async (request, reply) => {
    try {
      idSchema.parse(request.params.id);
      const run =
        store.evaluationRuns.get(request.params.id) ??
        (await findEvaluation(request.params.id));

      if (!run) {
        return reply.code(404).send({
          error: 'Evaluation run not found.',
          code: 'NOT_FOUND',
        });
      }

      return reply.code(200).send({ run });
    } catch (error) {
      const { status, body } = formatErrorResponse(error);
      return reply.code(status).send(body);
    }
  }
);

// Global unhandled error handler
server.setErrorHandler((error, _request, reply) => {
  server.log.error({ err: error }, 'Unhandled request failure');
  return reply.code(500).send({
    error: 'Internal server error.',
    code: 'INTERNAL_ERROR',
  });
});

assertProductionConfig();
await server.listen({ port: config.port, host: '0.0.0.0' });
console.log(`Procura backend listening on http://localhost:${config.port}`);
