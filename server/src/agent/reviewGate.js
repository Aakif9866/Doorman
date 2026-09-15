// Validates the evaluate stage's output before the act stage's tools ever
// unlock. This is a structural sanity check (shape/range), not content
// analysis of a proposed action — that's Phase 4's output scanning. If the
// model returned something malformed, or no evaluation at all (e.g. it
// refused despite the forced tool_choice), the pipeline fails closed: no
// action is taken and the run is logged as a review failure.
const VALID_RECOMMENDATIONS = ["Reject", "Under Review", "Interview", "Hire"];

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
  return { passed: true, reason: null };
}
