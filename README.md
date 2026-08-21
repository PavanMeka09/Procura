# Procura

Procura is a policy-bounded autonomous procurement negotiator for enterprise procurement managers. One buyer negotiator proposes, an independent critic challenges, and deterministic TypeScript policy code authorizes every action.

### Multi-Agent Autonomous Vendor Layer & External Tool Connectors

Procura interacts with vendors through an authentic **multi-agent negotiation subsystem and pluggable external tool connectors**:
- **Autonomous AI Vendor Counter-Parties (`ai_agent`)**: Independent sales agents representing distinct suppliers (Apex Devices, Northstar IT, Vertex Systems). Each vendor agent has private reservation limits (floor unit price, target asking price, minimum advance %, lead times) and unique sales strategies (`eager_closer`, `tough_bargainer`, `balanced`). When Procura submits counter-offers, the vendor agents dynamically evaluate the terms against their hidden constraints and generate responsive commercial proposals.
- **External REST API / Webhook Connectors (`http_api`)**: Standardized HTTP integration layer for connecting live third-party vendor quote APIs.
- **Deterministic Benchmark Engine (`seeded`)**: 100% reproducible baseline runner for automated evaluation and regression testing.

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
cd frontend
bun install
copy .env.example .env.local
bun run dev
```

Open `http://localhost:3000` after configuring `DATABASE_URL`, `PROCURA_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, and `OPENROUTER_API_KEY` in the backend, plus `BACKEND_API_URL` and the server-only `PROCURA_API_KEY` in the frontend. Gemini is used for negotiation and independent criticism, while DeepSeek remains the negotiator fallback.

## Verification

```bash
cd backend
bun run test
bun run typecheck
bun run db:seed

cd ../frontend
bun run build
```

The backend uses Drizzle schema definitions for Neon PostgreSQL in `src/db/schema.ts`. Set the required environment variables and run `bun run db:push` to provision the tables.

## API

`POST /api/procurements`, `POST /api/procurements/:id/start`, `GET /api/procurements/:id`, `/offers`, `/messages`, `/events`, `/events/stream`, `POST /api/procurements/:id/approve|reject|stop`, `POST /api/evaluation/run`, and `GET /api/evaluation/:id`.
