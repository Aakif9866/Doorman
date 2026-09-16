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

// resumeText is excluded here deliberately — it's the candidate's raw PII,
// and this is a listing endpoint with no per-run access control. Full-text
// access to a specific run would need its own authorization story (only the
// recruiter who owns that requisition, an audit trail, a retention policy),
// none of which exists yet. Everything needed to understand a decision
// (rules fired, evaluation, review outcome, actions taken) doesn't depend on
// the raw text being present here.
export async function getAllRuns() {
  if (isConnected()) {
    return CandidateRun.find().select("-resumeText").sort({ createdAt: -1 }).lean();
  }
  return [...inMemoryRuns].reverse().map(({ resumeText, ...rest }) => rest);
}
