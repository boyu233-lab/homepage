import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLoginLimiter, loginClientKey, secretWeakness } from "./auth-hardening";

describe("NEXTAUTH_SECRET 占位符检测", () => {
  it("识别常见占位符与弱值", () => {
    expect(secretWeakness("CHANGE_ME_RANDOM_SECRET_AT_LEAST_32_CHARS")).toMatch(/占位符/);
    expect(secretWeakness("change-me-please-please-please-1234")).toMatch(/占位符/);
    expect(secretWeakness("smoketest_smoketest_smoketest_123456")).toMatch(/测试/);
    expect(secretWeakness("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toMatch(/重复/);
    expect(secretWeakness("12345678901234567890123456789012")).toMatch(/纯数字/);
  });

  it("随机生成的 secret 通过", () => {
    expect(secretWeakness("Y7cVq2pL9sR4tN8wK1zB6xD3hJ0mF5gA")).toBeNull();
    expect(secretWeakness("")).toBeNull();
    expect(secretWeakness(undefined)).toBeNull();
  });
});

describe("登录失败限流", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("连续失败达到阈值后锁定，成功可清零", () => {
    const limiter = createLoginLimiter({ maxFailures: 3, windowMs: 60_000, lockMs: 300_000 });
    expect(limiter.isLocked("1.2.3.4")).toBe(false);
    limiter.recordFailure("1.2.3.4");
    limiter.recordFailure("1.2.3.4");
    expect(limiter.isLocked("1.2.3.4")).toBe(false);
    limiter.recordFailure("1.2.3.4");
    expect(limiter.isLocked("1.2.3.4")).toBe(true);
    expect(limiter.retryAfterSeconds("1.2.3.4")).toBeGreaterThan(0);

    // 不同 IP 不受牵连
    expect(limiter.isLocked("5.6.7.8")).toBe(false);

    limiter.recordSuccess("1.2.3.4");
    expect(limiter.isLocked("1.2.3.4")).toBe(false);
  });

  it("锁定期结束后自动恢复", () => {
    const limiter = createLoginLimiter({ maxFailures: 2, windowMs: 60_000, lockMs: 30_000 });
    limiter.recordFailure("a");
    limiter.recordFailure("a");
    expect(limiter.isLocked("a")).toBe(true);
    vi.advanceTimersByTime(31_000);
    expect(limiter.isLocked("a")).toBe(false);
  });

  it("参数可由环境变量配置，reset 清空状态", () => {
    process.env.HOMEPAGE_LOGIN_MAX_FAILURES = "2";
    const limiter = createLoginLimiter();
    expect(limiter.maxFailures).toBe(2);
    limiter.recordFailure("b");
    limiter.recordFailure("b");
    expect(limiter.isLocked("b")).toBe(true);
    limiter.reset();
    expect(limiter.isLocked("b")).toBe(false);
    delete process.env.HOMEPAGE_LOGIN_MAX_FAILURES;
  });
});

describe("登录客户端标识", () => {
  it("兼容普通对象 headers 与 Headers 实例", () => {
    expect(loginClientKey({ headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2" } })).toBe("1.1.1.1");
    expect(loginClientKey({ headers: new Map([["x-real-ip", "3.3.3.3"]]) })).toBe("3.3.3.3");
    expect(loginClientKey({ socket: { remoteAddress: "::ffff:4.4.4.4" } })).toBe("::ffff:4.4.4.4");
    expect(loginClientKey({})).toBe("unknown");
  });
});
