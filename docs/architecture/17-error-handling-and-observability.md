# 17 — Error Handling & Observability

> Cross-links: [Data Flow](04-data-flow.md) · [AI Architecture](08-ai-architecture.md) · [Knowledge Gaps](knowledge-gaps.md)

## Exception handling — the actual pattern

There is **no centralized error-handling middleware** in `server.js` (no 4-argument Express error handler registered anywhere). Instead, error handling is done **per-route**, inconsistently:

- `POST /api/candidates/upload` and `POST /api/samples/evaluate` wrap their bodies in `try { ... } catch (err) { console.error(err); res.status(500).json({error: err.message}); }`.
- `GET /api/candidates/` and `GET /api/samples` have **no try/catch at all** — confirmed by reading both files. An error thrown inside either (e.g., a Mongo query failure in the former, a filesystem error in the latter) would not be caught by application code; it would propagate as an unhandled rejection/exception, and Express's own default behavior (or, in the worst case, an uncaught-exception process crash for a synchronous throw outside a promise chain) would apply instead of the app's normal JSON error shape.

Inside the AI pipeline itself (`agent/graph*.js`), **no node function has its own try/catch** — a thrown error from a Groq call, a classifier call, or a database write propagates straight up through LangGraph's `invoke()` to whichever route handler called it.

## API errors

| Situation | Status | Body |
|---|---|---|
| No file uploaded | 400 | `{error: "No resume file uploaded (field name: 'resume')."}` |
| Unknown sample category | 400 | `{error: "Unknown category '<x>'. Expected 'attacks' or 'benign'."}` |
| Sample file not found / traversal attempt | 404 | `{error: "Sample not found: <category>/<file>"}` |
| Missing/invalid `x-api-key` (when `API_KEY` is set) | 401 | `{error: "Missing or invalid x-api-key header."}` |
| Any other thrown error in a try/catch-wrapped route | 500 | `{error: err.message}` — the raw error message, unsanitized |
| Any thrown error in a non-wrapped route (`GET` endpoints) | unhandled | Not a defined app behavior — see gap above |

## AI errors

Not distinguished from any other error type in code — a Groq API failure (bad key, network issue, model error, rate limit) throws the same generic `Error` that a database failure would, and is handled identically by whichever route's try/catch (if any) catches it. There is no AI-specific error class, no distinction in the response between "the AI failed" and "something else failed." A developer debugging a failure has to read `err.message` and infer the source.

## Database errors

`connectMongo()` catches connection errors **only at startup** and degrades to in-memory storage. A failure of an individual query/write **after** a successful startup connection (e.g., Mongo becoming unreachable mid-run) is not specifically caught anywhere — `saveRun`'s `CandidateRun.create(run)` call has no try/catch of its own, so such a failure would propagate up through `persistNode` (also uncaught) to the route handler.

## Retries / timeouts

**None configured anywhere in application code** — no retry wrapper around the Groq call, no explicit timeout shorter than whatever `groq-sdk`/`mongoose` default to internally. This is a deliberate absence, not a bug per se, but it does mean any transient failure (a brief network blip to Groq, a slow Mongo response) fails the entire request rather than being retried.

## Logging

**`console.log`/`console.warn`/`console.error` only** — no logging library (`winston`, `pino`, `bunyan`, etc.), no structured (JSON) log format, no log levels beyond what `console.*` naturally implies, no request-ID/correlation-ID tagging to tie a specific log line to a specific HTTP request or a specific persisted `CandidateRun`. Notable log statements:

- `server.js:28-30` — one-time startup warning if `API_KEY` is unset.
- `db/mongo.js` — connection success/failure.
- `llmClient.js:48` — `[ALLOWLIST VIOLATION]` if a tool call outside the declared set is returned.
- `tools.js:98,103` — `[MOCK EMAIL]`/`[MOCK ATS WRITE]` on every mocked action, including the candidate's derived email address and a truncated message body (a PII-in-logs concern, see [15-security-architecture.md](15-security-architecture.md)).
- `graphPhase3.js:128` — `[POLICY BLOCKED]` when `actionPolicy.js` refuses a tool call.
- Every route's `catch` block — `console.error(err)` before responding.

## Metrics / monitoring / alerts

**None exist.** No Prometheus/StatsD metrics, no APM integration (Datadog, New Relic, etc.), no error-tracking service (Sentry), no alerting configuration of any kind. The only durable record of what happened is whatever gets written to a `CandidateRun` document (if Mongo is configured) — and a run is only persisted if `persistNode` is reached at all, meaning an error thrown *before* that node (which is most of them, since it's the very last node in every graph) leaves **no persisted trace whatsoever**, only a console line.

## How a developer would investigate a production failure today

1. **Check the process's stdout/stderr** — this is the only log destination; whatever platform runs the process (a systemd journal, a container's log driver, a PaaS's log viewer) is where you'd look, since there's no log-shipping configured in this repo.
2. **Look for the specific `console.error(err)` line** from the failing route — it will include the raw error message and stack trace (`console.error(err)` logs the full `Error` object, not just `.message`).
3. **Check `GET /api/candidates/`** (if Mongo is configured) to see whether the run was persisted at all — if it's missing, the failure happened before `persistNode`, which for most failures (LLM error, classifier logic error) is basically guaranteed, since persistence is the last step in every graph.
4. **There is no way to correlate a specific user-facing error response to a specific server-side log line** beyond matching on approximate timing and the error message text itself — no request ID is generated or returned anywhere in this codebase.
5. **For an AI-specific failure** (unexpected/malformed model output that somehow still passed guardrails, or a guardrail that seems to have mis-fired), the relevant trace lives in the persisted `CandidateRun.classification`/`evaluation`/`review`/`ruleFired` fields for that run — this is the closest thing this project has to AI observability, and it only exists for runs that got far enough to persist.

## What this means practically

This project has **no formal observability stack** — logging is developer-oriented console output, and the persisted `CandidateRun` collection is an accidental-but-useful audit log rather than a designed one. This is appropriate for a locally-run demo; it would be one of the first things to build out (structured logging, request IDs, an APM/error tracker) before running this anywhere real users or real money touch it.
