import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import { connectMongo } from "./db/mongo.js";
import candidatesRouter from "./routes/candidates.js";
import samplesRouter from "./routes/samples.js";
import { requireApiKey } from "./middleware/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// The test console is served from this same origin, so it needs no CORS
// headers at all. ALLOWED_ORIGIN exists only for running a separate frontend
// dev server (e.g. a future Vite dashboard on another port) against this
// API. Previously this was app.use(cors()) with no origin argument, which
// reflects and allows every origin — that's wrong for an API that can
// trigger paid LLM calls and returns stored resume data.
if (process.env.ALLOWED_ORIGIN) {
  app.use(cors({ origin: process.env.ALLOWED_ORIGIN }));
}

app.use(express.json());

if (!process.env.API_KEY) {
  console.warn(
    "[server] API_KEY not set — /api routes are unauthenticated. Fine for local/demo use, not for a public deployment."
  );
}

app.use("/api/candidates", requireApiKey, candidatesRouter);
app.use("/api/samples", requireApiKey, samplesRouter);
app.use(express.static(path.join(__dirname, "..", "..", "client")));

app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 4000;

connectMongo().finally(() => {
  app.listen(PORT, () => console.log(`[server] Doorman API listening on :${PORT}`));
});
