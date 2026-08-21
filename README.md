# Procura

Procura is a policy-bounded autonomous procurement negotiator for procurement managers. One negotiator proposes, an independent critic challenges, and deterministic TypeScript policy code authorizes the action.

## Run locally

Backend:

```bash
cd backend
bun install
copy .env.example .env
bun run typecheck
bun run dev
```

Frontend:

```bash
cd client
bun install
copy .env.example .env.local
bun run dev
```

Open `http://localhost:3000`. The canonical scenario is prefilled. With no provider keys or database URL, the app runs a deterministic demo mode so the full workflow remains demonstrable. With `GOOGLE_GENERATIVE_AI_API_KEY` and `OPENROUTER_API_KEY`, Gemini is used for both negotiation and independent criticism (`gemini-3.1-flash-lite` by default), while DeepSeek remains the negotiator fallback.

## Verification

```bash
cd backend
bun run test
bun run typecheck
bun run db:seed

cd ../client
bun run build
```

The backend uses Drizzle schema definitions for Neon PostgreSQL in `src/db/schema.ts`. Set `DATABASE_URL` and run `bun run db:push` to provision the tables. Runtime demo state uses a small server-side persistence adapter when no database is configured, which makes local development and the evaluation harness runnable without external infrastructure.

## Demo flow

The seeded vendors include delayed, malformed, and temporarily unavailable responses. Vendor A’s 50% advance proposal is deliberately surfaced as a verification case: the negotiator proposes, Gemini/deterministic critic blocks, the policy engine blocks, and a safe corrective counter is sent. The final comparison selects the actual best compliant offer from Vertex Systems at ₹55,500/unit for the canonical request.

## API

`POST /api/procurements`, `POST /api/procurements/:id/start`, `GET /api/procurements/:id`, `/offers`, `/messages`, `/events`, `/events/stream`, `POST /api/procurements/:id/approve|reject|stop`, `POST /api/evaluation/run`, and `GET /api/evaluation/:id`.
