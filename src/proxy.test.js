import { beforeEach, describe, expect, it, vi } from "vitest";

const { NextResponse, getToken } = vi.hoisted(() => ({
  NextResponse: {
    json: vi.fn((body, init) => ({ type: "json", body, init, headers: new Headers() })),
    next: vi.fn(() => ({ type: "next", headers: new Headers() })),
    redirect: vi.fn((url) => ({ type: "redirect", url, headers: new Headers() })),
  },
  getToken: vi.fn(),
}));

vi.mock("next/server", () => ({ NextResponse }));
vi.mock("next-auth/jwt", () => ({ getToken }));

async function loadProxy() {
  vi.resetModules();
  const mod = await import("./proxy");
  return mod.proxy;
}

function createReq(host = "localhost:3000", url = "http://localhost:3000/", headers = {}) {
  return {
    url,
    headers: {
      get: (key) => {
        if (key === "host") return host;
        return headers[key] ?? null;
      },
    },
  };
}

/**
 * 本 fork 的 middleware 语义（与官方"全站鉴权"不同）：
 *   导航页与所有公开数据 API 匿名可访问；只有 /manage 页面由 middleware 守门；
 *   API 的读写权限统一交给 utils/auth.js 的 withAuth 白名单处理。
 */
describe("proxy", () => {
  const originalEnv = process.env;
  const originalConsoleError = console.error;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.HOMEPAGE_ALLOWED_HOSTS;
    delete process.env.HOMEPAGE_AUTH_ENABLED;
    delete process.env.HOMEPAGE_EXTERNAL_URL;
    delete process.env.NEXTAUTH_URL;
    console.error = originalConsoleError;
  });

  describe("host validation", () => {
    it("allows default localhost hosts when auth is disabled", async () => {
      process.env.PORT = "3000";
      const proxy = await loadProxy();
      const res = await proxy(createReq("localhost:3000"));
      expect(NextResponse.next).toHaveBeenCalled();
      expect(res.type).toBe("next");
    });

    it("blocks requests when host is not allowed", async () => {
      process.env.PORT = "3000";
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const proxy = await loadProxy();
      const res = await proxy(createReq("evil.com"));
      expect(errSpy).toHaveBeenCalled();
      expect(NextResponse.json).toHaveBeenCalledWith(
        { error: "Host validation failed. See logs for more details." },
        { status: 400 },
      );
      expect(getToken).not.toHaveBeenCalled();
      expect(res.init.status).toBe(400);
    });

    it("allows any host when HOMEPAGE_ALLOWED_HOSTS is '*'", async () => {
      process.env.HOMEPAGE_ALLOWED_HOSTS = "*";
      const proxy = await loadProxy();
      const res = await proxy(createReq("anything.example"));
      expect(res.type).toBe("next");
    });

    it("allows hosts listed in HOMEPAGE_ALLOWED_HOSTS", async () => {
      process.env.PORT = "3000";
      process.env.HOMEPAGE_ALLOWED_HOSTS = "example.com:3000, other:3000";
      const proxy = await loadProxy();
      const res = await proxy(createReq("example.com:3000", "http://example.com:3000/"));
      expect(res.type).toBe("next");
    });

    it("trusts the host derived from HOMEPAGE_EXTERNAL_URL", async () => {
      process.env.HOMEPAGE_EXTERNAL_URL = "http://192.168.1.100:3000";
      const proxy = await loadProxy();
      const res = await proxy(createReq("192.168.1.100:3000", "http://192.168.1.100:3000/"));
      expect(res.type).toBe("next");
    });
  });

  describe("public dashboard", () => {
    it.each(["/", "/api/bookmarks", "/api/hash", "/api/config/custom.css", "/api/config/custom.js", "/api/mcp"])(
      "keeps %s public when auth is enabled",
      async (pathname) => {
        process.env.HOMEPAGE_AUTH_ENABLED = "true";
        process.env.HOMEPAGE_AUTH_SECRET = "secret";
        const proxy = await loadProxy();
        const res = await proxy(createReq("localhost:3000", `http://localhost:3000${pathname}`));
        expect(getToken).not.toHaveBeenCalled();
        expect(res.type).toBe("next");
      },
    );

    it.each(["false", "0", "no", "off", ""])("treats HOMEPAGE_AUTH_ENABLED=%j as disabled", async (value) => {
      process.env.HOMEPAGE_AUTH_ENABLED = value;
      const proxy = await loadProxy();
      const res = await proxy(createReq("localhost:3000", "http://localhost:3000/manage"));
      expect(getToken).not.toHaveBeenCalled();
      expect(res.type).toBe("next");
    });
  });

  describe("/manage page gate", () => {
    it("redirects anonymous visitors to signin with a callback url", async () => {
      process.env.HOMEPAGE_AUTH_ENABLED = "true";
      process.env.HOMEPAGE_AUTH_SECRET = "secret";
      getToken.mockResolvedValueOnce(null);

      const proxy = await loadProxy();
      const res = await proxy(createReq("localhost:3000", "http://localhost:3000/manage?tab=2"));
      expect(getToken).toHaveBeenCalledWith({
        req: expect.objectContaining({ url: "http://localhost:3000/manage?tab=2" }),
        secret: "secret",
        secureCookie: false,
      });
      expect(res.type).toBe("redirect");
      expect(String(res.url)).toContain("/auth/signin");
      expect(new URL(res.url).searchParams.get("callbackUrl")).toBe("/manage?tab=2");
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    });

    it("allows authenticated visitors and marks the response private", async () => {
      process.env.HOMEPAGE_AUTH_ENABLED = "true";
      process.env.HOMEPAGE_AUTH_SECRET = "secret";
      getToken.mockResolvedValueOnce({ sub: "user" });

      const proxy = await loadProxy();
      const res = await proxy(createReq("localhost:3000", "http://localhost:3000/manage"));
      expect(res.type).toBe("next");
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    });

    it.each([
      ["NEXTAUTH_URL", "https://homepage.example", true],
      ["NEXTAUTH_URL", "HTTP://homepage.example", false],
      ["HOMEPAGE_EXTERNAL_URL", "HTTPS://homepage.example", true],
      ["HOMEPAGE_EXTERNAL_URL", "homepage.example", false],
    ])("reads the session cookie NextAuth sets when %s is %j", async (variable, url, secure) => {
      process.env.HOMEPAGE_AUTH_ENABLED = "true";
      process.env.HOMEPAGE_AUTH_SECRET = "secret";
      process.env[variable] = url;
      getToken.mockResolvedValueOnce({ sub: "user" });

      const proxy = await loadProxy();
      const res = await proxy(createReq("localhost:3000", "http://localhost:3000/manage"));
      expect(getToken).toHaveBeenCalledWith(expect.objectContaining({ secureCookie: secure }));
      expect(res.type).toBe("next");
    });

    it("evaluates auth settings at request time, not module load", async () => {
      // 模拟生产镜像：模块加载时 auth 关闭，运行期才打开
      const proxy = await loadProxy();
      process.env.HOMEPAGE_AUTH_ENABLED = "true";
      process.env.HOMEPAGE_AUTH_SECRET = "runtime-secret";
      getToken.mockResolvedValueOnce(null);

      const res = await proxy(createReq("localhost:3000", "http://localhost:3000/manage"));
      expect(getToken).toHaveBeenCalledWith(expect.objectContaining({ secret: "runtime-secret" }));
      expect(res.type).toBe("redirect");
    });
  });
});
