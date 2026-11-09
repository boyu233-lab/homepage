import { beforeEach, describe, expect, it, vi } from "vitest";

const { loggerMock, getOptionsMock } = vi.hoisted(() => ({
  loggerMock: { error: vi.fn() },
  getOptionsMock: vi.fn(async () => ({})),
}));

vi.mock("utils/auth", () => ({ withAuth: (handler) => handler }));
vi.mock("utils/config/widget-helpers", () => ({ getPrivateWidgetOptions: getOptionsMock }));
vi.mock("utils/logger", () => ({ default: () => loggerMock }));

const FIRST = {
  bvid: "BV1BZbSzZEGT",
  title: "【无损音质】《<em class=\"keyword\">晴天</em>》- <em class=\"keyword\">周杰伦</em> &amp; 朋友",
  author: "VV音乐局",
  duration: "4:30",
  play: 3460783,
  pubdate: 1753667700,
  arcurl: "http://evil.example/av1",
};
const SECOND = {
  bvid: "BV1d4411N7zD",
  title: "【4K修复】晴天 MV",
  author: "某UP主",
  duration: "1:02:05",
  play: 9800,
  pubdate: 1560167152,
};

function search(result = [FIRST, SECOND], overrides = {}) {
  return { code: 0, message: "OK", data: { numResults: 1000, result }, ...overrides };
}

function makeRes() {
  return {
    payload: null,
    setHeader: vi.fn(),
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };
}

async function loadHandler() {
  vi.resetModules();
  return (await import("pages/api/widgets/bilibili_music")).default;
}

async function call(handler, query = { index: "4", q: "周杰伦 晴天" }) {
  const res = makeRes();
  await (handler || (await loadHandler()))({ query }, res);
  return res;
}

