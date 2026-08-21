CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ALTER COLUMN "embedding" SET DATA TYPE vector(768) USING "embedding"::vector(768);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_events_session_created_idx" ON "agent_events" ("session_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "negotiation_messages_session_created_idx" ON "negotiation_messages" ("session_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_offers_request_vendor_round_idx" ON "vendor_offers" ("request_id", "vendor_id", "round_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_runs_session_created_idx" ON "model_runs" ("session_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_executions_session_created_idx" ON "tool_executions" ("session_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_chunks_embedding_idx" ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops);
