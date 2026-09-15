// Lightweight, dependency-free stand-in for an embedding-similarity check:
// bag-of-words term-frequency vectors compared with cosine similarity. This
// is a classic vector-space IR technique (pre-dates neural embeddings) and
// is enough to catch paraphrased attacks that dodge the regex rules, without
// pulling in a heavyweight ML runtime.
//
// (We evaluated @huggingface/transformers for real sentence embeddings and
// deliberately skipped it: its onnxruntime-node/sharp transitive deps carry
// unresolved high-severity CVEs we don't want in a security-focused project,
// for image-preprocessing capability this text-only classifier never uses.)

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "is", "are", "was", "were", "be", "been",
  "to", "of", "in", "on", "for", "with", "this", "that", "it", "as", "at", "by",
  "you", "your", "i", "we", "they", "he", "she", "them", "just", "not", "no",
]);

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function termFrequencyVector(tokens) {
  const vec = new Map();
  for (const t of tokens) vec.set(t, (vec.get(t) || 0) + 1);
  return vec;
}

function cosineSimilarity(vecA, vecB) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [term, count] of vecA) {
    normA += count * count;
    if (vecB.has(term)) dot += count * vecB.get(term);
  }
  for (const count of vecB.values()) normB += count * count;
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Splits document text into candidate "lines" (sentence/line granularity),
// each compared independently — this is what lets us report *which* line in
// a resume triggered the match, not just a document-level yes/no.
function splitIntoLines(text) {
  return text
    .split(/[\n\r]+|(?<=[.!?])\s+/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 8);
}

export function buildReferenceVectors(phrases) {
  return phrases.map((phrase) => ({ phrase, vector: termFrequencyVector(tokenize(phrase)) }));
}

// Returns every line whose max similarity to any reference phrase clears
// `threshold`, sorted by score descending.
export function classifyBySimilarity(text, referenceVectors, threshold = 0.35) {
  const lines = splitIntoLines(text);
  const matches = [];

  for (const line of lines) {
    const lineVector = termFrequencyVector(tokenize(line));
    let best = { score: 0, phrase: null };
    for (const ref of referenceVectors) {
      const score = cosineSimilarity(lineVector, ref.vector);
      if (score > best.score) best = { score, phrase: ref.phrase };
    }
    if (best.score >= threshold) {
      matches.push({ line: line.slice(0, 160), score: Number(best.score.toFixed(3)), matchedPhrase: best.phrase });
    }
  }

  return matches.sort((a, b) => b.score - a.score);
}
