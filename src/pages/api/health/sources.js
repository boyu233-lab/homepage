import { withAuth } from "utils/auth";
import { getSourceStates } from "utils/widget/envelope";

// Read-only snapshot of each wrapped widget source. Never triggers upstream I/O:
// it only reads the in-process last-success map maintained by withWidgetEnvelope.
function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const sources = getSourceStates();
  const degraded = sources.some((entry) => entry.state !== "fresh");
  res.setHeader("Cache-Control", "private, no-store");
  return res.status(200).json({ sources, degraded, healthy: !degraded });
}

export default withAuth(handler);
