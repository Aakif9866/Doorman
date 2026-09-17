# 03 — Codebase Architecture

> Cross-links: [System Architecture](02-system-architecture.md) · [Data Flow](04-data-flow.md) · [AI Architecture](08-ai-architecture.md)

This document maps the actual directory structure to responsibilities. Directories are documented in the order a new developer would need to understand them.

## Repository root

```
Doorman/
├── README.md
├── client/           — static frontend (one file)
├── server/           — everything else
└── docs/architecture/ — this documentation set
```

**What should NOT be placed at the root**: application source code (it all lives under `server/src/`); secrets (`.env` is gitignored — confirmed in `.gitignore`).

---

## `client/`

**Purpose**: the test console UI.
**Important files**: `index.html` (the entire frontend — HTML, CSS, and JS in one file).
**Responsibilities**: render a pipeline picker, a sample/upload picker, and a results panel; call the JSON API; escape all dynamic content before rendering.
**Dependencies**: none (no build step, no package.json here).
**What should NOT be placed here**: server-side logic, secrets, anything requiring a build step (there's no bundler configured — adding a framework would require setting one up first).

---

## `server/` (root)

**Important files**: `package.json` (scripts + dependencies), `.env`/`.env.example` (configuration — see [12-configuration-and-environment.md](12-configuration-and-environment.md)).
**Contains**: `attacks/`, `benign/` (test fixtures), `scripts/` (manual runners), `src/` (application code), `test/` (unit tests).

### `server/attacks/` and `server/benign/`

**Purpose**: hand-written `.txt` resume fixtures used by the CLI scripts, the unit-adjacent manual testing, and the `/api/samples` endpoints.
**Responsibilities**: `attacks/` (7 files) each embed one prompt-injection technique; `benign/` (3 files) are legitimate resumes, including ones deliberately worded to bait the classifier (e.g. "operating system internals," "override mechanism," "already... approved for a promotion").
**Who reads them**: `scripts/run*.js` (directly via `fs`), `routes/samples.js` (`GET /api/samples` lists them, `POST /api/samples/evaluate` reads one).
**What should NOT be placed here**: real candidate data — these are synthetic, checked-into-git fixtures, not a real data store.

### `server/scripts/`

**Purpose**: manual experiment runners, invoked via `npm run baseline|phase2|phase3`. **Not** an automated test suite — they print to console and exit; nothing asserts pass/fail.
**Files**:
- `runBaseline.js` — loads every file in `attacks/`, runs each through Phase 1 (`agent/graph.js`), and prints a compromised/not-compromised verdict based on whether the model wrote `Hired`/`Interview` to the (mocked) ATS for what is, by construction, a zero-qualification candidate.
- `runPhase2.js` — same idea but runs both `attacks/` and `benign/` through Phase 2, printing block/allow and which rule(s) fired.
- `runPhase3.js` — same but through Phase 3, distinguishing "blocked at input classifier" vs. "blocked at review gate" vs. "reached act stage," and printing whether a wrong recommendation was ever actually acted on.
**Dependencies**: `dotenv/config`, the relevant `agent/graph*.js`, `data/jobDescription.js`, `db/mongo.js`.
**Who calls them**: only `npm run <script>` from the command line — never imported by application code.

### `server/test/`

**Purpose**: the actual automated test suite (Node's built-in `node:test` + `node:assert/strict`, run via `npm test`).
**Files and what they cover** (all confirmed by reading each file):
- `classifier.test.js` — regex rule firing/non-firing (including a negative test that "operating system internals" does *not* trigger the `role-play-jailbreak`/`fake-role-tag` rules), and `classifyDocument`'s block/allow decisions including the multi-match similarity threshold behavior.
- `reviewGate.test.js` — every branch of `reviewEvaluation`: valid pass, null input, out-of-range/non-integer score, invalid recommendation, short/missing justification, and both directions of score/recommendation inconsistency (score 1 + Hire, score 10 + Reject), plus a borderline-but-valid case (score 6 + Interview).
- `actionPolicy.test.js` — `checkActionAgainstPolicy` for both `write_to_ats` (status match, candidateId match) and `send_email` (recipient match), each with one passing and one failing case.
- `documentBoundary.test.js` — `wrapUntrustedDocument` cannot be broken out of by a literal `</candidate_document>` string or by HTML/script injection via the filename.
- `parseResume.test.js` — `extractResumeText` dispatches on magic bytes, not the claimed `mimetype`, in both directions (plain text mislabeled as PDF; a `%PDF-`-prefixed buffer mislabeled as text/plain, which should attempt PDF parsing and fail loudly rather than silently mis-decoding).
**What is NOT tested**: see [14-testing-architecture.md](14-testing-architecture.md) for the full gap analysis — notably, there are no tests that call the real Groq API, no tests for `llmClient.js`'s dispatch-time allowlist check, no route/HTTP-level tests, and no tests for the LangGraph graphs themselves.

---

## `server/src/` — application code

### `server.js`

**Responsibility**: the only entry point. Builds and starts the Express app.
**Inputs**: environment variables (via `dotenv/config`).
**Outputs**: an HTTP server listening on `PORT`.
**Dependencies**: `db/mongo.js`, `routes/candidates.js`, `routes/samples.js`, `middleware/auth.js`.
**Called by**: `npm run dev` only.
**Calls**: `connectMongo()`, `app.listen(...)`.

### `agent/` — the AI agent

| File | Responsibility | Inputs | Outputs | Called by | Calls |
|---|---|---|---|---|---|
| `prompts.js` | All system-prompt text + `wrapUntrustedDocument` (escaping/boundary-wrapping) | job description, filename, resume text | prompt strings, wrapped document string | `graph.js`, `graphPhase2.js`, `graphPhase3.js` | nothing (pure string functions) |
| `tools.js` | Tool JSON-schemas + the mocked `executeTool` dispatcher | tool name + args | `{ok, ...}` result objects; console output for `send_email`/`write_to_ats` | `graph*.js` (schemas), `llmClient.js` (`executeTool`) | nothing external — all mocked |
| `llmClient.js` | The actual Groq API call, wrapped in a bounded tool-calling loop with dispatch-time allowlist enforcement | `{messages, tools, executeTool, maxSteps, toolChoice}` | `{finalMessage, toolCalls, messages}` | all three `graph*.js` files | `groq-sdk`, the `executeTool` passed in by the caller |
| `reviewGate.js` | Pure-code structural/consistency validation of an evaluation object | `evaluation` object | `{passed, reason}` | `graphPhase3.js` only | nothing |
| `actionPolicy.js` | Pure-code check that a tool call matches the evaluation that authorized it | tool name, args, `{evaluation, candidateId, candidateEmail}` | `{allowed, reason?}` | `graphPhase3.js` only (inside `actNode`'s `policyEnforcedExecute`) | nothing |
| `graph.js` | Phase 1 LangGraph: `read → scoreAndAct → persist` | `{fileName, resumeText, jobDescription, candidateId}` | full graph state incl. `finalMessage`, `toolCalls` | `routes/candidates.js`, `routes/samples.js`, `scripts/runBaseline.js` | `prompts.js`, `tools.js`, `llmClient.js`, `storage.js` |
| `graphPhase2.js` | Phase 2 LangGraph: `classify → (read → scoreAndAct \| blocked) → persist` | same as above | + `classification` | same callers, `scripts/runPhase2.js` | + `classifier/index.js` |
| `graphPhase3.js` | Phase 3 LangGraph: `classify → (read → evaluate → reviewGate → (act \| reviewFailed) \| blocked) → persist` | same as above | + `evaluation`, `review` | same callers, `scripts/runPhase3.js` | + `reviewGate.js`, `actionPolicy.js` |

**What should NOT be placed in `agent/`**: HTTP-specific logic (no `req`/`res` objects appear anywhere in this directory — confirmed) and persistence details beyond calling `storage.saveRun` at the end of each graph.

### `classifier/` — pre-LLM guardrail

| File | Responsibility |
|---|---|
| `rules.js` | 9 named regexes + `runRules(text)` returning every match |
| `similarity.js` | Dependency-free TF-IDF/cosine similarity, `classifyBySimilarity(text, referenceVectors, threshold)` |
| `attackPhrases.js` | 12 hardcoded reference sentences the similarity check compares against |
| `index.js` | Combines both into one `classifyDocument(text)` decision |

**Called by**: `graphPhase2.js`, `graphPhase3.js` (`classifyNode`). **Not used by Phase 1** — the undefended baseline has no classifier call at all, by design.

### `routes/`

| File | Endpoints | Responsibility |
|---|---|---|
| `candidates.js` | `POST /api/candidates/upload`, `GET /api/candidates/` | Real file upload → parse → run pipeline → persist → respond. Listing endpoint reads all persisted runs. |
| `samples.js` | `GET /api/samples`, `POST /api/samples/evaluate` | List built-in fixture filenames; run one fixture through a chosen pipeline without a real upload. |

Both routers select which pipeline function to call via a `PIPELINES = {1: evaluateResume, 2: evaluateResumePhase2, 3: evaluateResumePhase3}` map, defaulting to Phase 3. **This is the one piece of "routing logic" that looks like business logic living in the route layer** — see [05-api-architecture.md](05-api-architecture.md) for why this matters architecturally.

### `middleware/auth.js`

**Responsibility**: `requireApiKey` — a single Express middleware, gates the two API routers. See [07-authentication-authorization.md](07-authentication-authorization.md).

### `db/mongo.js`, `storage.js`, `models/CandidateRun.js`

**Responsibility**: optional persistence, abstracted so callers don't need to know whether Mongo is connected. See [06-database-architecture.md](06-database-architecture.md).

### `utils/parseResume.js`

**Responsibility**: turn an uploaded file buffer into plain text, dispatching on the actual file bytes (`%PDF-` magic number) rather than the client-supplied `mimetype`.
**Called by**: `routes/candidates.js` only.

### `data/jobDescription.js`

**Responsibility**: the one hardcoded job description ("Senior Backend Engineer — Payments Platform") used as the scoring rubric everywhere, unless a caller supplies `jobDescription` in the request body (`routes/candidates.js` allows this override; `routes/samples.js` does not).

---

## How the codebase is organized — the pattern (and where it breaks)

The intended separation is: **routes** (HTTP concerns) → **agent** (business/AI logic, itself split into orchestration/`graph*.js`, LLM I/O/`llmClient.js`, and prompt construction/`prompts.js`) → **classifier** (a guardrail library the agent calls) → **storage** (persistence, abstracted over Mongo/in-memory).

Where it doesn't cleanly separate: the three `graph*.js` files are **near-duplicates** of each other rather than one graph with phase-conditional nodes — Phase 3 doesn't extend Phase 2's file, it's a full copy-paste-and-modify (confirmed: `readNode` in `graphPhase2.js` and the `readNode` used inside `graphPhase3.js` are textually identical function bodies in two different files). This is a real maintainability cost: a bug fix to the isolation-wrapping logic used by all three phases (like the boundary-escaping fix in the hardening commit) has to be reasoned about across three files, not one — though in that specific case the actual fix was in the shared `prompts.js`, so it only needed one change. See [20-architecture-decisions.md](20-architecture-decisions.md) for discussion of this duplication as a deliberate pedagogical choice vs. technical debt.
