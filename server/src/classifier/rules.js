// Rules-based pass over raw extracted document text, run BEFORE the text ever
// reaches the model's context. Each rule is named so every block/allow is
// traceable to a specific rule, not a black-box "flagged: true".
//
// Deliberately conservative on wording (e.g. requiring bracket/tag-style
// "[SYSTEM]" rather than the bare word "system") to keep false positives low
// on resumes that legitimately mention "system design", "operating system", etc.

const RULES = [
  {
    id: "instruction-override",
    description: "Direct attempt to override prior instructions",
    pattern: /\b(ignore|disregard)\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+(instructions?|guidance|prompts?)\b/i,
  },
  {
    id: "process-skip",
    description: "Instructs the reader to skip the normal review/scoring process",
    pattern: /\bskip\s+(the\s+|your\s+)?(usual|normal|standard)\s+(scoring|review|evaluation)\s+process\b/i,
  },
  {
    id: "role-play-jailbreak",
    description: "Role-play / jailbreak framing (developer mode, act as, etc.)",
    pattern: /\b(you are now|developer mode|debug mode|no restrictions|act as (an?|the))\b/i,
  },
  {
    id: "fake-role-tag",
    description: "Fake chat-role tag or delimiter trying to break out of the data block",
    pattern: /(\[\s*\/?\s*(system|user|assistant)\s*\]|<\s*\/?\s*(system|user|assistant)(_message)?\s*>)/i,
  },
  {
    id: "tool-name-leak",
    description: "Document text names an internal tool/function verbatim — a real resume would never do this",
    pattern: /\b(send_email|write_to_ats)\b/,
  },
  {
    id: "hidden-html-comment",
    description: "HTML comment block — a common vector for text hidden from human reviewers but visible to extractors",
    pattern: /<!--[\s\S]*?-->/,
  },
  {
    id: "zero-width-unicode",
    description: "Zero-width or invisible unicode characters, often used to hide text or break up flagged keywords",
    pattern: /[​-‏⁠﻿]/,
  },
  {
    id: "base64-blob",
    description: "Long base64-looking blob, an unusual thing to find in resume text",
    pattern: /\b[A-Za-z0-9+/]{80,}={0,2}\b/,
  },
  {
    id: "pre-approved-claim",
    description: "Claims the candidate was already approved by an authority, pressuring the agent to skip evaluation",
    pattern: /\b(pre[- ]?approved|already (been )?(approved|reviewed)|already (interviewed|decided))\b/i,
  },
];

// Runs every rule against the text and returns all matches (not just the
// first), so a log entry can show the full set of signals that fired.
export function runRules(text) {
  const matches = [];
  for (const rule of RULES) {
    const m = text.match(rule.pattern);
    if (m) {
      matches.push({ rule: rule.id, description: rule.description, matchedText: m[0].slice(0, 120) });
    }
  }
  return matches;
}

export { RULES };
