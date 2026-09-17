# Knowledge Gaps

> Cross-links: [Master Map](README.md) · [Security Architecture](15-security-architecture.md) · [Architecture Decisions](20-architecture-decisions.md)

Every item below is labeled **CONFIRMED** (directly verified in code/git history), **INFERRED** (a reasonable reading that isn't directly stated), or **UNKNOWN** (cannot be determined from this repository at all).

## Things that cannot be determined from the repository

1. **UNKNOWN** — Whether the "external code review" mentioned in commit `92cd203`'s message was performed by an actual human/third-party service, or was itself an AI-simulated review. No review artifacts (PR, review comments, linked issue) exist in the repo to verify who or what performed it.
2. **UNKNOWN** — `groq-sdk`'s actual default timeout/retry behavior. This lives inside the installed package (`node_modules/groq-sdk`), which was not traced as part of this review — application code adds no timeout/retry logic of its own.
3. **UNKNOWN** — Whether any current transitive dependency (beyond the already-evaluated-and-rejected `@huggingface/transformers`) carries an unpatched CVE. Would require running `npm audit` against a live registry; not done here.
4. **UNKNOWN** — Why Groq specifically was chosen as the LLM provider (no comment or commit message states this beyond noting a model deprecation forced a model-name change). Reasonably guessed to be cost/speed for iterative development, but not confirmed.
5. **UNKNOWN** — The real-world attack success rate of any of these guardrails at scale. The project's own numbers (0/7, 3/6, etc.) come from a handful of hand-written fixtures run once or a few times — explicitly flagged by the project's own README as not statistically meaningful, and I have no way to determine a "true" rate from static code review.

## Ambiguous behavior

6. **CONFIRMED, ambiguous consequence** — `CandidateRun.jobTitle` is hardcoded to `"Senior Backend Engineer"` in every graph's `persistNode`, even when a caller supplies a custom `jobDescription` via `POST /api/candidates/upload`'s optional body field. If someone used that override to score against a genuinely different role, the persisted record's `jobTitle` would be misleading. **INFERRED**: likely just an oversight from `jobTitle` being written once early on and never revisited when the `jobDescription` override was added — but I cannot confirm intent either way.
7. **CONFIRMED** — `GET /api/candidates/` and `GET /api/samples` have no `try/catch`, unlike the two `POST` routes in the same files. **UNKNOWN** whether this is intentional (perhaps because these paths were considered "safe enough not to fail") or simply inconsistent error-handling coverage that was never revisited.
8. **CONFIRMED** — Multer's file-size-limit error path has no dedicated error-handling middleware in `server.js`. **INFERRED**: an oversized upload would likely fall through to Express's default error handler rather than the app's JSON error format, but this was not runtime-tested as part of this review — flagged as inferred, not observed.

## Missing documentation

9. **CONFIRMED** — No OpenAPI/Swagger spec exists; [05-api-architecture.md](05-api-architecture.md) in this doc set is currently the only structured API reference.
10. **CONFIRMED** — No code comments or docs explain why `temperature: 0.2` specifically (vs. 0 or another value) was chosen for every LLM call.
11. **CONFIRMED** — No documentation (in code or README) states what Node.js version this project targets — no `engines` field in `package.json`.

## Dead / unused-looking code

12. **CONFIRMED** — `zod` is present in `package-lock.json` but never imported anywhere in `server/src/` — it's a transitive dependency of `@langchain/langgraph`, not something the application uses for its own validation, despite validation being a major theme of this project. Worth knowing if you're looking for "where's the schema validation library" — there isn't one; validation is hand-rolled in `reviewGate.js`/`actionPolicy.js`.
13. **CONFIRMED** — `tools.js`'s `read_resume` handler is designed to always return an error (`"read_resume has no live handler..."`) — this looks like dead/unreachable code at first glance, but it's intentionally defensive: the schema exists only so the *fabricated* tool-call history is well-formed, and the handler exists only to fail loudly if that assumption is ever violated. Not dead code — a deliberate tripwire. Documented here so it isn't mistaken for an oversight.
14. **INFERRED, not confirmed** — Whether `ALLOWED_ORIGIN` supporting only a single origin string (not a list) is a deliberate simplicity choice or simply not yet needed. The code (`cors({origin: process.env.ALLOWED_ORIGIN})`) only supports one value; there's no comma-splitting or array handling.

## Areas where implementation and documentation disagree

15. **CONFIRMED, now fixed** — The README itself documents that "hard isolation" and "semantic similarity" were previously overclaimed labels, corrected in the `92cd203` commit (the rule was renamed from `semantic-similarity-multi-match` to `lexical-similarity-multi-match`). At the time of this review, the README's current language and the code are consistent — I verified this rather than assuming it.
16. **CONFIRMED** — The README's architecture diagram (in its "Architecture (target)" section) lists "[4] Output scanning + gate" as part of the intended pipeline. The actual code implements structural/consistency validation (`reviewGate.js`, `actionPolicy.js`) in that slot, not content-level "output scanning" in the sense of checking the evaluation against the source document. The README is careful to call this distinction out explicitly in its Known Limitations section, so this isn't a case of undocumented disagreement — but a reader skimming only the architecture diagram at the top could come away with an inflated sense of what's implemented. Flagged here for completeness.

## Technical debt

17. **CONFIRMED** — Near-duplicated code across `graph.js`/`graphPhase2.js`/`graphPhase3.js` (see [20-architecture-decisions.md](20-architecture-decisions.md), Decision 1) — likely a deliberate demonstrative choice, but real debt if the project grows further.
18. **CONFIRMED** — No centralized configuration module; every file reads `process.env.*` directly at the point of use (see [12-configuration-and-environment.md](12-configuration-and-environment.md)).
19. **CONFIRMED** — Inconsistent try/catch coverage across routes (item 7 above).

## Architecture that is difficult to understand (worth extra attention)

20. The fact that `read_resume` tool calls in the conversation history are **fabricated by the server, never actually issued by the model** — this is easy to misread on a first pass through `graphPhase2.js`/`graphPhase3.js` as the model genuinely calling a tool. It doesn't; the server writes both sides of that exchange into history before the model's first real inference call. See [09-ai-prompt-and-context-flow.md](09-ai-prompt-and-context-flow.md) for the full worked example.
21. The distinction between `classification.decision === "block"` (input classifier) and `review.passed === false` (post-LLM review gate) as two structurally different kinds of "blocked" — both show up as different badges in the test console and different `ruleFired` values, but they happen at very different points in the pipeline with very different guarantees (one is pre-LLM/structural, the other is post-LLM/consistency-only).

## Questions a new developer should ask the original author

- Was the "external code review" in the hardening commit a real third party, or a self-review/AI-assisted pass? (Affects how much independent scrutiny this codebase has actually received.)
- Is there a plan/timeline for Phase 4 (output scanning / evidence-grounding), given it's the one gap the whole project's own narrative points to as unresolved?
- Was the `jobTitle` hardcoding (item 6) intentional, or should it be derived from the actual `jobDescription` used for a given run?
- Is Groq expected to remain the provider long-term, or was it a temporary/cost-driven choice that might change (relevant to anyone planning to build on top of `llmClient.js`)?
- Is there an intended real deployment target (a specific cloud platform, a specific container orchestrator) that should shape how [13-deployment-and-infrastructure.md](13-deployment-and-infrastructure.md)'s "what you'd need to add" list gets prioritized?
