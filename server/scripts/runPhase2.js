import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { evaluateResumePhase2 } from "../src/agent/graphPhase2.js";
import { jobDescription } from "../src/data/jobDescription.js";
import { connectMongo } from "../src/db/mongo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadSet(dirName) {
  const dir = path.join(__dirname, "..", dirName);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".txt"))
    .sort()
    .map((file) => ({ file, resumeText: fs.readFileSync(path.join(dir, file), "utf-8") }));
}

async function runSet(label, docs) {
  console.log(`\n\n================ ${label} ================\n`);
  const rows = [];

  for (const { file, resumeText } of docs) {
    const candidateId = file.replace(/\.txt$/, "");
    const result = await evaluateResumePhase2({ fileName: file, resumeText, jobDescription, candidateId });
    const c = result.classification;
    const blocked = c.decision === "block";

    const toolSummary = blocked
      ? "(blocked — never reached the model)"
      : result.toolCalls.length > 0
        ? result.toolCalls.map((tc) => `${tc.name}(${JSON.stringify(tc.args)})`).join("  |  ")
        : "(none — model did not call any tool)";

    rows.push({ file, blocked, firedRules: c.firedRules, toolSummary });

    console.log(`${blocked ? "BLOCKED   " : "ALLOWED   "}  ${file}`);
    console.log(`  rules fired: ${c.firedRules.length ? c.firedRules.join(", ") : "none"}`);
    if (c.similarityMatches.length > 0) {
      console.log(
        `  similarity matches: ${c.similarityMatches.map((m) => `"${m.line}" (score=${m.score})`).join(" | ")}`
      );
    }
    console.log(`  tools called: ${toolSummary}\n`);
  }

  return rows;
}

async function main() {
  if (!process.env.GROQ_API_KEY) {
    console.error("Missing GROQ_API_KEY. Copy server/.env.example to server/.env and set it.");
    process.exit(1);
  }
  await connectMongo();

  const attackRows = await runSet("PHASE 2 — ATTACK RESUMES (attacks/)", loadSet("attacks"));
  const benignRows = await runSet("PHASE 2 — BENIGN RESUMES (benign/)", loadSet("benign"));

  const attacksBlocked = attackRows.filter((r) => r.blocked).length;
  const benignBlocked = benignRows.filter((r) => r.blocked).length;

  console.log("\n\n======================= PHASE 2 SUMMARY =======================\n");
  console.log(`Attack resumes blocked:  ${attacksBlocked}/${attackRows.length}`);
  console.log(`Benign resumes blocked:  ${benignBlocked}/${benignRows.length}  (false positives)`);
  console.log("=================================================================\n");

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
