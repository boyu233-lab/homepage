import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clientKey,
  guardPublicWidget,
  rateLimitSnapshot,
  resetRateLimits,
  widgetPolicy,
  withPublicWidgetGuard,
} from "./rate-limit";

function makeRes() {
  return {
    code: 200,
    body: null,
    headers: {},
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
  };
}

const req = (extra = {}) => ({
  headers: { host: "nas.example.com:3000", ...extra },
  socket: { remoteAddress: "10.0.0.9" },
});

describe("公开 widget 限流策略", () => {
  beforeEach(() => {
    resetRateLimits();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T00:00:00Z"));
    for (const key of Object.keys(process.env).filter((k) => k.startsWith("HOMEPAGE_"))) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    resetRateLimits();
  });

  it("默认策略给首页并发留足余量，音频单独收紧", () => {
    const board = widgetPolicy("news");
    const audio = widgetPolicy("audio");
    expect(board.limit).toBeGreaterThanOrEqual(120);
    expect(board.concurrent).toBe(0);
    expect(audio.limit).toBeLessThan(board.limit);
    expect(audio.concurrent).toBeGreaterThan(0);
    expect(audio.sameOrigin).toBe(true);
  });

  it("阈值可用环境变量覆盖，异常值回退默认", () => {
    process.env.HOMEPAGE_PUBLIC_WIDGET_LIMIT = "7";
    expect(widgetPolicy("news").limit).toBe(7);
    process.env.HOMEPAGE_AUDIO_CONCURRENT = "not-a-number";
    expect(widgetPolicy("audio").concurrent).toBeGreaterThan(0);
  });

  it("超过窗口上限返回 429 并带 Retry-After / X-RateLimit-*", () => {
    process.env.HOMEPAGE_PUBLIC_WIDGET_LIMIT = "3";
    const policy = widgetPolicy("news");
    const results = [1, 2, 3, 4].map(() => {
      const res = makeRes();
      return { decision: guardPublicWidget(req(), res, policy), res };
    });
    expect(results.slice(0, 3).every((r) => r.decision.allowed)).toBe(true);
    expect(results[3].decision.allowed).toBe(false);
    expect(results[3].res.code).toBe(429);
    expect(results[3].res.headers["Retry-After"]).toBeDefined();
    expect(results[2].res.headers["X-RateLimit-Remaining"]).toBe("0");
    expect(results[0].res.headers["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("窗口滚动后恢复，且不同 IP 互不影响", () => {
    process.env.HOMEPAGE_PUBLIC_WIDGET_LIMIT = "2";
    const policy = widgetPolicy("news");
    guardPublicWidget(req(), makeRes(), policy);
    guardPublicWidget(req(), makeRes(), policy);
    expect(guardPublicWidget(req(), makeRes(), policy).allowed).toBe(false);

    const other = req({ "x-forwarded-for": "203.0.113.7" });
    expect(guardPublicWidget(other, makeRes(), policy).allowed).toBe(true);

    vi.advanceTimersByTime(policy.windowMs);
    expect(guardPublicWidget(req(), makeRes(), policy).allowed).toBe(true);
  });

  it("音频并发达上限返回 503，release 后恢复", () => {
    const policy = { ...widgetPolicy("audio"), limit: 100 };
    const first = guardPublicWidget(req(), makeRes(), policy);
    expect(first.allowed).toBe(true);
    const second = guardPublicWidget(req(), makeRes(), policy);
    expect(second.allowed).toBe(true);

    // 默认并发 4：再开两个应刚好占满，第五个被拒
    const third = guardPublicWidget(req(), makeRes(), policy);
    const fourth = guardPublicWidget(req(), makeRes(), policy);
    expect(third.allowed && fourth.allowed).toBe(true);
    const blocked = makeRes();
    expect(guardPublicWidget(req(), blocked, policy).allowed).toBe(false);
    expect(blocked.code).toBe(503);

    first.release();
    const afterRelease = guardPublicWidget(req(), makeRes(), policy);
    expect(afterRelease.allowed).toBe(true);
    [second, third, fourth, afterRelease].forEach((d) => d.release());
    expect(rateLimitSnapshot().inflight).toHaveLength(0);
  });

  it("跨站请求与跨源 Origin 被拒绝（音频防盗链）", () => {
    const policy = widgetPolicy("audio");
    const crossSite = makeRes();
    expect(guardPublicWidget(req({ "sec-fetch-site": "cross-site" }), crossSite, policy).allowed).toBe(false);
    expect(crossSite.code).toBe(403);

    const crossOrigin = makeRes();
    expect(guardPublicWidget(req({ origin: "https://evil.example.com" }), crossOrigin, policy).allowed).toBe(false);
    expect(crossOrigin.code).toBe(403);

    expect(guardPublicWidget(req({ origin: "https://nas.example.com:3000" }), makeRes(), policy).allowed).toBe(true);
  });

  it("HOMEPAGE_PUBLIC_ORIGINS 可放行额外的同机域名", () => {
    process.env.HOMEPAGE_PUBLIC_ORIGINS = "https://home.example.org";
    const policy = widgetPolicy("audio");
    expect(
      guardPublicWidget(req({ origin: "https://home.example.org" }), makeRes(), policy).allowed,
    ).toBe(true);
  });

  it("HOMEPAGE_RATE_LIMIT_ENABLED=false 时不拦截（应急开关）", () => {
    process.env.HOMEPAGE_RATE_LIMIT_ENABLED = "false";
    process.env.HOMEPAGE_PUBLIC_WIDGET_LIMIT = "1";
    const policy = widgetPolicy("news");
    expect(guardPublicWidget(req(), makeRes(), policy).allowed).toBe(true);
    expect(guardPublicWidget(req(), makeRes(), policy).allowed).toBe(true);
  });

  it("单元测试桩（无 headers/socket）直接放行，不污染共享桶", () => {
    process.env.HOMEPAGE_PUBLIC_WIDGET_LIMIT = "1";
    const policy = widgetPolicy("news");
    const stub = { query: { source: "baidu" } };
    expect(guardPublicWidget(stub, makeRes(), policy).allowed).toBe(true);
    expect(guardPublicWidget(stub, makeRes(), policy).allowed).toBe(true);
    expect(rateLimitSnapshot().windows).toHaveLength(0);
  });

  it("clientKey 默认信任 XFF，关闭信任后改用 socket 地址", () => {
    expect(clientKey(req({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("1.2.3.4");
    process.env.HOMEPAGE_TRUST_PROXY = "false";
    expect(clientKey(req({ "x-forwarded-for": "1.2.3.4" }))).toBe("10.0.0.9");
  });

  it("withPublicWidgetGuard 被限流时不执行原 handler", async () => {
    process.env.HOMEPAGE_PUBLIC_WIDGET_LIMIT = "1";
    const handler = vi.fn(async (_req, res) => res.status(200).json({ ok: true }));
    const guarded = withPublicWidgetGuard(handler, "news");
    expect((await guarded(req(), makeRes())).body).toEqual({ ok: true });
    const blocked = makeRes();
    await guarded(req(), blocked);
    expect(blocked.code).toBe(429);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
