# 12 — Configuration & Environment

> Cross-links: [External Integrations](11-external-integrations.md) · [Deployment](13-deployment-and-infrastructure.md) · [Developer Guide](18-developer-guide.md)

## Environment variables (complete list — confirmed from `.env.example` and every `process.env.*` reference in `src/`)

| Variable | Purpose | Required? | What happens if missing | Format |
|---|---|---|---|---|
| `GROQ_API_KEY` | Auth to Groq's LLM API | Effectively yes — any code path that calls the LLM will throw without it | The `Groq` SDK client is still constructed (no startup check in `server.js`/`llmClient.js`), but the first `chat.completions.create()` call throws, surfacing as a `500` on the API or an immediate `process.exit(1)` in the `scripts/run*.js` CLI runners (which explicitly check for it first) | opaque secret string |
| `GROQ_MODEL` | Selects the Groq-hosted model | No | Defaults to `"openai/gpt-oss-120b"` | model ID string |
| `MONGO_URI` | Enables MongoDB persistence | No | `connectMongo()` logs a warning and the app runs with in-memory storage (data lost on restart) | Mongo connection string |
| `PORT` | HTTP listen port | No | Defaults to `4000` | integer |
| `API_KEY` | Enables the `x-api-key` shared-secret check | No | Unset = **no authentication at all**, a startup warning is logged | opaque secret string |
| `ALLOWED_ORIGIN` | Enables CORS for a separate frontend origin | No | Unset = no CORS headers added at all (fine for the same-origin test console; would break a separately-hosted frontend) | origin URL, e.g. `https://example.com` |

No other environment variables are read anywhere in `server/src/` — confirmed by searching every `process.env.*` occurrence.

## Configuration files

- **`server/.env`** — the actual, gitignored local configuration (never committed; confirmed via `.gitignore`).
- **`server/.env.example`** — the template, checked into git, all secret values blank.
- **`server/package.json`** — `scripts` define the only "configuration" of *how* the app runs (`dev`, `baseline`, `phase2`, `phase3`, `test`); there is no separate `config/` directory, no `config.js`, no environment-specific config files (`config.production.json`, etc.).

There is **no centralized configuration module** — every file that needs an env var reads `process.env.X` directly at the point of use (`llmClient.js` reads `GROQ_API_KEY`/`GROQ_MODEL` at module load; `server.js` reads `PORT`/`API_KEY`/`ALLOWED_ORIGIN`; `db/mongo.js` reads `MONGO_URI`; `middleware/auth.js` reads `API_KEY` again, redundantly with `server.js`'s reference to it). This means there's no single place to see "everything this app depends on from the environment" other than grepping for `process.env` or reading this document.

## Development vs. production configuration

**There is no distinction in code.** No `NODE_ENV` check appears anywhere in `server/src/` — the app behaves identically regardless of environment. This is worth knowing explicitly: things you might expect to be dev-only (verbose console logging of mocked email bodies, the permissive default of no authentication) are **not** gated behind an environment check and would carry into a "production" deployment exactly as-is unless you added such a check yourself.

## Secrets

Only two values in this system are secrets in the security sense: `GROQ_API_KEY` and `API_KEY`. Both are read from environment variables and never logged, printed, or returned in any API response (confirmed — no code path echoes either value back). `MONGO_URI` may embed database credentials in its connection string and should be treated with the same care, though the code itself doesn't specifically call this out.

## Feature flags

**None exist.** There is no feature-flag system, no `LaunchDarkly`/`Flagsmith`/env-var-based toggle for individual features. The closest analog is the `?phase=1|2|3` query parameter, which selects an entire pipeline rather than toggling a discrete feature — this is a demo/comparison mechanism, not a feature-flag system.

## Service URLs

There are no configurable service URLs beyond what `groq-sdk` and `mongoose` derive internally from `GROQ_API_KEY`/`MONGO_URI` — no separately configurable base URL for Groq (it's fixed inside the SDK), no configurable ATS/email endpoint (those integrations don't exist — see [11-external-integrations.md](11-external-integrations.md)).

## What each configuration variable actually controls

- **Model selection**: `GROQ_MODEL` only. Guardrail thresholds, temperature, and the job description itself are **not** environment-configurable — they're hardcoded constants in `classifier/index.js` (`SIMILARITY_THRESHOLD = 0.35`, `SIMILARITY_MIN_MATCHES_TO_BLOCK = 2`), `llmClient.js` (`temperature: 0.2`), and `data/jobDescription.js` respectively. Changing any of these requires a code change and redeploy, not a config change.
- **AI behavior**: model choice only (`GROQ_MODEL`); nothing else about the AI's behavior is externally configurable.
- **Guardrails**: not configurable via environment at all — see above.
- **Logging**: not configurable — there's no `LOG_LEVEL` and no logging library to configure.
- **Database**: `MONGO_URI` (connect or don't).
- **Authentication**: `API_KEY` (enforce or don't).
- **External APIs**: `GROQ_API_KEY`, `GROQ_MODEL`.

## Practical checklist for a new environment

1. Copy `server/.env.example` to `server/.env`.
2. Set `GROQ_API_KEY` (required for anything beyond the classifier/UI shell to work).
3. Leave `MONGO_URI` unset for a zero-infrastructure quick start, or point it at a real Mongo instance for persistence across restarts.
4. Leave `API_KEY` unset for local development; set it before exposing the server beyond localhost.
5. Only set `ALLOWED_ORIGIN` if you're running a separate frontend dev server against this API — the bundled `client/index.html` needs it unset.
