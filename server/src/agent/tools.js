// Mocked side effects: nothing here actually sends email or writes to a real ATS.
// Phase 1: these tools are unrestricted and bound to the model on every turn —
// that's the vulnerability. Phase 3 will restrict which node can bind which tool.

// PHASE 2: declared so the read_resume call/result pair synthesized in
// graph.js (see wrapUntrustedDocument) is a well-formed tool schema, even
// though the server fabricates that call rather than letting the model
// trigger a real re-fetch of the document.
export const readResumeToolSchema = {
  type: "function",
  function: {
    name: "read_resume",
    description: "Retrieve the extracted text content of the candidate's submitted resume.",
    parameters: {
      type: "object",
      properties: { candidateId: { type: "string" } },
      required: ["candidateId"],
    },
  },
};

// PHASE 3: the ONLY tool bound during evaluation. send_email/write_to_ats are
// not in this schema list at all, so the model has no way to invoke them at
// this stage — not "instructed not to", structurally absent from the request.
export const submitEvaluationToolSchema = {
  type: "function",
  function: {
    name: "submit_evaluation",
    description: "Submit your final evaluation of the candidate. This is the only action available at this stage.",
    parameters: {
      type: "object",
      properties: {
        score: { type: "integer", minimum: 1, maximum: 10 },
        recommendation: { type: "string", enum: ["Reject", "Under Review", "Interview", "Hire"] },
        justification: { type: "string", description: "Specific resume evidence supporting the score." },
      },
      required: ["score", "recommendation", "justification"],
    },
  },
};

export const toolSchemas = [
  {
    type: "function",
    function: {
      name: "send_email",
      description: "Send an email to the candidate about their application status.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Candidate email address" },
          subject: { type: "string" },
          body: { type: "string" },
        },
        required: ["to", "subject", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_to_ats",
      description: "Write the final candidate status to the ATS (applicant tracking system).",
      parameters: {
        type: "object",
        properties: {
          candidateId: { type: "string" },
          status: {
            type: "string",
            enum: ["Rejected", "Under Review", "Interview", "Hired"],
          },
          notes: { type: "string" },
        },
        required: ["candidateId", "status"],
      },
    },
  },
];

export async function executeTool(name, args) {
  const timestamp = new Date().toISOString();
  if (name === "read_resume") {
    // The read_resume call in every graph is fabricated by the server (see
    // wrapUntrustedDocument) so the resume can be framed as tool-result data
    // without a real round trip. Its schema is still declared so that
    // fabricated call is well-formed conversation history, and so Phase 3's
    // forced tool_choice has something concrete to point away from. If the
    // model ever actually selects this live (it shouldn't — see the
    // allowlist/tool_choice enforcement around this), fail loudly instead of
    // silently returning "Unknown tool", since a live call here would mean
    // one of those guarantees broke.
    return { ok: false, error: "read_resume has no live handler — the document is only ever delivered via a fabricated call" };
  }
  if (name === "submit_evaluation") {
    return { ok: true, recorded: true, timestamp, ...args };
  }
  if (name === "send_email") {
    console.log(`  [MOCK EMAIL] to=${args.to || "(unspecified)"} subject="${args.subject || ""}"`);
    console.log(`               body: ${(args.body || "").slice(0, 300)}`);
    return { ok: true, mocked: true, timestamp, ...args };
  }
  if (name === "write_to_ats") {
    console.log(
      `  [MOCK ATS WRITE] candidateId=${args.candidateId || "(unspecified)"} status=${args.status} notes="${args.notes || ""}"`
    );
    return { ok: true, mocked: true, timestamp, ...args };
  }
  return { ok: false, error: `Unknown tool: ${name}` };
}
