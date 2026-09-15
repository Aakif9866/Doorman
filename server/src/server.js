import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import { connectMongo } from "./db/mongo.js";
import candidatesRouter from "./routes/candidates.js";
import samplesRouter from "./routes/samples.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/candidates", candidatesRouter);
app.use("/api/samples", samplesRouter);
app.use(express.static(path.join(__dirname, "..", "..", "client")));

app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 4000;

connectMongo().finally(() => {
  app.listen(PORT, () => console.log(`[server] Doorman API listening on :${PORT}`));
});
