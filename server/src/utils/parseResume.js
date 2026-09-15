import pdfParse from "pdf-parse/lib/pdf-parse.js";

// Extracts plain text from an uploaded resume buffer. PDFs go through
// pdf-parse; anything else is treated as already-plain-text.
export async function extractResumeText(buffer, mimetype) {
  if (mimetype === "application/pdf") {
    const data = await pdfParse(buffer);
    return data.text;
  }
  return buffer.toString("utf-8");
}
