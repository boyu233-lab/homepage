import { withAuth } from "utils/auth";
import { getSettings } from "utils/config/config";
import { resolveProfiles } from "utils/profiles/resolve";

// GET /api/profiles — contextual profile resolution. Without a `profiles` key in
// settings.yaml (or on any parse failure) it returns the neutral result so the
// homepage renders byte-identically to the pre-S4 behaviour.
function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  let settings = null;
  try {
    settings = getSettings();
  } catch {
    settings = null;
  }

  res.setHeader("Cache-Control", "private, no-store");
  return res.status(200).json(resolveProfiles(req, settings));
}

export default withAuth(handler);
