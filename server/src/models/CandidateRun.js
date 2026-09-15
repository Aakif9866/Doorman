import mongoose from "mongoose";

const ToolCallSchema = new mongoose.Schema(
  {
    name: String,
    args: mongoose.Schema.Types.Mixed,
    result: mongoose.Schema.Types.Mixed,
  },
  { _id: false }
);

// One document per resume run through the agent. `ruleFired`/`allowed` are
// no-ops in Phase 1 (no guardrails exist yet) but the shape stays stable so
// Phase 2+ guardrail layers just start populating them.
const CandidateRunSchema = new mongoose.Schema({
  candidateId: String,
  fileName: String,
  jobTitle: String,
  resumeText: String,
  finalMessage: String,
  toolCalls: [ToolCallSchema],
  phase: { type: String, default: "phase1-baseline" },
  ruleFired: { type: String, default: "none" },
  allowed: { type: Boolean, default: true },
  classification: { type: mongoose.Schema.Types.Mixed, default: null },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("CandidateRun", CandidateRunSchema);
