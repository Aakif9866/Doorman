# 15 — Security Architecture

> Cross-links: [Guardrails & AI Safety](10-guardrails-and-ai-safety.md) · [Authentication](07-authentication-authorization.md) · [Knowledge Gaps](knowledge-gaps.md)

This document separates **implemented protections** (confirmed in code) from **potential weaknesses** (confirmed absence of a protection, or a fragile pattern) — no vulnerability is claimed here without pointing at the specific code that demonstrates it.

## Implemented protections (confirmed)

| Protection | Where | Note |
|---|---|---|
| Prompt-injection input classification | `classifier/rules.js`, `similarity.js` | Blocks known/paraphrased patterns before the LLM runs; see [10](10-guardrails-and-ai-safety.md) |
| Structural tool-result framing + boundary escaping | `agent/prompts.js` `wrapUntrustedDocument` | Unit-tested (`test/documentBoundary.test.js`) against literal-tag-injection and script-injection via filename |
| Per-context tool allowlisting | `agent/graphPhase3.js`, `agent/tools.js` | Dangerous tools structurally absent from the evaluate-stage API request |
| Dispatch-time tool-name re-verification | `agent/llmClient.js` | Independent of provider `tools`/`tool_choice` enforcement |
| Post-hoc output shape/consistency validation | `agent/reviewGate.js` | Fails closed on malformed/inconsistent evaluations |
| Post-hoc action/evaluation consistency check | `agent/actionPolicy.js` | Fails closed on mismatched tool calls |
| XSS escaping in the test console | `client/index.html`, `escapeHtml()` | Applied at every dynamic `innerHTML` interpolation site currently in the file |
| CORS disabled by default | `server.js` | Only enabled, single-origin, if `ALLOWED_ORIGIN` is explicitly set |
| File-type sniffing by magic bytes | `utils/parseResume.js` | Ignores the client-supplied, attacker-controlled `mimetype` |
| PII exclusion from the listing endpoint | `storage.js` `getAllRuns` | `resumeText` explicitly `.select("-resumeText")` / destructured out |
| Optional shared-secret API gate | `middleware/auth.js` | See caveats in [07](07-authentication-authorization.md) |
| No secrets in the repository | `.gitignore` excludes `.env`; `.env.example` ships with blank values | Confirmed by inspection — I did not find any hardcoded credential in source |
| No SQL/command injection surface | No raw SQL, no `child_process`/`exec` usage anywhere in `src/` | Confirmed by exhaustive search |
| No SSRF surface | No user-controlled outbound URL fetch anywhere; the only outbound call is to Groq's fixed SDK endpoint | Confirmed |

## Potential weaknesses / areas to investigate (confirmed gaps, not exploited-in-the-wild findings)

### 1. No content-truthfulness / hallucination check on AI output
**Evidence**: `reviewGate.js` and `actionPolicy.js` both check shape/consistency, never whether `justification` reflects `resumeText`'s real content (confirmed by reading both files in full — neither references `resumeText` or `state.resumeText` at all). **Impact**: a self-consistent but fabricated evaluation passes every code guardrail. This is the project's own most-repeated caveat, and I verified it's accurate.

### 2. `GET /api/candidates/` has no per-caller scoping
**Evidence**: `routes/candidates.js`'s `router.get("/")` calls `getAllRuns()` with no filter, no pagination, no owner/tenant concept anywhere in `CandidateRun`'s schema. **Impact**: any caller who passes `requireApiKey` (or anyone, if `API_KEY` is unset — the documented default) can read every candidate's score, recommendation, justification text, and the mocked email address used for `send_email`, across the entire history of the deployment. The project's own README only calls out the (already-fixed) `resumeText` exposure; this broader scoping gap is not mentioned there.

### 3. Raw error messages returned to API callers
**Evidence**: `routes/candidates.js` and `routes/samples.js` both do `res.status(500).json({ error: err.message })` with no message sanitization. **Impact**: internal error text (potential stack-adjacent detail, provider error strings from Groq, filesystem-path hints from `samples.js`) reaches any caller, again with no auth required by default.

### 4. No rate limiting
**Evidence**: no rate-limiting middleware in the dependency tree (`express-rate-limit` etc. absent from `package-lock.json`) or route chain. **Impact**: the upload endpoint triggers a real, billable Groq API call per request with no throttling — both an availability and a cost-abuse exposure, worse given point 5 below (no auth by default).

