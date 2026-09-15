import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { buildIsolatedSystemPrompt, wrapUntrustedDocument } from "./prompts.js";
import { toolSchemas, readResumeToolSchema, executeTool } from "./tools.js";
import { runAgentLoop } from "./llmClient.js";
import { saveRun } from "../storage.js";
import { classifyDocument } from "../classifier/index.js";

const AgentState = Annotation.Root({
  fileName: Annotation({ default: () => "" }),
  resumeText: Annotation({ default: () => "" }),
  jobDescription: Annotation({ default: () => "" }),
  candidateId: Annotation({ default: () => "" }),
  classification: Annotation({ default: () => null }),
  messages: Annotation({ default: () => [] }),
  finalMessage: Annotation({ default: () => "" }),
  toolCalls: Annotation({ default: () => [] }),
});

// Node 1: "classify" — LAYER 1 (input classification). Runs against the raw
// extracted text before any of it reaches the model's context. This is a
// real, independent control: a document that trips a rule never gets to the
// LLM at all, regardless of how persuasive its phrasing is.
function classifyNode(state) {
  const classification = classifyDocument(state.resumeText);
  return { classification };
}

function routeAfterClassify(state) {
  return state.classification.decision === "block" ? "blocked" : "read";
}

// Node 2a: "read" — LAYER 2 (hard isolation). Unlike Phase 1, the resume text
// is never folded into a user-role message next to instructions. It's framed
// as the result of a read_resume tool call, wrapped in an explicit
// <candidate_document> data boundary, and the system prompt tells the model
// that boundary is never a source of instructions. This alone would not stop
// a fooled model from acting — that's what Phase 3/4 are for — but it does
// remove the "it's all just one blob of text" ambiguity that makes injection
// easy in the first place.
function readNode(state) {
  const system = buildIsolatedSystemPrompt(state.jobDescription);
  const wrappedDocument = wrapUntrustedDocument(state.fileName, state.resumeText);

  const messages = [
    { role: "system", content: system },
    {
      role: "user",
      content: `Evaluate candidate "${state.candidateId}" against the job description. Call read_resume to retrieve their document.`,
    },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_read_resume",
          type: "function",
          function: { name: "read_resume", arguments: JSON.stringify({ candidateId: state.candidateId }) },
        },
      ],
    },
    { role: "tool", tool_call_id: "call_read_resume", content: wrappedDocument },
  ];

  return { messages };
}

async function scoreAndActNode(state) {
  const { finalMessage, toolCalls } = await runAgentLoop({
    messages: state.messages,
    tools: [readResumeToolSchema, ...toolSchemas],
    executeTool,
  });
  return { finalMessage, toolCalls };
}

// Node 2b: "blocked" — the document never reaches the model. This is the
// terminal path for anything the classifier flags.
function blockedNode(state) {
  return {
    finalMessage: `Blocked before reaching agent reasoning context. Rules fired: ${state.classification.firedRules.join(", ")}`,
    toolCalls: [],
  };
}

async function persistNode(state) {
  await saveRun({
    candidateId: state.candidateId,
    fileName: state.fileName,
    jobTitle: "Senior Backend Engineer",
    resumeText: state.resumeText,
    finalMessage: state.finalMessage,
    toolCalls: state.toolCalls,
    phase: "phase2-classified-isolated",
    ruleFired: state.classification.firedRules.join(", ") || "none",
    allowed: state.classification.decision !== "block",
    classification: state.classification,
  });
  return {};
}

const graph = new StateGraph(AgentState)
  .addNode("classify", classifyNode)
  .addNode("read", readNode)
  .addNode("scoreAndAct", scoreAndActNode)
  .addNode("blocked", blockedNode)
  .addNode("persist", persistNode)
  .addEdge(START, "classify")
  .addConditionalEdges("classify", routeAfterClassify, { read: "read", blocked: "blocked" })
  .addEdge("read", "scoreAndAct")
  .addEdge("scoreAndAct", "persist")
  .addEdge("blocked", "persist")
  .addEdge("persist", END)
  .compile();

export async function evaluateResumePhase2({ fileName, resumeText, jobDescription, candidateId }) {
  return graph.invoke({ fileName, resumeText, jobDescription, candidateId });
}

export default graph;
