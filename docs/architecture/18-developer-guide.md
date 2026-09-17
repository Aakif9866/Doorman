# 18 — Developer Guide

> Cross-links: [Configuration](12-configuration-and-environment.md) · [Codebase Architecture](03-codebase-architecture.md) · [Testing](14-testing-architecture.md)

## 1. How to set up the project

```bash
git clone <this repo>
cd Doorman/server
npm install
cp .env.example .env
# edit .env: set GROQ_API_KEY at minimum
```

## 2. Required dependencies

Node.js (version not pinned in `package.json` via an `engines` field — confirmed absent; use a reasonably recent LTS). No global CLI tools required. MongoDB is optional — nothing to install if you skip it.

## 3. Environment variables

See [12-configuration-and-environment.md](12-configuration-and-environment.md) for the full table. Minimum viable `.env`:
```
GROQ_API_KEY=sk_...
```
Everything else has a working default.

## 4. How to run locally

```bash
npm run dev          # starts the API on :4000
```
Then open `http://localhost:4000` for the test console, or drive the API directly:
```bash
curl -X POST "http://localhost:4000/api/candidates/upload?phase=3" -F "resume=@/path/to/resume.pdf"
```

To reproduce the project's own documented experiments:
```bash
npm run baseline     # Phase 1 against all attacks/
npm run phase2       # Phase 2 against attacks/ + benign/
npm run phase3       # Phase 3 against attacks/ + benign/
```
Each of these makes real, billable Groq API calls.

## 5. How to run tests

```bash
npm test             # node --test test/ — fast, no API key or network needed
```
All 5 test files are pure unit tests with no external dependencies — safe to run repeatedly with no cost or setup.

## 6. How to debug

- There's no debugger config checked in; use `node --inspect src/server.js` or your editor's native Node debugging if you need to step through.
- Console output is your primary signal — see [17-error-handling-and-observability.md](17-error-handling-and-observability.md) for what gets logged where.
- To see exactly what a resume triggers without spending an LLM call, call `classifyDocument` directly in a scratch script, or watch the "Input classification" section of the test console's result panel — it shows every fired rule and every similarity match.
- To see the exact messages sent to the LLM, temporarily add a `console.log(JSON.stringify(messages, null, 2))` inside `llmClient.js`'s `runAgentLoop`, right before the `groq.chat.completions.create` call — there is no existing verbose/debug-logging flag to toggle this.

## 7. Where to make common changes

| I want to... | Change this |
|---|---|
| Change the job description / scoring rubric | `src/data/jobDescription.js` |
| Adjust classifier sensitivity | `src/classifier/rules.js` (add/edit regexes) or `src/classifier/index.js` (`SIMILARITY_THRESHOLD`, `SIMILARITY_MIN_MATCHES_TO_BLOCK`) |
| Add a new attack-phrase reference for the similarity check | `src/classifier/attackPhrases.js` |
| Change the model or its temperature | `src/agent/llmClient.js` (`MODEL` default, or the hardcoded `temperature: 0.2`) — or set `GROQ_MODEL` in `.env` for the model without a code change |
| Change any system prompt | `src/agent/prompts.js` |
| Add a new attack/benign fixture | drop a `.txt` file into `server/attacks/` or `server/benign/` — picked up automatically by `GET /api/samples` and the `scripts/run*.js` runners, no code change needed |
| Change what a valid evaluation looks like | `src/agent/reviewGate.js` (`VALID_RECOMMENDATIONS`, the score-bound tables) |
| Change what counts as a policy-compliant action | `src/agent/actionPolicy.js` |

## 8. How to add a new API endpoint

Add a route to `src/routes/candidates.js` or `src/routes/samples.js` (or a new router file, then mount it in `server.js` behind `requireApiKey` if it should be protected — see the existing `app.use("/api/...", requireApiKey, ...Router)` pattern). There is no controller/service scaffolding to follow — existing routes call agent-pipeline functions directly (see [05-api-architecture.md](05-api-architecture.md) for why this is the established pattern here, not a shortcut you're introducing).

## 9. How to modify database models

Edit `src/models/CandidateRun.js` directly — there's no migration tooling to run afterward (Mongoose applies schema changes lazily on next write; see [06-database-architecture.md](06-database-architecture.md)). If you add a required field, remember existing documents won't have it — Mongoose will apply the schema's `default` for it on read, but any field without a `default` will read as `undefined` for old documents.

## 10. How to modify AI behavior

- **Change what the model is told**: edit the relevant function in `prompts.js`. Remember there are 4 separate system prompts for 4 different call sites — a change to "the" system prompt likely means editing more than one function if you want it applied everywhere.
- **Change what the model can do**: edit `tools.js` (schemas) and the relevant `graph*.js` node's `tools: [...]` array passed to `runAgentLoop`.
- **Change how many tool-calling turns are allowed**: the `maxSteps` parameter passed to `runAgentLoop` (currently `5` for Phase 1/2's single-stage loop, `1` for Phase 3's evaluate stage).

## 11. How to add a new AI tool

1. Add its JSON schema to `tools.js` (follow the existing `send_email`/`write_to_ats` shape).
2. Add a real (or mocked) handler branch inside `executeTool`.
3. Bind it in the `tools: [...]` array of whichever `graph*.js` node should have access to it.
4. If it's meant to be restricted (like `send_email`/`write_to_ats` in Phase 3), make sure it is **not** included in the evaluate-stage's tool list — that's the entire mechanism the tool-allowlisting guardrail depends on.
5. If the tool's execution should be policy-checked, add a branch for it in `actionPolicy.js`'s `checkActionAgainstPolicy`.

## 12. How to modify guardrails

- **Classifier rules**: add a new object to the `RULES` array in `rules.js` with a unique `id`, a `description`, and a `pattern` regex. Keep patterns conservative (bracket/tag-anchored where possible) to avoid false positives — see the existing rules' comments for the reasoning.
- **Similarity corpus**: add plain-English attack-intent sentences to `attackPhrases.js`.
- **Review gate bounds**: edit the `MIN_SCORE_FOR_RECOMMENDATION`/`MAX_SCORE_FOR_RECOMMENDATION` tables in `reviewGate.js`.
- **Action policy rules**: add a new `if (toolName === "...")` branch in `actionPolicy.js` for any new tool that needs evaluation-consistency checking.
- After any guardrail change, run `npm test` — the existing unit tests will catch regressions in the parts they cover (see [14-testing-architecture.md](14-testing-architecture.md) for what they don't cover).

## 13. How to deploy

There is currently no deployment tooling in this repo — see [13-deployment-and-infrastructure.md](13-deployment-and-infrastructure.md) for exactly what's missing and what you'd need to add (a Dockerfile, a process manager, a secrets mechanism, TLS termination). The minimum viable path today is: provision a machine with Node.js, set the environment variables, run `npm install && npm run dev` behind a process supervisor of your choosing.
