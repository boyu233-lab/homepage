// S5 unified widget envelope + per-source degradation.
//
// Contract (D1/D2): the envelope is top-level flattened. Every original payload
// field stays at the top level; only degraded responses carry `_envelope`.
// Fresh successes and parameter-validation 4xx responses are replayed verbatim
// so that the 16 existing widget consumers (and their exact-body assertions)
// keep behaving byte-identically. The envelope is emitted only for upstream
// failures/ timeouts, which degrade to HTTP 200 + last-success snapshot
// (state "stale") or an empty snapshot (state "error"). See AC-05 / AC-06.

export const ERROR_KINDS = [
  "config_missing",
  "upstream_error",
  "invalid_params",
  "auth_required",
  "disabled",
  "unknown",
];

// In-process last-success snapshot per source. No disk, no background job, no dependency.
const snapshots = new Map();

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeKind(kind) {
  return ERROR_KINDS.includes(kind) ? kind : "unknown";
}

/**
 * Default failure classifier. Recognises two shapes:
 *  - an exception thrown by the wrapped handler (upstream / network failure);
 *  - a handler that lowers an upstream failure into a 200 body carrying an `error` string.
 * Returns null for a clean success so the success path stays byte-identical.
 */
export function classifyWidgetError({ body, error } = {}) {
  if (error) {
    return { kind: "upstream_error", message: String(error?.message ?? error) };
  }
  if (isPlainObject(body) && typeof body.error === "string" && body.error.trim()) {
    return { kind: "upstream_error", message: body.error };
  }
  return null;
}

/** Read-only snapshot view consumed by /api/health/sources (never triggers upstream I/O). */
export function getSourceStates() {
  const now = Date.now();
  return [...snapshots.entries()].map(([source, snap]) => ({
    source,
    state: snap.state,
    fetchedAt: snap.fetchedAt ? new Date(snap.fetchedAt).toISOString() : null,
    ageMs: snap.fetchedAt ? now - snap.fetchedAt : 0,
    error: snap.error ?? null,
  }));
}

/** Test / diagnostic helper: clear the in-process snapshots. */
export function resetSnapshots() {
  snapshots.clear();
}

// A minimal res proxy records what the wrapped handler wrote, so we can decide
// whether to replay verbatim, degrade, or cache — without editing handler bodies.
function captureResponse() {
  const captured = { status: 200, body: undefined, written: false, headers: {} };
  const proxy = {
    setHeader(key, value) {
      captured.headers[key] = value;
      return proxy;
    },
    status(code) {
      captured.status = code;
      return proxy;
    },
    json(body) {
      captured.body = body;
      captured.written = true;
      return proxy;
    },
    send(body) {
      captured.body = body;
      captured.written = true;
      return proxy;
    },
    end(body) {
      captured.body = body;
      captured.written = true;
      return proxy;
    },
  };
  return { proxy, captured };
}

function buildEnvelope(source, fetchedAt, ageMs, state, failure) {
  return {
    source,
    fetchedAt: fetchedAt ? new Date(fetchedAt).toISOString() : null,
    ageMs,
    stale: state === "stale",
    state,
    error: failure ? { kind: normalizeKind(failure.kind), message: String(failure.message ?? "") } : null,
  };
}

function writeDegraded(realRes, source, ttlMs, failure, handlerBody) {
  const snap = snapshots.get(source);
  const state = snap ? "stale" : "error";
  const fetchedAt = snap ? snap.fetchedAt : null;
  const ageMs = snap ? Date.now() - snap.fetchedAt : 0;

  let base;
  if (snap) base = { ...snap.payload };
  else if (isPlainObject(handlerBody)) base = { ...handlerBody };
  else base = {};

  snapshots.set(source, {
    payload: snap ? snap.payload : null,
    fetchedAt: snap ? snap.fetchedAt : null,
    ttlMs,
    state,
    error: { kind: normalizeKind(failure.kind), message: String(failure.message ?? "") },
  });

  return realRes.status(200).json({
    ...base,
    _envelope: buildEnvelope(source, fetchedAt, ageMs, state, failure),
  });
}

/**
 * Wrap a widget (req, res) handler so upstream failures keep the last successful
 * payload. Fresh/4xx responses are replayed verbatim (no injected field); the
 * flattened envelope is emitted only for degraded 200 responses.
 *
 * @param {Function} handler existing (req, res) widget handler
 * @param {{ source: string, ttlMs?: number, classify?: Function }} options
 */
export function withWidgetEnvelope(handler, { source, ttlMs = 0, classify = classifyWidgetError } = {}) {
  return async function envelopedHandler(req, realRes) {
    const { proxy, captured } = captureResponse();
    let thrown = null;
    try {
      await handler(req, proxy);
    } catch (error) {
      thrown = error;
    }

    if (typeof realRes?.setHeader === "function") {
      for (const [key, value] of Object.entries(captured.headers)) {
        realRes.setHeader(key, value);
      }
    }

    // Parameter-validation / config 4xx must keep their original status and body.
    const isValidation4xx = !thrown && captured.written && captured.status >= 400 && captured.status < 500;
    if (isValidation4xx) {
      return realRes.status(captured.status).json(captured.body);
    }

    const classified = classify({ status: captured.status, body: captured.body, error: thrown });
    const failure = thrown
      ? classified || { kind: "upstream_error", message: String(thrown?.message ?? thrown) }
      : classified;

    if (failure) {
      return writeDegraded(realRes, source, ttlMs, failure, captured.body);
    }

    if (captured.written && isPlainObject(captured.body)) {
      snapshots.set(source, {
        payload: { ...captured.body },
        fetchedAt: Date.now(),
        ttlMs,
        state: "fresh",
        error: null,
      });
    }
    return realRes.status(captured.status).json(captured.body);
  };
}
