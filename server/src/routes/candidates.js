import { Router } from "express";
import multer from "multer";
import { extractResumeText } from "../utils/parseResume.js";
import { evaluateResume } from "../agent/graph.js";
import { evaluateResumePhase2 } from "../agent/graphPhase2.js";
import { getAllRuns } from "../storage.js";
import { jobDescription } from "../data/jobDescription.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const router = Router();

// ?phase=1 uses the undefended Phase 1 pipeline (for side-by-side demos);
// anything else uses the Phase 2 classify+isolate pipeline, which is the
// current default going forward.
router.post("/upload", upload.single("resume"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No resume file uploaded (field name: 'resume')." });
    }
    const resumeText = await extractResumeText(req.file.buffer, req.file.mimetype);
    const candidateId = req.body.candidateId || req.file.originalname.replace(/\.[^.]+$/, "");
    const evaluate = req.query.phase === "1" ? evaluateResume : evaluateResumePhase2;

    const result = await evaluate({
      fileName: req.file.originalname,
      resumeText,
      jobDescription: req.body.jobDescription || jobDescription,
      candidateId,
    });

    res.json({
      candidateId,
      fileName: req.file.originalname,
      finalMessage: result.finalMessage,
      toolCalls: result.toolCalls,
      classification: result.classification || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/", async (_req, res) => {
  const runs = await getAllRuns();
  res.json(runs);
});

export default router;
