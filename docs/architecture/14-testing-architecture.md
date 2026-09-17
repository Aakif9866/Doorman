# 14 — Testing Architecture

> Cross-links: [Codebase Architecture](03-codebase-architecture.md) · [Guardrails & AI Safety](10-guardrails-and-ai-safety.md)

## Test runner

Node's built-in `node:test` module, run via `npm test` → `node --test test/`. No Jest, Mocha, Vitest, or other third-party framework — confirmed by `package.json`'s `scripts.test` and the `import { test } from "node:test"` in every test file.

## What exists: unit tests (`server/test/`, 5 files)

| File | What it actually tests | Confirmed coverage |
|---|---|---|
| `classifier.test.js` | `runRules` and `classifyDocument` | Positive matches for `instruction-override`, `tool-name-leak`, `fake-role-tag`; a negative case proving "operating system internals" doesn't false-positive; full block/allow decisions including the paraphrased-attack similarity path and a single-coincidental-match non-block case |
| `reviewGate.test.js` | `reviewEvaluation` | Every branch: valid pass, null input, out-of-range/non-integer score (11, 0, 5.5), invalid recommendation string, missing/short justification, both inconsistency directions (score 1+Hire, score 10+Reject), and a valid borderline case (score 6+Interview) |
| `actionPolicy.test.js` | `checkActionAgainstPolicy` | `write_to_ats` status match/mismatch, candidateId match/mismatch; `send_email` recipient match/mismatch |
| `documentBoundary.test.js` | `wrapUntrustedDocument` | A resume containing a literal `</candidate_document>` cannot break out of the boundary (exactly one real closing tag survives); a filename containing `<script>` cannot inject HTML |
| `parseResume.test.js` | `extractResumeText` | Plain text is returned as-is despite a lying `mimetype` claiming PDF; a `%PDF-`-prefixed buffer is dispatched to PDF parsing (and correctly rejects on invalid structure) despite a lying `mimetype` claiming text/plain |

**Every one of these tests exercises pure, deterministic, non-LLM code.** This is a real strength: the guardrail logic that doesn't depend on model behavior is genuinely unit-tested, not just described in the README.

## What does NOT exist — testing gaps (confirmed by absence)

- **No tests that call the real Groq API.** `llmClient.js`'s `runAgentLoop` — including its dispatch-time allowlist re-verification (Guardrail 6 in [10-guardrails-and-ai-safety.md](10-guardrails-and-ai-safety.md)) — has zero automated test coverage. This is understandable (it would require either mocking the SDK or spending real API calls/money on every test run), but it means the one piece of code that talks to the LLM is currently only exercised manually, via `npm run baseline/phase2/phase3`.
- **No tests for the LangGraph pipelines themselves** (`graph.js`, `graphPhase2.js`, `graphPhase3.js`) — no test constructs a full `AgentState` and asserts on routing behavior (e.g., "does `routeAfterClassify` actually send a blocked document to `blockedNode`?"). This logic is currently validated only by manually reading the `scripts/run*.js` console output.
- **No HTTP/route-level tests** — no `supertest`-style test exists for any of the four API endpoints. Request validation (missing file → 400, bad category → 400, path traversal attempt → 404), the `requireApiKey` middleware, and the JSON response shape are all untested by automation.
- **No integration tests against a real or in-memory MongoDB** (`mongodb-memory-server` or similar is not a dependency) — `storage.js`'s Mongo-vs-in-memory branching logic is untested.
- **No end-to-end tests** of the static test console (`client/index.html`) — no Playwright/Cypress/Puppeteer setup exists.
- **No AI-output-quality tests** — nothing asserts that the model's scoring is *reasonable* on the benign fixtures beyond what a human reads in the manual script output; there's no golden-file/snapshot comparison.
- **No performance/load tests.**
- **No security-focused test suite** beyond what's implicit in the guardrail unit tests above (e.g., no fuzzing of the classifier, no dedicated path-traversal test for `routes/samples.js` despite that being a place with a manual guard — see [15-security-architecture.md](15-security-architecture.md)).

## Mocking and fixtures

- **LLM mocking**: none — the "manual test scripts" (`scripts/run*.js`) are not mocks, they're real calls to Groq, gated behind requiring a real `GROQ_API_KEY`. This means there is currently no way to run a full pipeline test without a real, billable API call.
- **Fixtures**: `server/attacks/*.txt` (7 files) and `server/benign/*.txt` (3 files) function as the project's test data, but they're consumed by the manual scripts and the live API, not by the `node:test` unit suite.
- **Tool execution mocking**: `tools.js`'s `executeTool` is itself a permanent mock (not a test double swapped in for testing — it's the only implementation that exists, in every environment).

## Test database

None — there is no dedicated test MongoDB instance or in-memory Mongo substitute; the unit tests never touch `storage.js`/`db/mongo.js` at all (none of the 5 test files import them).

## The honest summary

The unit-tested surface area is exactly the surface area that's easy to unit test: pure functions with no external dependencies (regex, math, string escaping, object-shape validation). Everything that depends on the LLM, the database, or HTTP is validated only manually, by a human running `npm run phase3` and reading console output, or by using the test console interactively. This is a reasonable trade-off for a demo project's time budget, but if this codebase grew, the biggest testing risk is that **the actual security-critical wiring** — does the evaluate stage really never get `send_email` bound? does `actNode`'s message list really exclude the resume text? — is currently verified by *reading the code*, not by an automated test that would catch a regression if someone accidentally changed it. See [knowledge-gaps.md](knowledge-gaps.md) for this framed as an open question.
