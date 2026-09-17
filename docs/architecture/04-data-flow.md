# 04 — Data Flow

> Cross-links: [System Architecture](02-system-architecture.md) · [AI Architecture](08-ai-architecture.md) · [API Architecture](05-api-architecture.md)

This document traces complete, real request flows end to end, at the level of what data looks like at each step.

## Flow 1 — Uploading a resume through Phase 3 (the default, most important flow)

```mermaid
sequenceDiagram
    participant U as User (browser)
    participant API as Express route (candidates.js)
    participant Parse as parseResume.js
    participant Classify as classifier/index.js
    participant G as graphPhase3.js
    participant LLM1 as Groq (evaluate)
    participant Gate as reviewGate.js
    participant LLM2 as Groq (act)
    participant Policy as actionPolicy.js
    participant Tools as tools.js (mocked)
    participant DB as storage.js

    U->>API: POST /api/candidates/upload?phase=3 (multipart: resume file)
    API->>API: requireApiKey (middleware)
    API->>Parse: extractResumeText(buffer, mimetype)
    Parse-->>API: resumeText: string
    API->>G: evaluateResumePhase3({fileName, resumeText, jobDescription, candidateId})
    G->>Classify: classifyDocument(resumeText)
    Classify-->>G: {decision, firedRules, ruleMatches, similarityMatches}

    alt decision === "block"
        G->>DB: saveRun(... allowed:false ...)
        G-->>API: {finalMessage: "Blocked...", toolCalls: []}
    else decision === "allow"
        G->>G: wrapUntrustedDocument(fileName, resumeText)
        G->>LLM1: messages incl. <candidate_document>, tools=[read_resume, submit_evaluation], tool_choice FORCED
        LLM1-->>G: tool_call submit_evaluation({score, recommendation, justification})
        G->>Gate: reviewEvaluation(evaluation)
        alt review fails
            Gate-->>G: {passed:false, reason}
            G->>DB: saveRun(... allowed:false ...)
            G-->>API: {finalMessage: "Evaluation failed review...", evaluation, review}
        else review passes
            Gate-->>G: {passed:true}
            G->>LLM2: fresh messages (evaluation JSON only, no resume text), tools=[send_email, write_to_ats]
            LLM2-->>G: tool_calls (0 or more)
            loop each tool call
                G->>Policy: checkActionAgainstPolicy(name, args, {evaluation, candidateId, candidateEmail})
                alt policy denies
                    Policy-->>G: {allowed:false, reason}
                    G->>G: refuse, do not execute
                else policy allows
                    Policy-->>G: {allowed:true}
                    G->>Tools: executeTool(name, args)
                    Tools-->>G: {ok:true, mocked:true, ...} (console.log only)
                end
            end
            G->>DB: saveRun(... allowed:true, evaluation, review, toolCalls ...)
            G-->>API: {finalMessage, toolCalls, evaluation, review}
        end
    end
    API-->>U: 200 JSON
```

**Starting point**: an HTTP `multipart/form-data` POST with a file field named `resume`.
**Transformations**: file buffer → plain text (`extractResumeText`) → classification metadata → (if allowed) an escaped/wrapped document string embedded in a synthetic tool-result message → a structured evaluation object → a validated evaluation → a fresh, minimal message list → zero or more tool-call attempts → policy-checked, possibly-refused tool executions.
**Validation**: classifier rules/similarity (pre-LLM), `reviewEvaluation` shape/range/consistency (post-LLM #1), `checkActionAgainstPolicy` consistency (post-LLM #2). None of these validate that the justification is *true*.
**Business logic**: entirely inside `graphPhase3.js`'s node functions — there is no separate "service layer" beyond this.
**Database operations**: exactly one write per run, `saveRun(...)`, at the very end regardless of outcome (blocked, review-failed, or completed).
**External calls**: up to two Groq API calls (evaluate, act) — zero if the classifier blocks the document.
**Error handling**: none inside the graph nodes themselves; a thrown error (bad API key, network failure, DB write failure) propagates up to the route handler's `try/catch`, becoming a `500 {error: err.message}` response. See [17-error-handling-and-observability.md](17-error-handling-and-observability.md).
**Final output**: a JSON object containing `candidateId`, `fileName`, `finalMessage`, `toolCalls`, `classification`, `evaluation`, `review`.

## Flow 2 — Running a built-in fixture (test console "Run sample" button)

Same graph, different entry point: `POST /api/samples/evaluate` with JSON `{category, file, phase}` instead of a multipart upload. `routes/samples.js` reads the fixture file directly off disk (`fs.readFileSync`) instead of calling `parseResume.js` — fixtures are always plain `.txt`, never PDFs, so this path skips the magic-byte sniffing step entirely. Everything downstream (classify → evaluate → gate → act) is identical to Flow 1. The response additionally echoes back `resumeText` (the samples endpoint has no PII-exposure concern the way `GET /api/candidates` does, since these are synthetic fixtures, not real candidate data).

## Flow 3 — Listing past runs

```mermaid
sequenceDiagram
    participant U as Client
    participant API as GET /api/candidates/
    participant St as storage.js
    participant DB as MongoDB or in-memory array

    U->>API: GET /api/candidates/
    API->>St: getAllRuns()
    St->>DB: find().select("-resumeText").sort({createdAt:-1}) [or reverse in-memory array]
    DB-->>St: run documents, resumeText stripped
    St-->>API: array of runs
    API-->>U: 200 JSON array
```

**Important detail**: `resumeText` is explicitly excluded (`storage.js:27,29`) because this endpoint has no per-run access control — but every other field (including `evaluation.justification`, the mocked `send_email` recipient address, and `classification` detail) is returned unfiltered to any caller who can pass the `requireApiKey` check (or to anyone, if `API_KEY` is unset). See [15-security-architecture.md](15-security-architecture.md).

## Flow 4 — The Phase 1 (undefended) flow, for contrast

```mermaid
flowchart LR
    A[resumeText] --> B["readNode: concatenated into ONE user message, no boundary, no framing"]
    B --> C["Groq call: tools=[send_email, write_to_ats] bound from the FIRST turn"]
    C --> D["executeTool - mocked, but would be real if wired up"]
    D --> E[persistNode]
```

No classification, no isolation, no separate evaluate/act split, no review gate, no action policy. This is the intentional "before" picture — every guardrail discussed elsewhere in this doc set is something Phase 2/3 *adds* relative to this baseline.

## Request/response schemas at each transformation point

See [06-database-architecture.md](06-database-architecture.md) for the persisted schema and [05-api-architecture.md](05-api-architecture.md) for the full request/response contracts of each endpoint.
