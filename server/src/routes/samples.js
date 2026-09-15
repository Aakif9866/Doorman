import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { evaluateResume } from "../agent/graph.js";
import { evaluateResumePhase2 } from "../agent/graphPhase2.js";
import { evaluateResumePhase3 } from "../agent/graphPhase3.js";
import { jobDescription } from "../data/jobDescription.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.join(__dirname, "..", "..");
const CATEGORY_DIRS = { attacks: path.join(SERVER_ROOT, "attacks"), benign: path.join(SERVER_ROOT, "benign") };
const PIPELINES = { 1: evaluateResume, 2: evaluateResumePhase2, 3: evaluateResumePhase3 };

const router = Router();

// Lists the built-in attack/benign resumes so the test UI can offer them in
// a dropdown instead of requiring a real file upload for every demo.
router.get("/", (_req, res) => {
  const listDir = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith(".txt")).sort();
  res.json({
    attacks: listDir(CATEGORY_DIRS.attacks),
    benign: listDir(CATEGORY_DIRS.benign),
  });
});

// Runs one built-in sample through a chosen pipeline without needing a real
// upload — same response shape as POST /api/candidates/upload.
router.post("/evaluate", async (req, res) => {
  try {
    const { category, file, phase } = req.body;
    const dir = CATEGORY_DIRS[category];
    if (!dir) {
      return res.status(400).json({ error: `Unknown category '${category}'. Expected 'attacks' or 'benign'.` });
    }
    const filePath = path.join(dir, file || "");
    if (!filePath.startsWith(dir) || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: `Sample not found: ${category}/${file}` });
    }

    const resumeText = fs.readFileSync(filePath, "utf-8");
    const candidateId = file.replace(/\.txt$/, "");
    const evaluate = PIPELINES[phase] || evaluateResumePhase3;

    const result = await evaluate({ fileName: file, resumeText, jobDescription, candidateId });

    res.json({
      candidateId,
      fileName: file,
      resumeText,
      finalMessage: result.finalMessage,
      toolCalls: result.toolCalls,
      classification: result.classification || null,
      evaluation: result.evaluation || null,
      review: result.review || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
