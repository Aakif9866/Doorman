import pdfParse from "pdf-parse/lib/pdf-parse.js";

// The client-supplied mimetype is an attacker-controlled header, not a fact
// about the file — trusting it to decide how to parse the bytes means a
// mislabeled upload either gets fed to pdf-parse as garbage or gets its raw
// PDF binary decoded as "text". Sniff the actual magic bytes instead: every
// PDF starts with the literal "%PDF-" signature.
function looksLikePdf(buffer) {
  return buffer.subarray(0, 5).toString("latin1") === "%PDF-";
}

// Extracts plain text from an uploaded resume buffer. PDFs go through
// pdf-parse; anything else is treated as already-plain-text.
export async function extractResumeText(buffer, _mimetype) {
  if (looksLikePdf(buffer)) {
    const data = await pdfParse(buffer);
    return data.text;
  }
  return buffer.toString("utf-8");
}
