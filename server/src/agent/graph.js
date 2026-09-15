import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { buildSystemPrompt } from "./prompts.js";
import { toolSchemas, executeTool } from "./tools.js";
import { runAgentLoop } from "./llmClient.js";
import { saveRun } from "../storage.js";

// PHASE 1 state shape. Kept deliberately flat/generic so later phases can add
// fields (classifierFlags, toolAllowlist, outputScanResult, ...) without
// reshaping the graph.
const AgentState = Annotation.Root({
  fileName: Annotation({ default: () => "" }),
  resumeText: Annotation({ default: () => "" }),
  jobDescription: Annotation({ default: () => "" }),
  candidateId: Annotation({ default: () => "" }),
  messages: Annotation({ default: () => [] }),
  finalMessage: Annotation({ default: () => "" }),
  toolCalls: Annotation({ default: () => [] }),
});

// Node 1: "read" — builds the model context.
// VULNERABILITY (by design, Phase 1): the system prompt and the untrusted
// resume text are concatenated into the same message list with no structural
// separation and no isolation framing. This is exactly what Phase 2 removes.
function readNode(state) {
  const system = buildSystemPrompt(state.jobDescription);
  const messages = [
    { role: "system", content: system },
    {
      role: "user",
      content: `Candidate resume (source file: ${state.fileName}, candidateId: ${state.candidateId}):\n\n${state.resumeText}`,
    },
  ];
  return { messages };
}

// Node 2: "scoreAndAct" — the model scores AND has send_email/write_to_ats
// bound in the same turn. VULNERABILITY (Phase 1): tools are not gated behind
// a separate reviewed step, so a manipulated model can act immediately.
async function scoreAndActNode(state) {
  const { finalMessage, toolCalls } = await runAgentLoop({
    messages: state.messages,
    tools: toolSchemas,
    executeTool,
  });
  return { finalMessage, toolCalls };
}

// Node 3: "persist" — structured logging of every run (§4 layer 5), even
// though no guardrail rules exist yet to record.
async function persistNode(state) {
  await saveRun({
    candidateId: state.candidateId,
    fileName: state.fileName,
    jobTitle: "Senior Backend Engineer",
    resumeText: state.resumeText,
    finalMessage: state.finalMessage,
    toolCalls: state.toolCalls,
    phase: "phase1-baseline",
    ruleFired: "none",
    allowed: true,
  });
  return {};
}

const graph = new StateGraph(AgentState)
  .addNode("read", readNode)
  .addNode("scoreAndAct", scoreAndActNode)
  .addNode("persist", persistNode)
  .addEdge(START, "read")
  .addEdge("read", "scoreAndAct")
  .addEdge("scoreAndAct", "persist")
  .addEdge("persist", END)
  .compile();

export async function evaluateResume({ fileName, resumeText, jobDescription, candidateId }) {
  return graph.invoke({ fileName, resumeText, jobDescription, candidateId });
}

export default graph;
