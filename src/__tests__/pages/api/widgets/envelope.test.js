import { beforeEach, describe, expect, it, vi } from "vitest";

import createMockRes from "test-utils/create-mock-res";

vi.mock("utils/auth", () => ({ withAuth: (handler) => handler }));

import handler from "pages/api/health/sources";
import { classifyWidgetError, getSourceStates, resetSnapshots, withWidgetEnvelope } from "utils/widget/envelope";

describe("withWidgetEnvelope", () => {
  beforeEach(() => {
    resetSnapshots();
  });

  it("caches a fresh success and replays the payload verbatim (no envelope on fresh)", async () => {
    const wrapped = withWidgetEnvelope(
      async (req, res) => res.status(200).json({ items: [1, 2, 3], total: 3 }),
      { source: "unit-fresh", ttlMs: 1000 },
    );
    const res = createMockRes();

    await wrapped({ query: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ items: [1, 2, 3], total: 3 });
    expect(getSourceStates().find((entry) => entry.source === "unit-fresh")).toMatchObject({
      state: "fresh",
      error: null,
    });
  });

  it("degrades to the last success payload with state=stale on upstream failure (AC-05)", async () => {
    let fail = false;
    const wrapped = withWidgetEnvelope(
      async (req, res) => {
        if (fail) throw new Error("upstream down");
        return res.status(200).json({ items: ["a", "b"], sourceLabel: "demo" });
      },
      { source: "unit-stale", ttlMs: 1000 },
    );

    const ok = createMockRes();
    await wrapped({ query: {} }, ok);
    fail = true;
    const bad = createMockRes();
    await wrapped({ query: {} }, bad);

    expect(bad.statusCode).toBe(200);
    expect(bad.body.items).toEqual(["a", "b"]);
    expect(bad.body.sourceLabel).toBe("demo");
    expect(bad.body._envelope.state).toBe("stale");
    expect(bad.body._envelope.stale).toBe(true);
    expect(bad.body._envelope.error.kind).toBe("upstream_error");
    expect(getSourceStates().find((entry) => entry.source === "unit-stale").state).toBe("stale");
  });

  it("returns HTTP 200 + state=error + error.kind when there is no snapshot (AC-06)", async () => {
    const wrapped = withWidgetEnvelope(
      async () => {
        throw new Error("boom");
      },
      { source: "unit-error", classify: classifyWidgetError },
    );
    const res = createMockRes();

    await wrapped({ query: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body._envelope.state).toBe("error");
    expect(res.body._envelope.stale).toBe(false);
    expect(res.body._envelope.error.kind).toBe("upstream_error");
  });

  it("keeps parameter-validation 4xx status and body byte-identical", async () => {
    const wrapped = withWidgetEnvelope(
      async (req, res) => res.status(400).json({ error: "Missing watchlist" }),
      { source: "unit-4xx" },
    );
    const res = createMockRes();

    await wrapped({ query: {} }, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "Missing watchlist" });
  });

  it("degrades a 200 body carrying an error field (news/bilibili style)", async () => {
    let fail = false;
    const wrapped = withWidgetEnvelope(
      async (req, res) => {
        if (fail) return res.status(200).json({ items: [], error: "源暂不可用" });
        return res.status(200).json({ items: ["kept"] });
      },
      { source: "unit-news" },
    );

    const ok = createMockRes();
    await wrapped({ query: {} }, ok);
    fail = true;
    const bad = createMockRes();
    await wrapped({ query: {} }, bad);

    expect(bad.statusCode).toBe(200);
    expect(bad.body.items).toEqual(["kept"]);
    expect(bad.body._envelope.state).toBe("stale");
  });

  it("forwards headers set by the wrapped handler", async () => {
    const wrapped = withWidgetEnvelope(
      async (req, res) => {
        res.setHeader("Cache-Control", "private, no-store");
        return res.status(200).json({ ok: true });
      },
      { source: "unit-headers" },
    );
    const res = createMockRes();

    await wrapped({ query: {} }, res);

    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
  });
});

describe("pages/api/health/sources", () => {
  beforeEach(() => {
    resetSnapshots();
  });

  it("returns read-only source states with degraded/healthy flags", async () => {
    const ok = withWidgetEnvelope(async (req, res) => res.status(200).json({ value: 1 }), { source: "health-a" });
    const okRes = createMockRes();
    await ok({ query: {} }, okRes);

    const failing = withWidgetEnvelope(async () => { throw new Error("down"); }, { source: "health-b" });
    const failRes = createMockRes();
    await failing({ query: {} }, failRes);

    const res = createMockRes();
    await handler({ method: "GET", headers: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.sources.find((entry) => entry.source === "health-a").state).toBe("fresh");
    expect(res.body.sources.find((entry) => entry.source === "health-b").state).toBe("error");
    expect(res.body.degraded).toBe(true);
    expect(res.body.healthy).toBe(false);
  });

  it("rejects non-GET requests without touching any source", async () => {
    const res = createMockRes();
    await handler({ method: "POST", headers: {} }, res);
    expect(res.statusCode).toBe(405);
  });
});
