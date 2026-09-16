// Validates the evaluate stage's output before the act stage's tools ever
// unlock. This is a structural/consistency sanity check — shape, range, and
// whether the recommendation is at least numerically plausible given the
// score — NOT a truth check. It cannot tell whether the justification
// actually reflects the resume's real content, or whether the score itself
// was manipulated by something in the document; a well-formed, internally
// consistent, but entirely fabricated evaluation (e.g. an injection that
// convinces the model the candidate has 8 years of experience they don't
// have) passes this gate every time. Verifying the *content* of an action
// is genuinely grounded is Phase 4's job (output scanning) and is a much
// harder problem than shape validation — left as a known gap, not solved
// here.
const VALID_RECOMMENDATIONS = ["Reject", "Under Review", "Interview", "Hire"];

// Loose, deliberately permissive bounds — wide enough that a reasonable human
// reviewer's judgment call wouldn't trip them, tight enough to catch the
// nonsensical combinations (score 1 + Hire, score 10 + Reject) that show up
// when a score has been manipulated independently of the recommendation.
const MIN_SCORE_FOR_RECOMMENDATION = { Hire: 7, Interview: 5, "Under Review": 1, Reject: 1 };
const MAX_SCORE_FOR_RECOMMENDATION = { Hire: 10, Interview: 10, "Under Review": 10, Reject: 5 };

export function reviewEvaluation(evaluation) {
  if (!evaluation) {
    return { passed: false, reason: "no evaluation was produced" };
  }
  if (typeof evaluation.score !== "number" || !Number.isInteger(evaluation.score) || evaluation.score < 1 || evaluation.score > 10) {
    return { passed: false, reason: `score out of range or non-integer: ${evaluation.score}` };
  }
  if (!VALID_RECOMMENDATIONS.includes(evaluation.recommendation)) {
    return { passed: false, reason: `recommendation not in allowed set: ${evaluation.recommendation}` };
  }
  if (typeof evaluation.justification !== "string" || evaluation.justification.trim().length < 10) {
    return { passed: false, reason: "justification missing or too short to be meaningful" };
  }
  const { score, recommendation } = evaluation;
  if (score < MIN_SCORE_FOR_RECOMMENDATION[recommendation] || score > MAX_SCORE_FOR_RECOMMENDATION[recommendation]) {
    return { passed: false, reason: `score ${score} is inconsistent with recommendation "${recommendation}"` };
  }
  return { passed: true, reason: null };
}
