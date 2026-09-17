# 11 — External Integrations

> Cross-links: [AI Architecture](08-ai-architecture.md) · [Configuration](12-configuration-and-environment.md)

## Summary

There is exactly **one** live external integration in this codebase: **Groq** (LLM inference). Everything else that might look like an integration (email, ATS) is mocked and contacts nothing. MongoDB is a database, not a third-party API, and is covered in [06-database-architecture.md](06-database-architecture.md) — it's included here only for completeness since it is technically an external service.

## Groq (LLM inference)

- **Purpose**: run the recruiting agent's scoring/decision logic.
- **Where used**: `server/src/agent/llmClient.js` only — this is the single call site in the entire codebase.
- **Client library**: `groq-sdk` (npm, ^0.7.0), instantiated once at module load: `const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });`.
- **Authentication**: API key via `GROQ_API_KEY`, passed to the SDK constructor. No OAuth, no per-request signing beyond what the SDK handles internally.
- **Request flow**: `groq.chat.completions.create({model, messages, tools, tool_choice, temperature})` — OpenAI-compatible chat completions with function/tool calling. See [08-ai-architecture.md](08-ai-architecture.md) for full request shape.
- **Response flow**: `response.choices[0].message` — either plain text content or one or more `tool_calls`, parsed by `runAgentLoop`.
- **Error handling**: **none specific to Groq** — a thrown error from the SDK (auth failure, network error, rate limit, model error) propagates unmodified up through `runAgentLoop` → the calling graph node → the route handler's generic `try/catch` → a `500 {error: err.message}` response. The raw Groq SDK error message reaches the API caller.
- **Retry behavior**: none in application code. Whatever retry behavior `groq-sdk` does internally by default (this repo's code was not traced into `node_modules` to determine the SDK's own defaults) is the only retry that happens.
- **Configuration/env vars**: `GROQ_API_KEY` (required for any LLM call to succeed), `GROQ_MODEL` (optional, defaults to `openai/gpt-oss-120b`).
- **Rate limits**: not handled by this codebase at all — if Groq rate-limits the app, the resulting error surfaces as a generic 500 to the caller with no specific "rate limited, try again" messaging or backoff.

## MongoDB

- **Purpose**: optional persistence of every resume-evaluation run.
- **Where used**: `db/mongo.js`, `models/CandidateRun.js`, `storage.js`.
- **Client library**: `mongoose` (^8.6.3).
- **Authentication**: embedded in the `MONGO_URI` connection string (e.g. `mongodb://user:pass@host/db`) — no separate credential handling in code.
- **Request/response flow**: standard Mongoose `create()`/`find()` calls; see [06-database-architecture.md](06-database-architecture.md).
- **Error handling**: connection failures at startup are caught and logged as a warning, with the app falling back to in-memory storage (`connectMongo`'s `try/catch`). **Runtime failures after a successful startup connection are not specifically handled** — see [17-error-handling-and-observability.md](17-error-handling-and-observability.md) and [knowledge-gaps.md](knowledge-gaps.md).
- **Retry behavior**: none custom; `serverSelectionTimeoutMS: 2000` is the only tuning applied (reduced from Mongoose's 30s default).
- **Configuration**: `MONGO_URI` (optional; unset = in-memory fallback).

## Services confirmed **NOT** integrated (do not assume these exist)

- **Email** (SendGrid, SES, Postmark, SMTP, etc.) — `send_email` is a `console.log` stub in `tools.js`. No email SDK appears in `package.json`.
- **ATS / HR systems** (Greenhouse, Lever, Workday, etc.) — `write_to_ats` is likewise a `console.log` stub.
- **OAuth / SSO providers** — none; see [07-authentication-authorization.md](07-authentication-authorization.md).
- **Cloud storage** (S3, GCS, Azure Blob) — uploaded files are held in memory only (`multer.memoryStorage()`) and never written to any storage backend.
- **Payment processors** — not applicable to this project.
- **Analytics / monitoring SaaS** (Datadog, Sentry, Mixpanel, etc.) — none found in dependencies or code.
- **Vector databases / embeddings APIs** — none; see [08-ai-architecture.md](08-ai-architecture.md) for why the "similarity" guardrail doesn't count.
- **LangSmith / LangChain tracing** — despite using LangGraph, no tracing environment variables or SDK calls are present; LangGraph is used purely as a local state-machine library here, not with its hosted observability platform.

## Why this matters for how you reason about the project

If you're evaluating whether this project is "production ready" for a real hiring pipeline, the honest answer is: it currently cannot email anyone or update any real system, by design — those integration points are stubbed pending real implementation. Anyone extending this project to production use would need to add real email/ATS clients behind the existing `executeTool` dispatch point in `tools.js`, and at that point the guardrails documented in [10-guardrails-and-ai-safety.md](10-guardrails-and-ai-safety.md) — particularly the unresolved "no truthfulness check" gap — would go from a theoretical concern to a real one with real consequences.