describe("pages/api/widgets/bilibili_music — B站视频搜索", () => {
  beforeEach(() => {
    getOptionsMock.mockReset();
    getOptionsMock.mockResolvedValue({});
    loggerMock.error.mockReset();
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => search() }));
  });

  it("没有关键词时不请求上游，返回空结果", async () => {
    const res = await call(await loadHandler(), { index: "4" });
    expect(res.code).toBe(200);
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
    expect(getOptionsMock).toHaveBeenCalledWith("bilibili_music", "4");
    expect(res.payload).toMatchObject({ query: "", page: 1, items: [] });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("固定请求搜索端点，关键词/页码编码，并带完整浏览器 UA", async () => {
    const res = await call();
    expect(res.code).toBe(200);
    expect(res.payload.query).toBe("周杰伦 晴天");
    expect(res.payload.page).toBe(1);
    expect(res.payload.total).toBe(1000);
    expect(res.payload.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.bilibili.com/x/web-interface/wbi/search/type?search_type=video&keyword=%E5%91%A8%E6%9D%B0%E4%BC%A6+%E6%99%B4%E5%A4%A9&page=1",
      expect.objectContaining({
        headers: expect.objectContaining({
          Referer: "https://search.bilibili.com/",
          "User-Agent": expect.stringContaining("AppleWebKit"), // 简写 UA 会被 B站风控 -352
        }),
      }),
    );
  });

  it("解析搜索结果：剥离高亮标签/HTML 实体，时长转秒，链接按 bvid 白名单拼接", async () => {
    const res = await call();
    expect(res.payload.items[0]).toMatchObject({
      rank: 1,
      bvid: "BV1BZbSzZEGT",
      title: "【无损音质】《晴天》- 周杰伦 & 朋友",
      author: "VV音乐局",
      duration: 270,
      view: 3460783,
      pubdate: 1753667700,
      link: "https://www.bilibili.com/video/BV1BZbSzZEGT",
    });
    expect(res.payload.items[1]).toMatchObject({ rank: 2, duration: 3725, link: "https://www.bilibili.com/video/BV1d4411N7zD" });
    // 上游 arcurl / url 一律不透传
    expect(JSON.stringify(res.payload)).not.toContain("evil.example");
  });

  it("过滤非法 bvid、缺标题、重复项", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () =>
        search([
          { ...FIRST, bvid: "javascript:alert(1)" },
          { ...FIRST, title: "   " },
          { ...FIRST, bvid: "BV1BZbSzZEGT" },
          SECOND,
        ]),
    }));
    const res = await call();
    expect(res.payload.items).toHaveLength(2);
    expect(res.payload.items[0].rank).toBe(1);
    expect(res.payload.items[1].rank).toBe(2);
  });

  it("每页最多 20 条", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      ...FIRST,
      bvid: `BV${String(i).padStart(10, "0")}`,
      title: `视频 ${i}`,
    }));
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => search(many) }));
    const res = await call();
    expect(res.payload.items).toHaveLength(20);
    expect(res.payload.total).toBe(1000);
  });

  it("相同关键词+页码复用缓存，不同关键词/页码分别请求", async () => {
    const handler = await loadHandler();
    const q = { index: "4", q: "晴天", refreshInterval: "600000" };
    await call(handler, q);
    await call(handler, q);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await call(handler, { ...q, q: "夜曲" });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    await call(handler, { ...q, page: "2" });
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("cacheTTL 默认 10 分钟，clamp 到 1 分钟 ~ 24 小时", async () => {
    const { cacheTTL } = await import("pages/api/widgets/bilibili_music");
    expect(cacheTTL(undefined)).toBe(10 * 60 * 1000);
    expect(cacheTTL("600000")).toBe(10 * 60 * 1000);
    expect(cacheTTL(1000)).toBe(60 * 1000);
    expect(cacheTTL(100 * 24 * 60 * 60 * 1000)).toBe(24 * 60 * 60 * 1000);
    expect(cacheTTL("not-a-number")).toBe(10 * 60 * 1000);
  });

  it("缓存过期后自动重拉", async () => {
    vi.useFakeTimers();
    try {
      const handler = await loadHandler();
      const q = { index: "4", q: "晴天", refreshInterval: "600000" };
      await call(handler, q);
      vi.setSystemTime(Date.now() + 9 * 60 * 1000);
      await call(handler, q);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      vi.setSystemTime(Date.now() + 2 * 60 * 1000);
      await call(handler, q);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("force=1 跳过缓存，但 60 秒内仍受最小间隔保护", async () => {
    vi.useFakeTimers();
    try {
      const handler = await loadHandler();
      const q = { index: "4", q: "晴天", refreshInterval: "600000" };
      await call(handler, q);
      await call(handler, { ...q, force: "1" });
      expect(global.fetch).toHaveBeenCalledTimes(1);
      vi.setSystemTime(Date.now() + 61 * 1000);
      await call(handler, { ...q, force: "1" });
      expect(global.fetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("空搜索结果是正常业务结果，不降级报错", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => search([]) }));
    const res = await call();
    expect(res.payload.items).toEqual([]);
    expect(res.payload.error).toBeUndefined();
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it("上游 HTTP 失败 / 风控 code != 0 / 结构异常时降级为空列表", async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 412, json: async () => ({}) }));
    expect((await call()).payload).toMatchObject({ items: [], error: "搜索暂不可用" });

    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ code: -352, message: "风控校验失败" }) }));
    expect((await call()).payload.error).toBe("搜索暂不可用");

    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: {} }) }));
    expect((await call()).payload.error).toBe("搜索暂不可用");
    expect(loggerMock.error).toHaveBeenCalledTimes(3);
  });

  it("normalizeQuery / normalizePage / cleanText / parseDuration 边界", async () => {
    const { normalizeQuery, normalizePage, cleanText, parseDuration } = await import("pages/api/widgets/bilibili_music");
    expect(normalizeQuery("  周杰伦\t晴天  ")).toBe("周杰伦 晴天");
    expect(normalizeQuery("x".repeat(100))).toHaveLength(60);
    expect(normalizeQuery(["周杰伦", "晴天"])).toBe("周杰伦");
    expect(normalizeQuery(undefined)).toBe("");
    expect(normalizePage("3")).toBe(3);
    expect(normalizePage("999")).toBe(10);
    expect(normalizePage("abc")).toBe(1);
    expect(cleanText('<em class="keyword">A</em> &amp; B&nbsp;C')).toBe("A & B C");
    expect(parseDuration("4:30")).toBe(270);
    expect(parseDuration("1:02:05")).toBe(3725);
    expect(parseDuration(215)).toBe(215);
    expect(parseDuration(undefined)).toBe(0);
  });
});
