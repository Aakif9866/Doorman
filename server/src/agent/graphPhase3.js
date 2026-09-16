import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import {
  buildEvaluateOnlySystemPrompt,
  buildActSystemPrompt,
  wrapUntrustedDocument,
} from "./prompts.js";
import { toolSchemas, readResumeToolSchema, submitEvaluationToolSchema, executeTool } from "./tools.js";
import { runAgentLoop } from "./llmClient.js";
import { reviewEvaluation } from "./reviewGate.js";
import { checkActionAgainstPolicy } from "./actionPolicy.js";
import { saveRun } from "../storage.js";
import { classifyDocument } from "../classifier/index.js";

const AgentState = Annotation.Root({
  fileName: Annotation({ default: () => "" }),
  resumeText: Annotation({ default: () => "" }),
  jobDescription: Annotation({ default: () => "" }),
  candidateId: Annotation({ default: () => "" }),
  classification: Annotation({ default: () => null }),
  evaluateMessages: Annotation({ default: () => [] }),
  evaluation: Annotation({ default: () => null }),
  review: Annotation({ default: () => null }),
  finalMessage: Annotation({ default: () => "" }),
  toolCalls: Annotation({ default: () => [] }),
});

// LAYER 1 (unchanged from Phase 2): classify before anything reaches the model.
function classifyNode(state) {
  return { classification: classifyDocument(state.resumeText) };
}

function routeAfterClassify(state) {
  return state.classification.decision === "block" ? "blocked" : "read";
}

// LAYER 2 (unchanged from Phase 2): resume arrives as an isolated tool result.
function readNode(state) {
  const system = buildEvaluateOnlySystemPrompt(state.jobDescription);
  const wrappedDocument = wrapUntrustedDocument(state.fileName, state.resumeText);

  const evaluateMessages = [
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

  return { evaluateMessages };
}

// LAYER 3a (Phase 3, NEW): the evaluate call only ever has submit_evaluation
// bound. send_email/write_to_ats are not in this request at all — the model
// has no function definition for them, so it cannot call them here no matter
// what the document said. tool_choice is forced so the model must submit a
// structured evaluation rather than free-form text.
async function evaluateNode(state) {
  const { toolCalls } = await runAgentLoop({
    messages: state.evaluateMessages,
    tools: [readResumeToolSchema, submitEvaluationToolSchema],
    executeTool,
    maxSteps: 1,
    toolChoice: { type: "function", function: { name: "submit_evaluation" } },
  });

  const evaluation = toolCalls.find((tc) => tc.name === "submit_evaluation")?.args ?? null;
  return { evaluation };
}

// LAYER 3b (Phase 3, NEW): structural validation gate. Fails closed — a
// malformed or missing evaluation never reaches the act stage.
function reviewGateNode(state) {
  return { review: reviewEvaluation(state.evaluation) };
}

function routeAfterReview(state) {
  return state.review.passed ? "act" : "reviewFailed";
}

// LAYER 3c (Phase 3, NEW): send_email/write_to_ats are bound ONLY here, and
// only after review passed. Crucially, this node's context is built fresh —
// it never includes state.evaluateMessages, so the raw <candidate_document>
// text (and anything injected into it) has completely left the context by
// the time these tools become available. The model can only act on the
// validated {score, recommendation, justification} object.
//
// The system prompt TELLS the model to carry out exactly that recommendation
// — but a prompt is not enforcement. policyEnforcedExecute independently
// checks, in code, that each tool call actually matches what the
// recommendation authorizes (see actionPolicy.js) before it's allowed to run
// for real. A mismatched call is refused, not executed.
async function actNode(state) {
  const system = buildActSystemPrompt(state.jobDescription);
  const candidateEmail = `${state.candidateId}@example.com`;

  const actMessages = [
    { role: "system", content: system },
    {
      role: "user",
      content: JSON.stringify({
        candidateId: state.candidateId,
        candidateEmail,
        jobTitle: "Senior Backend Engineer",
        evaluation: state.evaluation,
      }),
    },
  ];

  const policyEnforcedExecute = async (name, args) => {
    const policyCheck = checkActionAgainstPolicy(name, args, {
      evaluation: state.evaluation,
      candidateId: state.candidateId,
      candidateEmail,
    });
    if (!policyCheck.allowed) {
      console.warn(`  [POLICY BLOCKED] ${name}(${JSON.stringify(args)}) — ${policyCheck.reason}`);
      return { ok: false, blocked: true, reason: policyCheck.reason };
    }
    return executeTool(name, args);
  };

  const { finalMessage, toolCalls } = await runAgentLoop({
    messages: actMessages,
    tools: toolSchemas,
    executeTool: policyEnforcedExecute,
  });

  return { finalMessage, toolCalls };
}

function blockedNode(state) {
  return {
    finalMessage: `Blocked before reaching agent reasoning context. Rules fired: ${state.classification.firedRules.join(", ")}`,
    toolCalls: [],
  };
}

function reviewFailedNode(state) {
  return {
    finalMessage: `Evaluation failed review and was never acted on. Reason: ${state.review.reason}`,
    toolCalls: [],
  };
}

async function persistNode(state) {
  const ruleParts = [
    ...state.classification.firedRules,
    ...(state.review && !state.review.passed ? [`review-gate:${state.review.reason}`] : []),
  ];

  await saveRun({
    candidateId: state.candidateId,
    fileName: state.fileName,
    jobTitle: "Senior Backend Engineer",
    resumeText: state.resumeText,
    finalMessage: state.finalMessage,
    toolCalls: state.toolCalls,
    phase: "phase3-tool-allowlisted",
    ruleFired: ruleParts.join(", ") || "none",
    allowed: state.classification.decision !== "block" && (!state.review || state.review.passed),
    classification: state.classification,
    evaluation: state.evaluation,
    review: state.review,
  });
  return {};
}

const graph = new StateGraph(AgentState)
  .addNode("classify", classifyNode)
  .addNode("read", readNode)
  .addNode("evaluate", evaluateNode)
  .addNode("reviewGate", reviewGateNode)
  .addNode("act", actNode)
  .addNode("blocked", blockedNode)
  .addNode("reviewFailed", reviewFailedNode)
  .addNode("persist", persistNode)
  .addEdge(START, "classify")
  .addConditionalEdges("classify", routeAfterClassify, { read: "read", blocked: "blocked" })
  .addEdge("read", "evaluate")
  .addEdge("evaluate", "reviewGate")
  .addConditionalEdges("reviewGate", routeAfterReview, { act: "act", reviewFailed: "reviewFailed" })
  .addEdge("act", "persist")
  .addEdge("blocked", "persist")
  .addEdge("reviewFailed", "persist")
  .addEdge("persist", END)
  .compile();

export async function evaluateResumePhase3({ fileName, resumeText, jobDescription, candidateId }) {
  return graph.invoke({ fileName, resumeText, jobDescription, candidateId });
}

export default graph;
