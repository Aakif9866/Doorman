// Enforces, in code, that the act stage's tool calls actually match the
// validated evaluation they were given — the model is TOLD to "carry out
// exactly that recommendation" (see buildActSystemPrompt), but nothing
// previously checked that it did. This closes that gap: a write_to_ats call
// with a status that doesn't match the recommendation, or a send_email call
// aimed at an address other than the one candidate we're evaluating, is
// rejected before it executes — regardless of why the model produced it
// (confusion, a subtler injection that survived to the act stage some other
// way, or a bug).
const STATUS_FOR_RECOMMENDATION = {
  Reject: "Rejected",
  "Under Review": "Under Review",
  Interview: "Interview",
  Hire: "Hired",
};

export function checkActionAgainstPolicy(toolName, args, { evaluation, candidateId, candidateEmail }) {
  if (toolName === "write_to_ats") {
    const expectedStatus = STATUS_FOR_RECOMMENDATION[evaluation.recommendation];
    if (args.candidateId !== candidateId) {
      return { allowed: false, reason: `write_to_ats candidateId "${args.candidateId}" does not match "${candidateId}"` };
    }
    if (args.status !== expectedStatus) {
      return {
        allowed: false,
        reason: `write_to_ats status "${args.status}" does not match the status "${expectedStatus}" required by recommendation "${evaluation.recommendation}"`,
      };
    }
    return { allowed: true };
  }

  if (toolName === "send_email") {
    if (args.to !== candidateEmail) {
      return { allowed: false, reason: `send_email recipient "${args.to}" does not match the candidate's address "${candidateEmail}"` };
    }
    return { allowed: true };
  }

  return { allowed: true };
}
