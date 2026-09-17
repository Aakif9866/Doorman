# 16 — Performance & Scalability

> Cross-links: [Deployment](13-deployment-and-infrastructure.md) · [AI Architecture](08-ai-architecture.md)

## Performance-sensitive components

The dominant cost by far is **LLM latency** — one or two sequential Groq API calls per Phase 3 request (evaluate, then act), each a network round trip to an external service with model-inference time on top. Everything else in the request path (regex matching, TF-IDF cosine similarity over a handful of short sentences, JSON parsing, a single Mongo insert) is computationally trivial by comparison — confirmed by there being no caching, batching, or optimization applied to *those* paths, which would be unnecessary work if they weren't already cheap.

## Database bottlenecks

`CandidateRun` has **no indexes beyond the default `_id`** (confirmed — no `.index()` calls in the schema). `getAllRuns()`'s `.sort({createdAt: -1})` therefore requires a full collection scan plus in-memory sort once the collection grows beyond what fits in Mongo's default working set comfortably. At the data volumes this project is designed for (a personal demo, hand-run a handful of times), this is a non-issue; it would become one if this were ever pointed at a real, continuously-running deployment without adding an index on `createdAt`.

There is also **no pagination** on `GET /api/candidates/` — it returns every run in the collection in one response, which both increases response size linearly with history and increases load on the client rendering it (though the current client doesn't even render this endpoint's data — `client/index.html` never calls `GET /api/candidates/`; it only uses `/api/samples` and `/api/samples/evaluate` or the upload endpoint).

## Caching

**None exists.** Every request re-runs classification and re-calls the LLM from scratch, even for byte-identical input run twice in a row (e.g., re-running the same fixture through the test console twice makes two full Groq API calls). There is no memoization of classification results, no LLM response cache, no HTTP caching headers.

## Redis / connection pooling

No Redis or any other cache/session store is used. Mongoose manages its own internal connection pooling by default (not explicitly configured/tuned in `db/mongo.js` — only `serverSelectionTimeoutMS` is set); no custom pool-size tuning exists.

## Async processing

Every request is handled entirely synchronously within its own HTTP request/response cycle via `async`/`await` — there is no background job queue, no fire-and-forget processing, no webhook-based async completion. This means a client calling `POST /api/candidates/upload` genuinely waits for the full pipeline (up to two sequential LLM calls) before getting a response — there is no "submit and poll for status" pattern, which the test console's own loading message ("can take a few seconds") acknowledges.

## API latency

Dominated by Groq round-trip time, multiplied by 1 (blocked at classifier), or roughly 1–2 LLM calls (Phase 3 evaluate + optionally act), or up to 5 tool-loop iterations each in Phase 1/2 (`maxSteps: 5` there vs. `maxSteps: 1` for Phase 3's evaluate stage). No client-side or server-side timeout is explicitly configured beyond whatever `groq-sdk` defaults to internally.

## AI latency / concurrency

Each incoming request independently opens its own Groq call(s) — there is no batching of multiple candidates into one LLM call, no queueing/throttling of concurrent LLM calls, and (per [15-security-architecture.md](15-security-architecture.md)) no rate limiting on the API layer that would cap how many concurrent Groq calls the app can trigger. Under concurrent load, the practical limit is whatever Groq's own account-level rate limits are — and since there's no handling for a 429 from Groq beyond the generic error path, a burst of concurrent requests exceeding Groq's rate limit would surface as generic 500s to callers with no retry/backoff.

## Horizontal / vertical scaling

See [13-deployment-and-infrastructure.md](13-deployment-and-infrastructure.md) for the full discussion. Short version: vertical scaling isn't really the constraint (the app does very little local computation); horizontal scaling is undermined by the in-memory storage fallback (each instance has its own inconsistent view of run history) unless `MONGO_URI` is configured, and even then, no explicit work has gone into making the app safely scalable (no distributed locking, no idempotency keys on writes, no graceful shutdown handling for in-flight LLM calls).

## Identified potential bottlenecks, ranked

1. **Groq API latency and per-account rate limits** — the dominant, unmitigated bottleneck; no retry/backoff/queueing exists.
2. **Missing index on `CandidateRun.createdAt`** — would matter only at real production data volumes, not at the project's current demo scale.
3. **No pagination on the listing endpoint** — same caveat as above.
4. **In-memory storage under horizontal scaling** — only relevant if this is ever deployed as more than one instance without Mongo configured.

None of these are urgent for the project's actual current use case (a locally-run demo/portfolio tool), but they are the concrete things that would need addressing first if usage ever grew.
