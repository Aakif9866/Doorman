# 20 — Architecture Decisions

> Cross-links: [Codebase Architecture](03-codebase-architecture.md) · [Guardrails](10-guardrails-and-ai-safety.md) · [Knowledge Gaps](knowledge-gaps.md)

Each entry separates **known from code** (and, where available, git history) from **likely reasoning / inference**.

---

## Decision 1 — Three separate, duplicated pipeline files instead of one parameterized graph

**Known from code**: `graph.js`, `graphPhase2.js`, `graphPhase3.js` each define their own `StateGraph`, their own `AgentState` shape, and near-identical node functions (e.g. `readNode`'s body is duplicated near-verbatim between `graphPhase2.js` and `graphPhase3.js`).
**Likely reasoning / inference**: the git history shows each phase was built as its own commit, explicitly framed as a "before/after" comparison for a security write-up (see the README's results tables). Keeping each phase as a complete, independently-runnable file makes the *comparison* easy — you can run `npm run baseline` and `npm run phase3` and see genuinely different code paths, not one path with conditionals. This reads as a deliberate pedagogical/demonstrative choice, not an oversight.
**Alternatives**: a single graph with phase-conditional node inclusion (e.g., `if (phase >= 2) addNode("classify", ...)`).
**Trade-offs**: current approach = easy side-by-side comparison, but any fix to shared logic (e.g., the boundary-escaping bug fixed in the hardening commit) has to be reasoned about across multiple files, even though in that specific case the actual fix lived in the shared `prompts.js` and only needed one change. A unified graph would reduce duplication but make "run the undefended baseline" a less clean, single-command demonstration.
**Consequences**: real maintenance cost if this project grows a 4th/5th phase; acceptable cost at its current size (3 phases, ~200 lines each).

---

## Decision 2 — Guardrails implemented as deterministic code, not a second LLM

**Known from code**: `reviewGate.js` and `actionPolicy.js` are pure functions with no model calls; the classifier is regex + TF-IDF, not an ML classifier.
**Likely reasoning / inference**: the README states this philosophy directly — "the real control is limiting what the agent is allowed to do once it's fooled" — favoring deterministic, auditable checks over a second probabilistic layer (an "LLM judge") that could itself be fooled or simply be wrong non-deterministically. This is stated intent, not just inferred.
**Alternatives**: an LLM-as-judge step reviewing the evaluation for plausibility/groundedness (this is explicitly what the project's own unbuilt "Phase 4 — output scanning" would likely need to be, at least partially).
**Trade-offs**: deterministic checks are auditable, fast, and free, but structurally cannot catch a fabricated-yet-internally-consistent output — closing that gap likely requires *some* form of semantic/grounding check, which reintroduces probabilistic judgment somewhere in the pipeline. The project has not yet built this and is explicit that it's a harder problem.
**Consequences**: today's guardrails are strong against structural/capability-based attacks (can the model *do* something dangerous) and weak against content-based deception (is the model's *belief* about the resume correct) — a coherent, load-bearing distinction in this codebase.

---

## Decision 3 — Mocked tools instead of real email/ATS integrations

**Known from code**: `tools.js`'s `executeTool` for `send_email`/`write_to_ats` only `console.log`s and returns `{ok:true, mocked:true, ...}`.
**Likely reasoning / inference**: building real integrations (SMTP/SendGrid, a real or sandboxed ATS API) would add setup friction and unrelated failure modes to a project whose actual point is the guardrail architecture, not the integrations themselves. Mocking lets the project prove "the model attempted/was blocked from attempting X" without needing real infrastructure.
**Alternatives**: a sandboxed/fake but still-network-calling email service (e.g., Mailhog) for more realistic "did the HTTP call actually go out" testing.
**Trade-offs**: current approach is zero-setup and safe (no risk of actually emailing anyone during testing), but it also means the project has never had to grapple with what a *real* integration's own failure modes (SMTP errors, ATS API rate limits, partial failures) would do to the guardrail pipeline.
**Consequences**: if this project were ever extended toward production use, wiring in real integrations behind the existing `executeTool` dispatch point is a relatively contained change — but at that point, the "no truthfulness check" gap (see [10-guardrails-and-ai-safety.md](10-guardrails-and-ai-safety.md)) stops being theoretical.

---

## Decision 4 — MongoDB is optional, with a silent in-memory fallback

**Known from code**: `connectMongo()` catches its own connection errors and returns `false`; `storage.js` branches on `isConnected()` for every read/write.
**Likely reasoning / inference**: removes infrastructure setup friction for anyone cloning the repo to try it — "it just works" without a database. This is a demo-project-friendly choice.
**Alternatives**: require Mongo and fail fast at startup if it's unreachable (more typical for a "real" service).
**Trade-offs**: current approach trades data durability/consistency (in-memory data vanishes on restart, and multiple instances would diverge) for zero-setup convenience. Appropriate for the project's actual current use (a single locally-run demo); would need revisiting for any real deployment (see [16-performance-and-scalability.md](16-performance-and-scalability.md)).

---

## Decision 5 — Structured output via forced tool-calling, not JSON mode

**Known from code**: `submit_evaluation` is a tool with `tool_choice` forced to it, rather than the request using `response_format: {type: "json_object"}` with a plain-text prompt asking for JSON.
**Likely reasoning / inference**: tool-calling is the same mechanism already needed for `send_email`/`write_to_ats`, so reusing it for structured output avoids introducing a second output-parsing code path. It also composes naturally with the "restrict what's bound" allowlisting strategy — a "fake tool" used purely for schema-enforced output fits the same mental model as a real action tool.
**Alternatives**: JSON mode, or a dedicated structured-output library/schema validator (e.g., zod, which is present as a transitive dependency but never imported in application code — see [knowledge-gaps.md](knowledge-gaps.md)).
**Trade-offs**: tool-calling reliability depends on the provider's own function-calling implementation; the project compensates with its own post-hoc `reviewEvaluation` validation rather than trusting the schema was honored, which is a sound defensive layering regardless of which output mechanism was chosen.

---

## Decision 6 — No authentication by default

**Known from code**: `API_KEY` defaults to unset in `.env.example`; `requireApiKey` no-ops when unset.
**Likely reasoning / inference**: for a project meant to be cloned and run locally in minutes, requiring auth setup before the demo works would add friction with no benefit in a localhost-only context.
**Trade-offs**: explicitly and correctly documented by the code's own comments as unsuitable beyond local/demo use — this isn't a case of the code overclaiming; the honesty here is a plus.

---

## Decision 7 — Rule-matching classifier kept deliberately conservative in wording

**Known from code**: `rules.js`'s comment states patterns require bracket/tag-style markers (`[SYSTEM]`) rather than bare words like "system," specifically to avoid false-positiving on resumes mentioning "system design" or "operating system." The benign fixture `01-strong-match.txt` even includes a deliberate "operating system internals" hobby-project mention to test this.
**Likely reasoning / inference**: false positives on legitimate resumes (rejecting a qualified candidate because their resume happened to use a flagged word) would be as damaging to the pipeline's credibility as false negatives, so the classifier's precision was tuned conservatively on purpose, accepting some recall loss.
**Consequences**: this is a real, demonstrated trade-off, not just a stated intent — `test/classifier.test.js` has an explicit negative test proving the "operating system internals" case doesn't trigger a rule.

---

## Decision 8 — A dependency-free, hand-rolled TF-IDF similarity check instead of real embeddings

**Known from code + git history**: the `a28624a` commit message states `@huggingface/transformers` was evaluated and rejected because its `onnxruntime-node`/`sharp` transitive dependencies carry unresolved high-severity CVEs for image-preprocessing capability this text-only classifier never uses.
**This is confirmed, not inferred** — the reasoning is stated directly in both the commit message and code comments.
**Trade-offs**: real sentence embeddings would likely catch paraphrased attacks with no shared vocabulary at all (a case the current lexical approach explicitly cannot catch), at the cost of introducing a dependency with a currently-unacceptable CVE profile for a security-focused project. The project chose precision over recall on its supply-chain risk, and accepted a weaker (but zero-dependency) similarity signal as a result.
