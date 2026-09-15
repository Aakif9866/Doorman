import "dotenv/config";
import express from "express";
import cors from "cors";
import { connectMongo } from "./db/mongo.js";
import candidatesRouter from "./routes/candidates.js";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/candidates", candidatesRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 4000;

connectMongo().finally(() => {
  app.listen(PORT, () => console.log(`[server] Doorman API listening on :${PORT}`));
});