### 5. No authentication by default
**Evidence**: `API_KEY` is blank in `.env.example`; `middleware/auth.js`'s `requireApiKey` becomes a no-op when unset; `server.js` only logs a console warning, does not refuse to start. **Impact**: the out-of-the-box configuration is fully open. See [07-authentication-authorization.md](07-authentication-authorization.md).

### 6. PII with no retention policy
**Evidence**: `CandidateRun` schema has no TTL index, and there is no delete/update code path anywhere in the repository (confirmed — no `.deleteOne`/`.deleteMany`/`.updateOne` calls exist). **Impact**: resumes and their extracted content, once persisted to Mongo, remain indefinitely with no expiry or data-subject-deletion mechanism.

### 7. PII in server logs
**Evidence**: `tools.js`'s mocked `send_email`/`write_to_ats` handlers `console.log` the candidate's derived email address and a truncated email body on every run. **Impact**: if this were deployed behind log aggregation, candidate PII would flow into logs unredacted. Not mentioned in the project's own "known limitations" list.

### 8. Fragile (not currently exploitable) path-construction pattern
**Evidence**: `routes/samples.js` does `path.join(dir, file)` then checks `filePath.startsWith(dir)` — a string-prefix check rather than `path.relative`-based containment. **Current exploitability**: none — `dir` only ever resolves to one of two hardcoded absolute paths (`.../attacks`, `.../benign`) with no sibling directory sharing a name prefix, and `file` ultimately still has to pass an `fs.existsSync` check. **Why it's still worth flagging**: this exact pattern is a well-known path-traversal anti-pattern that becomes exploitable the moment the surrounding constraints change (e.g., a future third category directory named similarly, or `dir` becoming dynamic).

### 9. Static, inspectable guardrail thresholds
**Evidence**: `SIMILARITY_THRESHOLD = 0.35`, `SIMILARITY_MIN_MATCHES_TO_BLOCK = 2`, and the full 12-phrase reference corpus in `attackPhrases.js` are all plain, unobfuscated constants in an open-source repo. **Impact**: inherent to any rules/lexical-similarity approach — an adversary with access to this code can craft text designed to score just under threshold. The project's own README acknowledges the similarity check is "a supplemental signal, not a strong classifier on its own," which is consistent with this.

### 10. Single-process, non-thread-safe in-memory fallback
**Evidence**: `storage.js`'s `inMemoryRuns` is a plain module-level array. **Impact**: not a security bug in the traditional sense, but a correctness gap under multi-instance deployment (each instance would have a different view of run history) — relevant if this is ever scaled horizontally without also configuring `MONGO_URI`.

## Explicitly checked and confirmed NOT present

- SQL injection (no raw SQL anywhere)
- Command injection (no `exec`/`child_process` usage)
- SSRF (no user-controlled outbound requests)
- CSRF (not applicable in the traditional sense — there's no session/cookie-based auth for a CSRF attack to ride on; the API uses a header-based shared secret, which is not automatically attached by a browser the way a cookie is)
- Client-side XSS in the shipped test console (fixed, verified)
- Open CORS (fixed, verified — off by default)
- Client-controlled file-type trust (fixed, verified — magic-byte sniffing)

## AI-specific security summary

Covered in depth in [10-guardrails-and-ai-safety.md](10-guardrails-and-ai-safety.md). The short version: insecure tool calling and excessive tool permissions are **well mitigated** here (multiple independent, code-level layers — a genuine architectural strength of this project). Trusting LLM-generated decisions **is** a real, acknowledged gap: nothing in the codebase verifies that the model's stated reasoning is grounded in the actual input document.

## Needs further investigation (I could not determine this from static reading alone)

- Real-world behavior of `groq-sdk`'s default timeout/retry settings (lives inside `node_modules`, not this repo's code — not traced).
- Whether current transitive dependencies carry any unpatched CVEs beyond the `@huggingface/transformers` one the project already evaluated and deliberately avoided (would require running `npm audit` against a live registry, not done as part of this static review).
- Actual behavior under a genuinely adversarial, large-scale red-team corpus — the project's own numbers (0/7, 3/6, etc.) come from small, single-run, hand-crafted samples, explicitly flagged by the README itself as not statistically meaningful.
