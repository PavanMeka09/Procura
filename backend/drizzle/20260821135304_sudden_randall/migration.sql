CREATE TABLE "agent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"session_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"state" text NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"input" text NOT NULL,
	"scenario_config" jsonb NOT NULL,
	"expected_behavior" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"total" integer NOT NULL,
	"passed" integer NOT NULL,
	"failed" integer NOT NULL,
	"metrics" jsonb NOT NULL,
	"results" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "human_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"session_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"proposed_action" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"document_id" uuid NOT NULL,
	"content" text NOT NULL,
	"embedding" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"type" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"request_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"model" text NOT NULL,
	"role" text NOT NULL,
	"prompt_version" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"fallback" boolean DEFAULT false NOT NULL,
	"success" boolean NOT NULL,
	"round_number" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"estimated_cost" numeric(12,8),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "negotiation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"session_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"sender" text NOT NULL,
	"content" text NOT NULL,
	"round_number" integer NOT NULL,
	"message_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "negotiation_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"request_id" uuid NOT NULL,
	"status" text NOT NULL,
	"current_vendor_id" uuid,
	"current_round" integer DEFAULT 0 NOT NULL,
	"current_best_offer_id" uuid,
	"pending_action" jsonb,
	"risk_score" real DEFAULT 0 NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"stop_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"field" text NOT NULL,
	"operator" text NOT NULL,
	"threshold" numeric,
	"severity" text NOT NULL,
	"action" text NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "procurement_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"raw_request" text NOT NULL,
	"item" text NOT NULL,
	"quantity" integer NOT NULL,
	"target_unit_price" numeric(12,2),
	"maximum_unit_price" numeric(12,2) NOT NULL,
	"delivery_days" integer NOT NULL,
	"minimum_warranty_months" integer NOT NULL,
	"maximum_advance_payment_percent" integer NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"request_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"success" boolean NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"input" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"request_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"raw_response" text NOT NULL,
	"unit_price" numeric(12,2) NOT NULL,
	"total_price" numeric(14,2) NOT NULL,
	"delivery_days" integer NOT NULL,
	"warranty_months" integer NOT NULL,
	"advance_payment_percent" integer NOT NULL,
	"payment_terms" text NOT NULL,
	"valid_until" timestamp with time zone,
	"critic_status" text,
	"policy_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"slug" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"approved" boolean DEFAULT true NOT NULL,
	"reliability_score" real NOT NULL,
	"contact" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
