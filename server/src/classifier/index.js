import { runRules } from "./rules.js";
import { classifyBySimilarity, buildReferenceVectors } from "./similarity.js";
import { ATTACK_PHRASES } from "./attackPhrases.js";

const REFERENCE_VECTORS = buildReferenceVectors(ATTACK_PHRASES);

// Rules are treated as high-confidence — any single rule firing is enough to
// block, since each one targets a pattern with essentially no legitimate
// resume use case. The similarity check is lower-precision on its own (a
// single near-threshold paraphrase could be coincidence), so it only blocks
// once multiple lines clear the bar — that's what keeps false positives down
// on benign resumes that happen to use urgent or enthusiastic language.
const SIMILARITY_THRESHOLD = 0.35;
const SIMILARITY_MIN_MATCHES_TO_BLOCK = 2;

export function classifyDocument(text) {
  const ruleMatches = runRules(text);
  const similarityMatches = classifyBySimilarity(text, REFERENCE_VECTORS, SIMILARITY_THRESHOLD);

  const blockedByRules = ruleMatches.length > 0;
  const blockedBySimilarity = similarityMatches.length >= SIMILARITY_MIN_MATCHES_TO_BLOCK;

  const firedRules = [
    ...ruleMatches.map((m) => m.rule),
    ...(blockedBySimilarity ? ["lexical-similarity-multi-match"] : []),
  ];

  return {
    flagged: blockedByRules || blockedBySimilarity,
    decision: blockedByRules || blockedBySimilarity ? "block" : "allow",
    firedRules,
    ruleMatches,
    similarityMatches,
  };
}
