// Mocked side effects: nothing here actually sends email or writes to a real ATS.
// Phase 1: these tools are unrestricted and bound to the model on every turn —
// that's the vulnerability. Phase 3 will restrict which node can bind which tool.
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
