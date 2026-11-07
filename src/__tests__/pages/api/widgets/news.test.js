import { beforeEach, describe, expect, it, vi } from "vitest";

const { loggerMock, getOptionsMock } = vi.hoisted(() => ({
  loggerMock: { error: vi.fn() },
  getOptionsMock: vi.fn(async () => ({})),
}));

vi.mock("utils/auth", () => ({ withAuth: (handler) => handler }));
vi.mock("utils/config/widget-helpers", () => ({ getPrivateWidgetOptions: getOptionsMock }));
vi.mock("utils/logger", () => ({ default: () => loggerMock }));
vi.mock("widgets/feed/utils", () => ({
  parseFeed: () => [{ title: "测试标题", link: "https://example.com/a", date: "2026-11-07T10:00:00Z" }],
}));

import handler from "pages/api/widgets/news";

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

async function call() {
  const res = makeRes();
  await handler({ query: { index: "3" } }, res);
  return res;
}

describe("pages/api/widgets/news", () => {
  beforeEach(() => {
    delete process.env.HOMEPAGE_NEWS_SOURCES;
    delete process.env.HOMEPAGE_NEWS_FEEDS;
    getOptionsMock.mockReset();
    getOptionsMock.mockResolvedValue({});
    loggerMock.error.mockReset();
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "<rss><channel><item/></channel></rss>",
    }));
  });

  it("默认启用三个中文源，并把源名返回给前端做筛选标签", async () => {
    const res = await call();
    expect(res.code).toBe(200);
    expect(res.payload.feedNames).toEqual(["百度新闻", "新浪国内", "IT之家"]);
    expect(res.payload.sources).toBe(3);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("HOMEPAGE_NEWS_SOURCES 可按 key 或中文名挑选来源", async () => {
    process.env.HOMEPAGE_NEWS_SOURCES = "ithome, 少数派";
    const res = await call();
    expect(res.payload.feedNames).toEqual(["IT之家", "少数派"]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("HOMEPAGE_NEWS_FEEDS 支持「名称=地址」自定义源", async () => {
    process.env.HOMEPAGE_NEWS_FEEDS = "公司公告=https://example.com/rss.xml,IT之家=https://www.ithome.com/rss/";
    const res = await call();
    expect(res.payload.feedNames).toEqual(["公司公告", "IT之家"]);
  });

  it("优先级：SOURCES > FEEDS > news.url", async () => {
    process.env.HOMEPAGE_NEWS_SOURCES = "baidu";
    process.env.HOMEPAGE_NEWS_FEEDS = "自定义=https://example.com/rss.xml";
    getOptionsMock.mockResolvedValue({ url: "配置源=https://example.com/2.xml" });
    const res = await call();
    expect(res.payload.feedNames).toEqual(["百度新闻"]);
  });

  it("widgets.yaml 私有的 news.url 也能配自定义源", async () => {
    getOptionsMock.mockResolvedValue({ url: "配置源=https://example.com/2.xml" });
    const res = await call();
    expect(res.payload.feedNames).toEqual(["配置源"]);
  });

  it("拒绝非 http(s) 与带凭据的地址，回退默认源", async () => {
    process.env.HOMEPAGE_NEWS_FEEDS = "javascript:alert(1),ftp://example.com/a.xml";
    const res = await call();
    expect(res.payload.feedNames).toEqual(["百度新闻", "新浪国内", "IT之家"]);
  });
});
