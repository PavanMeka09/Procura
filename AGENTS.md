# AGENTS.md

## Repository context

This repository is the Procura project. The current codebase is a lightweight backend-first setup with a Bun + Fastify server and a Drizzle database layer.

- Backend runtime: Bun
- API framework: Fastify
- Database: Drizzle ORM with Neon serverless
- Entry point: backend/src/server.ts
- Config helpers: backend/src/utils/config.ts
- Database schema: backend/src/db/schema.ts
- Frontend/client work should be kept separate under the client/ directory unless a task explicitly requires integration work

## Core instruction: maintain the working context

Agents must preserve and carry forward the current understanding of what is being built, what problem is being solved, and what the expected outcome is.

Before making changes, each agent should establish and maintain the following context:

- Current feature or bug being worked on
- Relevant files and modules involved
- Business or technical goal of the change
- Constraints, assumptions, and unknowns
- Current status of implementation and next step

If the repository state changes during a task, update the context instead of restarting from stale assumptions.

## Required behavior for agents

1. Read the relevant files before patching.
2. Identify the actual task and confirm the intended behavior before implementing.
3. Keep the work scoped to the current objective.
4. Do not silently drift into unrelated refactors or feature additions.
5. If a required fact is missing, state the gap and proceed with the most defensible assumption.
6. Preserve the project’s current architecture and conventions.
7. Summarize the current context in the final response: what was built, why it was built, and any remaining risks or follow-ups.

## Context maintenance checklist

Use this checklist throughout a task:

- What are we building right now?
- What files are involved?
- What has already been implemented?
- What is still missing or uncertain?
- What are the success criteria?
- What should be avoided to keep the change focused?

If a task spans multiple turns, the agent should explicitly carry forward the previous context rather than starting as if the project were brand new.

## Working rules

- Prefer small, targeted changes over broad rewrites.
- Match the existing style and naming patterns used in the repository.
- Do not remove or change existing behavior unless it is required by the task.
- When making architectural decisions, record the reasoning in the task summary so future agents understand the tradeoff.
- Keep comments concise and only add them when they clarify intent or constraints.

## Validation

After implementing a change, run the most relevant verification command available for the affected scope.

Examples:

- backend: bun run dev or bun run start
- database changes: bun run db:push
- Type or lint checks: use the project’s available scripts if present

If a command cannot be run, say so explicitly and explain why.

## Final response format

Each agent should end with a brief status update that includes:

- Objective completed or still in progress
- Files changed
- Why the change was needed
- Validation performed or blocked
- Any assumptions, caveats, or follow-up work

This keeps the project state understandable to subsequent agents and human collaborators.
