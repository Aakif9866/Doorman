import { isConnected } from "./db/mongo.js";
import CandidateRun from "./models/CandidateRun.js";

// Falls back to an in-memory array when Mongo isn't configured, so the
// baseline script and API route work identically with or without a DB.
const inMemoryRuns = [];

export async function saveRun(run) {
  if (isConnected()) {
    const doc = await CandidateRun.create(run);
    return doc.toObject();
  }
  const record = { ...run, createdAt: new Date() };
  inMemoryRuns.push(record);
  return record;
}

export async function getAllRuns() {
  if (isConnected()) {
    return CandidateRun.find().sort({ createdAt: -1 }).lean();
  }
  return [...inMemoryRuns].reverse();
}
