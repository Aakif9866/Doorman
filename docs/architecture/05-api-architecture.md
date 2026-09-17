# 05 — API Architecture

> Cross-links: [Data Flow](04-data-flow.md) · [Authentication](07-authentication-authorization.md) · [Codebase Architecture](03-codebase-architecture.md)

## General API architecture

There is **no Route → Controller → Service → Repository layering**. The actual pattern is:

```
Route handler (routes/*.js)
  → directly calls the agent pipeline function (agent/graph*.js)
      → which internally calls the classifier, the LLM client, the review gate, the action policy
      → and calls storage.saveRun() itself, from inside the graph's persist node
  → route handler serializes the graph's returned state to JSON
```

This means the route handler is thin (parse input, pick a pipeline, call it, shape the response, catch errors) and almost all logic — including the database write — happens inside `agent/graph*.js`, not in the route file. If you're looking for "where is the database write for a new run," it's **not** in `routes/candidates.js` — it's in `persistNode` inside whichever `graph*.js` ran.

Every endpoint requires `requireApiKey` (see [07-authentication-authorization.md](07-authentication-authorization.md)) except the frontend's own static files and `/health`.

---

## Candidates API (`server/src/routes/candidates.js`)

### `POST /api/candidates/upload`

- **Auth**: `requireApiKey`
- **Query params**: `phase` (`1`, `2`, or `3`; anything else, including omitted, defaults to Phase 3 via `PIPELINES[req.query.phase] || evaluateResumePhase3`)
- **Request**: `multipart/form-data`
  - `resume` (file, required — field name is load-bearing, `upload.single("resume")`)
  - `candidateId` (optional; defaults to the filename with its extension stripped)
  - `jobDescription` (optional; defaults to `data/jobDescription.js`'s hardcoded text)
- **Validation**: `multer` enforces a 5MB size limit (`limits: {fileSize: 5*1024*1024}`); missing file → explicit `400 {error: "No resume file uploaded (field name: 'resume')."}`. No validation on `candidateId`/`jobDescription` content (any string is accepted).
- **Internal execution path**: `extractResumeText(buffer, mimetype)` → `evaluate({fileName, resumeText, jobDescription, candidateId})` where `evaluate` is whichever pipeline function was selected.
- **Database operations**: one `saveRun(...)` call, from inside the pipeline (not visible in this file).
- **External services**: 0–2 Groq API calls, depending on phase and whether the classifier blocks.
- **Response** (200):
  ```json
  {
    "candidateId": "string",
    "fileName": "string",
    "finalMessage": "string",
    "toolCalls": [{"name": "string", "args": {}, "result": {}}],
    "classification": { "...": "or null (Phase 1)" },
    "evaluation": { "...": "or null (Phase 1/2, or blocked)" },
    "review": { "...": "or null (Phase 1/2, or blocked before review)" }
  }
  ```
- **Error responses**: `400` (no file), `500 {error: err.message}` for anything else thrown (LLM failure, parse failure, DB failure) — the message is the raw `Error.message`, not a sanitized/generic string. See [15-security-architecture.md](15-security-architecture.md) for the information-disclosure implication of this.

### `GET /api/candidates/`

- **Auth**: `requireApiKey`
- **Request**: none (no query params, no pagination, no filtering)
- **Internal execution path**: `getAllRuns()` → Mongo `find().select("-resumeText").sort({createdAt:-1}).lean()`, or the reversed in-memory array with `resumeText` stripped.
- **Response** (200): a JSON array of every persisted run (all candidates, all time — no scoping by requester), each with `resumeText` omitted.
- **Error responses**: none explicitly handled — a Mongo query failure here is uncaught within the route and would surface as an unhandled promise rejection unless Express's own error handling catches it (this route has no `try/catch`, unlike `POST /upload`). *(Confirmed by reading the file: no try/catch wraps this handler.)*

---

## Samples API (`server/src/routes/samples.js`)

### `GET /api/samples`

- **Auth**: `requireApiKey`
- **Request**: none
- **Internal execution path**: `fs.readdirSync` on `server/attacks/` and `server/benign/`, filtered to `.txt`, sorted.
- **Response** (200): `{"attacks": ["01-direct-override.txt", ...], "benign": ["01-strong-match.txt", ...]}`
- **Error responses**: none explicit — a filesystem error here (e.g. missing directory) would throw synchronously and crash the request with an unhandled exception, since there's no try/catch around this handler either.

### `POST /api/samples/evaluate`

- **Auth**: `requireApiKey`
- **Request** (JSON): `{"category": "attacks"|"benign", "file": "01-direct-override.txt", "phase": "1"|"2"|"3"}`
- **Validation**:
  - `category` must map to a known directory (`CATEGORY_DIRS`) → `400` otherwise.
  - The resolved file path must both start with the category directory **and** exist on disk → `404` otherwise. This is the project's one path-traversal guard; see [15-security-architecture.md](15-security-architecture.md) for a note on the guard's general fragility (not currently exploitable here, since `category` only ever resolves to one of two hardcoded absolute paths).
- **Internal execution path**: `fs.readFileSync(filePath, "utf-8")` → same pipeline dispatch as the upload route.
- **Response** (200): same shape as `/upload`, plus `resumeText` (echoed back, since these are non-sensitive fixtures).
- **Error responses**: `400` (unknown category), `404` (file not found / traversal attempt), `500 {error: err.message}` for anything else (wrapped in try/catch, unlike the two `GET` routes above).

---

## Cross-cutting notes

- **No versioning** — routes are `/api/...`, not `/api/v1/...`; a breaking change to the response shape would affect all callers with no migration path.
- **No request-ID / correlation-ID header** — an error response and a server-side `console.error` for the same failure have no shared identifier to correlate them (relevant for [17-error-handling-and-observability.md](17-error-handling-and-observability.md)).
- **No OpenAPI/Swagger spec** — this document is currently the only API reference.
- **Inconsistent error-handling coverage**: `POST /api/candidates/upload` and `POST /api/samples/evaluate` wrap their logic in `try/catch`; `GET /api/candidates/` and `GET /api/samples` do not. This is an asymmetry worth knowing about if either GET route's underlying call ever throws (see [knowledge-gaps.md](knowledge-gaps.md)).
