// Minimal shared-secret auth, not a real auth system. There's no session
// management, no per-user identity, no rate limiting tied to a principal —
// it exists only to close the "anyone who can reach this API can run the LLM
// and read stored resumes" gap for a demo/portfolio deployment. A production
// system needs real authentication (OAuth/SSO) and authorization (who can
// see which candidate's data), not this.
export function requireApiKey(req, res, next) {
  const configuredKey = process.env.API_KEY;
  if (!configuredKey) {
    // No key configured — treat as local/dev mode. Logged once at startup
    // (see server.js), not on every request.
    return next();
  }
  const providedKey = req.get("x-api-key");
  if (providedKey !== configuredKey) {
    return res.status(401).json({ error: "Missing or invalid x-api-key header." });
  }
  return next();
}
