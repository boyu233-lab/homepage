import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// v1.1-1 回归门禁：逐条固化 5 个上游 GHSA 在本 fork 的等效防护，
// 以及 4 个自定义 widget 端点必须接入公开读限流。
// 这里断言的是「防护仍然存在于代码中」——将来追上游 / 重构时若被误删会立刻红灯。
function source(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

function rootSource(relativePath) {
  return readFileSync(new URL(`../../../${relativePath}`, import.meta.url), "utf8");
}

describe("GHSA 等效防护回归", () => {
  it("GHSA-qxcr-4rv3-v23r：revalidate 走 withAuth，敏感路径在 RESERVED_PATHS", () => {
    expect(source("pages/api/revalidate.js")).toContain("withAuth(handler)");
    const auth = source("utils/auth.js");
    for (const path of [
      "/api/config/bookmarks",
      "/api/config/upload",
      "/api/services/proxy",
      "/api/revalidate",
      "/api/mcp",
    ]) {
      expect(auth).toContain(`"${path}"`);
    }
  });

  it("GHSA-qxcr-4rv3-v23r：proxy 拒绝伪造重验证头，/manage 有页面层兜底", () => {
    expect(source("proxy.js")).toContain("x-prerender-revalidate");
    const manage = source("pages/manage.jsx");
    expect(manage).toContain("getServerSideProps");
    expect(manage).toContain("withPageAuth");
  });

  it("GHSA-669x-4pg4-w24r：service proxy 无 endpoint 时强制 GET 并清空 body", () => {
    const proxy = source("pages/api/services/proxy.js");
    expect(proxy).toContain('req.method = "GET"');
    expect(proxy).toContain("req.body = undefined");
  });

  it("GHSA-rg3r-jprv-xq38：glances version 经 parseVersionForUrl 规范化", () => {
    expect(source("pages/api/widgets/glances.js")).toContain("parseVersionForUrl(version, 3)");
    const helper = source("utils/proxy/api-helpers.js");
    expect(helper).toContain("export function parseVersionForUrl");
  });

  it("GHSA-c4qv-fm8g-wm67：resources disk 只按挂载点匹配，不做文件系统探测", () => {
    const resources = source("pages/api/widgets/resources.js");
    expect(resources).toContain("si.fsSize()");
    expect(resources).toContain("fs.mount === requested");
    expect(resources).not.toContain("existsSync");
    expect(resources).not.toContain("statSync");
  });

  it("GHSA-24m5-7vjx-9x37：基线高于 0.9.1，package.json 已追平上游 v2.7.0", () => {
    expect(JSON.parse(rootSource("package.json")).version).toBe("2.7.0");
  });

  it("A3：NextAuth 有登录失败锁定与弱 secret 检测", () => {
    const nextauth = source("pages/api/auth/[...nextauth].js");
    expect(nextauth).toContain("loginLimiter.isLocked");
    expect(nextauth).toContain("secretWeakness");
    expect(nextauth).toContain("MIN_AUTH_SECRET_LENGTH");
  });
});

describe("A2：4 个自定义 widget 端点接入公开读防护", () => {
  const files = ["news.js", "bilibili_music.js", "bilibili_pages.js", "bilibili_audio.js"];
  it.each(files)("%s 使用 withPublicWidgetGuard", (file) => {
    const code = source(`pages/api/widgets/${file}`);
    expect(code).toContain("withPublicWidgetGuard");
    expect(code).toMatch(/export default withAuth\(withPublicWidgetGuard\(handler,/);
  });

  it("音频端点使用最严格的 audio 策略", () => {
    expect(source("pages/api/widgets/bilibili_audio.js")).toContain('withPublicWidgetGuard(handler, "audio")');
  });
});
