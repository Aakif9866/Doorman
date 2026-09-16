import { test } from "node:test";
import assert from "node:assert/strict";
import { extractResumeText } from "../src/utils/parseResume.js";

test("plain text is returned as-is regardless of a mismatched claimed mimetype", async () => {
  // A file lying about being a PDF (client-supplied mimetype is attacker
  // input) must still be handled by its actual content, not the claim.
  const buffer = Buffer.from("Jordan Parks — Backend Engineer", "utf-8");
  const text = await extractResumeText(buffer, "application/pdf");
  assert.equal(text, "Jordan Parks — Backend Engineer");
});

test("a real PDF is detected by magic bytes even if mislabeled as text/plain", async () => {
  // Not a full valid PDF (pdf-parse would need real structure to succeed),
  // but enough to prove dispatch is based on the %PDF- signature: this
  // should attempt PDF parsing and fail on invalid structure rather than
  // silently decoding the binary header as UTF-8 text.
  const buffer = Buffer.from("%PDF-1.4\nnot a real pdf body", "utf-8");
  await assert.rejects(() => extractResumeText(buffer, "text/plain"));
});
