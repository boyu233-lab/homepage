import fs from "fs";
import path from "path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import createMockRes from "test-utils/create-mock-res";

const { CONF_DIR, invalidateDashboardData } = vi.hoisted(() => ({
  CONF_DIR: `${process.env.TEMP || process.env.TMP || "/tmp"}`.replace(/\\/g, "/") +
    `/homepage-upload-api-${process.pid}`,
  invalidateDashboardData: vi.fn(),
}));

vi.mock("utils/config/config", () => ({ CONF_DIR }));
vi.mock("utils/config/dashboard", () => ({ invalidateDashboardData }));

import handler from "pages/api/config/upload";
import { resetRateLimits } from "utils/rate-limit";
import { readConfigFile } from "utils/config/upload";

function clearDir() {
  if (!fs.existsSync(CONF_DIR)) return;
  for (const name of fs.readdirSync(CONF_DIR)) {
    fs.unlinkSync(path.join(CONF_DIR, name));
  }
}

function req(method, body, extra = {}) {
  return {
    method,
    url: "/api/config/upload",
    query: {},
    headers: { host: "localhost:3000" },
    ...(body === undefined ? {} : { body }),
    ...extra,
  };
}

describe("pages/api/config/upload", () => {
  beforeEach(() => {
    fs.mkdirSync(CONF_DIR, { recursive: true });
    clearDir();
    invalidateDashboardData.mockClear();
    resetRateLimits();
    vi.stubEnv("HOMEPAGE_AUTH_ENABLED", "false");
  });

  afterAll(() => {
    clearDir();
    try {
      fs.rmdirSync(CONF_DIR);
    } catch {
      // 目录可能已被其它测试清理
    }
  });

  it("GET 列出 9 个配置文件及上传限制", async () => {
    fs.writeFileSync(path.join(CONF_DIR, "custom.css"), "a{}");
    const res = createMockRes();
    await handler(req("GET"), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.files).toHaveLength(9);
    expect(res.body.files.find((f) => f.name === "custom.css").exists).toBe(true);
    expect(res.body.maxBytes).toBeGreaterThan(0);
    expect(res.body.backupKeep).toBe(10);
    expect(res.headers["Cache-Control"]).toBe("private, no-store");
  });

  it("GET ?download 返回原文与下载头，拒绝白名单外文件", async () => {
    fs.writeFileSync(path.join(CONF_DIR, "custom.css"), "body{color:red}\n");
    const ok = createMockRes();
    await handler(req("GET", undefined, { query: { download: "custom.css" } }), ok);
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe("body{color:red}\n");
    expect(ok.headers["Content-Disposition"]).toContain("custom.css");

    const bad = createMockRes();
    await handler(req("GET", undefined, { query: { download: "../package.json" } }), bad);
    expect(bad.statusCode).toBe(400);
  });

  it("POST validate 预览校验，不写盘", async () => {
    const good = createMockRes();
    await handler(req("POST", { action: "validate", file: "widgets.yaml", content: "- a: b\n" }), good);
    expect(good.statusCode).toBe(200);
    expect(good.body.valid).toBe(true);

    const bad = createMockRes();
    await handler(req("POST", { action: "validate", file: "widgets.yaml", content: "title: 错\n" }), bad);
    expect(bad.statusCode).toBe(400);
    expect(bad.body.error).toMatch(/顶层/);
    expect(fs.readdirSync(CONF_DIR)).toHaveLength(0);
  });

  it("POST upload 写入配置、生成备份并清除 dashboard 缓存", async () => {
    fs.writeFileSync(path.join(CONF_DIR, "custom.css"), "old{}");
    const res = createMockRes();
    await handler(req("POST", { file: "custom.css", content: "new{}" }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.revalidated).toBe(true);
    expect(res.body.backup).toMatch(/\.bak$/);
    expect(readConfigFile(CONF_DIR, "custom.css")).toBe("new{}");
    expect(invalidateDashboardData).toHaveBeenCalledOnce();
  });

  it("POST upload 拒绝白名单外文件名与非法内容，且不改动磁盘", async () => {
    fs.writeFileSync(path.join(CONF_DIR, "settings.yaml"), "title: 原样\n");

    const wrongName = createMockRes();
    await handler(req("POST", { file: "../docker-entrypoint.sh", content: "rm -rf /" }), wrongName);
    expect(wrongName.statusCode).toBe(400);
    expect(wrongName.body.allowed).toHaveLength(9);

    const wrongContent = createMockRes();
    await handler(
      req("POST", { file: "settings.yaml", content: "- 这是数组，不是对象\n" }),
      wrongContent,
    );
    expect(wrongContent.statusCode).toBe(400);
    expect(readConfigFile(CONF_DIR, "settings.yaml")).toBe("title: 原样\n");
  });

  it("POST restore 从备份回滚，非法备份名返回 400", async () => {
    const uploaded = createMockRes();
    await handler(req("POST", { file: "custom.js", content: "console.log('v1')" }), uploaded);
    const second = createMockRes();
    await handler(req("POST", { file: "custom.js", content: "console.log('v2')" }), second);
    expect(readConfigFile(CONF_DIR, "custom.js")).toBe("console.log('v2')");

    const restored = createMockRes();
    await handler(
      req("POST", { action: "restore", file: "custom.js", backup: second.body.backup }),
      restored,
    );
    expect(restored.statusCode).toBe(200);
    expect(readConfigFile(CONF_DIR, "custom.js")).toBe("console.log('v1')");

    const bad = createMockRes();
    await handler(
      req("POST", { action: "restore", file: "custom.js", backup: "../../package.json" }),
      bad,
    );
    expect(bad.statusCode).toBe(400);
  });

  it("跨站写请求返回 403 且不落盘", async () => {
    const res = createMockRes();
    await handler(
      req("POST", { file: "custom.css", content: "evil{}" }, {
        headers: { host: "localhost:3000", "sec-fetch-site": "cross-site", origin: "https://evil.example" },
      }),
      res,
    );
    expect(res.statusCode).toBe(403);
    expect(fs.existsSync(path.join(CONF_DIR, "custom.css"))).toBe(false);
  });

  it("未知操作与不支持的方法分别返回 400 / 405", async () => {
    const unknown = createMockRes();
    await handler(req("POST", { action: "drop-table", file: "custom.css", content: "x" }), unknown);
    expect(unknown.statusCode).toBe(400);

    const method = createMockRes();
    await handler(req("PUT"), method);
    expect(method.statusCode).toBe(405);
    expect(method.headers.Allow).toBe("GET, POST");
  });
});
