// S4 contextual profiles — pure resolver, no I/O, no background job, no dashboard changes.
//
// `settings.yaml` may optionally declare a `profiles` key, e.g. (placeholders only,
// never real internal addresses / credentials):
//
//   profiles:
//     - name: CHANGE_ME_PROFILE_NAME
//       when:
//         time:
//           timezone: CHANGE_ME_TIMEZONE   # REQUIRED; containers default to UTC
//           after: "18:00"
//           before: "23:59"
//         network: CHANGE_ME_NETWORK       # matched against request host class
//         device: CHANGE_ME_DEVICE         # coarse User-Agent class
//
// Missing key, malformed value, or a settings parse failure => { active: null, profiles: [] },
// so the homepage keeps rendering exactly as before.

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function headerValue(req, name) {
  const headers = req?.headers;
  if (!headers || typeof headers !== "object") return "";
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return String(value[0] ?? "");
  return typeof value === "string" ? value : "";
}

// Coarse network class from the request host only. Deliberately does NOT parse
// private LAN ranges: no hard-coded address literals are used, only the host
// shape. A single-label or loopback host is "internal", a dotted name is "external".
function classifyNetwork(host) {
  if (typeof host !== "string" || !host.trim()) return "unknown";
  const hostname = host.trim().split(":")[0].toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname) return "unknown";
  if (hostname === "localhost" || !hostname.includes(".")) return "internal";
  return "external";
}

// Coarse User-Agent class; no third-party parser.
function classifyDevice(userAgent) {
  if (typeof userAgent !== "string" || !userAgent.trim()) return "unknown";
  const ua = userAgent.toLowerCase();
  if (/ipad|tablet|kindle|silk|playbook/.test(ua)) return "tablet";
  if (/iphone|ipod|mobile|windows phone|android/.test(ua)) return "mobile";
  if (/mozilla|chrome|safari|firefox|edge|opera/.test(ua)) return "desktop";
  return "unknown";
}

function parseHHMM(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

// Current minutes-of-day in an EXPLICIT timezone. An absent/invalid timezone
// makes the time rule fail rather than silently falling back to UTC.
function localMinutes(now, timezone) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const hours = Number(parts.find((part) => part.type === "hour")?.value);
    const minutes = Number(parts.find((part) => part.type === "minute")?.value);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    return hours * 60 + minutes;
  } catch {
    return null;
  }
}

function timeMatches(rule, now) {
  if (!isPlainObject(rule)) return false;
  if (typeof rule.timezone !== "string" || !rule.timezone.trim()) return false;
  const minutes = localMinutes(now, rule.timezone.trim());
  if (minutes === null) return false;
  const after = parseHHMM(rule.after) ?? 0;
  const before = parseHHMM(rule.before) ?? 1440;
  if (after <= before) return minutes >= after && minutes < before;
  return minutes >= after || minutes < before; // window crossing midnight
}

function sanitizeProfile(profile) {
  const name = typeof profile.name === "string" && profile.name.trim() ? profile.name.trim() : null;
  return {
    name,
    when: isPlainObject(profile.when) ? profile.when : {},
  };
}

function profileMatches(profile, context) {
  const { when } = profile;
  if (when.time !== undefined && !timeMatches(when.time, context.now)) return false;
  if (when.network !== undefined && String(when.network) !== context.network) return false;
  if (when.device !== undefined && String(when.device) !== context.device) return false;
  return true;
}

/**
 * Resolve context profiles. `settings` is the parsed settings.yaml object (or
 * null when parsing failed). Read-only: never mutates settings, never triggers
 * network I/O, never touches the dashboard data pipeline.
 *
 * @returns {{ active: string|null, profiles: Array<{name: string, when: object}> }}
 */
export function resolveProfiles(req, settings, now = new Date()) {
  const neutral = { active: null, profiles: [] };
  if (!isPlainObject(settings)) return neutral;

  const raw = settings.profiles;
  if (!Array.isArray(raw) || raw.length === 0) return neutral;

  const profiles = raw.filter(isPlainObject).map(sanitizeProfile).filter((profile) => profile.name);
  if (profiles.length === 0) return neutral;

  const host = headerValue(req, "x-forwarded-host") || headerValue(req, "host");
  const context = {
    now,
    network: classifyNetwork(host),
    device: classifyDevice(headerValue(req, "user-agent")),
  };

  const matched = profiles.find((profile) => profileMatches(profile, context));
  return { active: matched ? matched.name : null, profiles };
}
