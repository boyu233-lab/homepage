import { beforeEach, describe, expect, it, vi } from "vitest";

const { loggerMock, getOptionsMock } = vi.hoisted(() => ({
  loggerMock: { error: vi.fn() },
  getOptionsMock: vi.fn(async () => ({})),
}));

vi.mock("utils/auth", () => ({ withAuth: (handler) => handler }));
vi.mock("utils/config/widget-helpers", () => ({ getPrivateWidgetOptions: getOptionsMock }));
vi.mock("utils/logger", () => ({ default: () => loggerMock }));

const TOP = { word: "置顶热搜", url: "https://www.baidu.com/s?wd=top", hotScore: "7904533", desc: "置顶摘要" };
const FIRST = {
  index: "0",
  word: "为什么小电驴也卖不动了",
  url: "https://www.baidu.com/s?wd=one",
  hotScore: "7808644",
  hotTag: "1",
  desc: "摘要一",
};
const SECOND = {
  index: "1",
  word: "哈工大研究生卖气球月入3千",
  url: "https://www.baidu.com/s?wd=two",
  hotScore: "7139811",
  hotTag: "3",
  desc: "摘要二",
};

function baidu(content = [FIRST, SECOND], topContent = [TOP]) {
  return {
    success: true,
    data: {
      cards: [
        {
          component: "hotList",
          text: "热搜榜",
          updateTime: 1794215334,
          topContent,
          content,
        },
      ],
    },
  };
}

const RSS = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel><title>IT之家</title>
<item><title>新闻一</title><link>https://www.ithome.com/0/1.htm</link><description><![CDATA[<p>摘要 &amp; 内容</p>]]></description><pubDate>Mon, 09 Nov 2026 12:07:54 GMT</pubDate></item>
<item><title><![CDATA[新闻二]]></title><link>https://www.ithome.com/0/2.htm</link><description>纯文本摘要</description><pubDate>Mon, 09 Nov 2026 10:00:00 GMT</pubDate></item>
<item><title>坏链接</title><link>javascript:alert(1)</link><description>忽略</description></item>
</channel></rss>`;

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

async function loadModule() {
  vi.resetModules();
  return import("pages/api/widgets/news");
}

async function call(handler, query = { index: "3" }) {
  const res = makeRes();
  await (handler || (await loadModule()).default)({ query }, res);
  return res;
}

function mockJSON(body) {
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }));
}

function mockText(body) {
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => body, json: async () => ({}) }));
}

describe("pages/api/widgets/news — 多源热榜与资讯", () => {
  beforeEach(() => {
    getOptionsMock.mockReset();
    getOptionsMock.mockResolvedValue({});
    loggerMock.error.mockReset();
    mockJSON(baidu());
  });

  it("默认百度热搜：置顶 ↑、排名、热度、角标与更新时间", async () => {
    const res = await call();
    expect(res.code).toBe(200);
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
    expect(getOptionsMock).toHaveBeenCalledWith("news", "3");
    expect(res.payload.source).toBe("baidu");
    expect(res.payload.sourceLabel).toBe("百度热搜");
    expect(res.payload.boardName).toBe("热搜榜");
    expect(res.payload.feedNames).toEqual(["百度热搜"]);
    expect(res.payload.items).toHaveLength(3);
    expect(res.payload.items[0]).toMatchObject({
      title: "置顶热搜",
      rank: 0,
      isTop: true,
      hotScore: "7904533",
      link: "https://www.baidu.com/s?wd=top",
    });
    expect(res.payload.items[1]).toMatchObject({ rank: 1, hotTag: "新", hotScore: "7808644" });
    expect(res.payload.items[2]).toMatchObject({ rank: 2, hotTag: "热" });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://top.baidu.com/api/board?platform=pc&tab=realtime",
      expect.any(Object),
    );
  });

  it("返回 9 个可用源，含热榜与资讯两类", async () => {
    const { AVAILABLE_SOURCES } = await loadModule();
    expect(AVAILABLE_SOURCES).toHaveLength(9);
    expect(AVAILABLE_SOURCES.map((s) => s.key)).toEqual([
      "baidu", "weibo", "zhihu", "toutiao", "douyin", "bilibili", "bing", "ithome", "sspai",
    ]);
    expect(AVAILABLE_SOURCES.filter((s) => s.kind === "news").map((s) => s.key)).toEqual(["bing", "ithome", "sspai"]);
    expect((await call()).payload.availableSources).toHaveLength(9);
  });

  it("未知 / 伪造的 source 参数回退百度，URL 永远来自白名单", async () => {
    const handler = (await loadModule()).default;
    await call(handler, { index: "3", source: "https://evil.example/x" });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://top.baidu.com/api/board?platform=pc&tab=realtime",
      expect.any(Object),
    );
    await call(handler, { index: "3", source: "not-a-source" });
    expect(global.fetch).toHaveBeenCalledTimes(1); // 命中百度缓存
  });

  it("切换源会请求对应官方接口，各源独立缓存互不串味", async () => {
    const handler = (await loadModule()).default;
    const weiboBody = {
      ok: 1,
      data: {
        realtime: [
          { word: "微博第一条", num: 6247853, realpos: 1, label_name: "新", note: "微博摘要", word_scheme: "#微博第一条#" },
          { word: "广告", num: 1, is_ad: true },
        ],
      },
    };
    // 同一个 mock 跨源复用，按 URL 分发响应，保持调用计数连续
    global.fetch = vi.fn(async (url) => ({
      ok: true,
      status: 200,
      json: async () => (String(url).includes("weibo.com") ? weiboBody : baidu()),
      text: async () => "",
    }));
    await call(handler, { index: "3", source: "weibo" });
    expect(global.fetch).toHaveBeenCalledWith("https://weibo.com/ajax/side/hotSearch", expect.any(Object));
    const { payload } = await call(handler, { index: "3", source: "weibo" });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(payload.sourceLabel).toBe("微博热搜");
    expect(payload.items).toHaveLength(1); // 广告被过滤
    expect(payload.items[0]).toMatchObject({ rank: 1, hotScore: "6247853", hotTag: "新" });
    expect(payload.items[0].link).toContain("https://s.weibo.com/weibo?q=");

    const back = await call(handler, { index: "3", source: "baidu" });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(back.payload.sourceLabel).toBe("百度热搜");
  });

  it("知乎热榜：api 链接转成网页链接，热度由「万热度」换算", async () => {
    const { parseSource } = await loadModule();
    const parsed = parseSource("zhihu", {
      data: [
        {
          target: {
            id: 2102487963552765120,
            title: "知乎问题一",
            url: "https://api.zhihu.com/questions/2102487963552765120",
            created: 1794052192,
            excerpt: "问题摘要",
          },
          detail_text: "1748 万热度",
        },
      ],
    });
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]).toMatchObject({
      title: "知乎问题一",
      link: "https://www.zhihu.com/question/2102487963552765120",
      rank: 1,
      hotScore: "17480000",
      desc: "问题摘要",
    });
  });

  it("头条热榜：用 ClusterIdStr 拼干净链接，标签只映射已知值", async () => {
    const { parseSource } = await loadModule();
    const parsed = parseSource("toutiao", {
      data: [
        { Title: "头条一", HotValue: "77680012", Label: "hot", ClusterIdStr: "7706070287443329034", QueryWord: "摘要" },
        { Title: "头条二", HotValue: "123", Label: "unknown", ClusterIdStr: "123456", QueryWord: "" },
      ],
    });
    expect(parsed.items[0].link).toBe("https://www.toutiao.com/trending/7706070287443329034/");
    expect(parsed.items[0].hotTag).toBe("热");
    expect(parsed.items[1].hotTag).toBe("");
  });

  it("抖音与 B站热搜：链接由关键词白名单拼接，不透传上游 URL", async () => {
    const { parseSource } = await loadModule();
    const douyin = parseSource("douyin", { word_list: [{ word: "后知后觉又过了一个秋", hot_value: 12095152 }] });
    expect(douyin.items[0].link).toBe("https://www.douyin.com/search/%E5%90%8E%E7%9F%A5%E5%90%8E%E8%A7%89%E5%8F%88%E8%BF%87%E4%BA%86%E4%B8%80%E4%B8%AA%E7%A7%8B");
    expect(douyin.items[0].hotScore).toBe("12095152");

    const bili = parseSource("bilibili", {
      data: { trending: { list: [{ keyword: "Faker", show_name: "回看30岁Faker", heat_score: 13033733 }] } },
    });
    expect(bili.items[0].link).toBe("https://search.bilibili.com/all?keyword=Faker");
    expect(bili.items[0].hotScore).toBe("13033733");
  });

  it("RSS 资讯：CDATA / HTML 去标签、pubDate 转 ISO、非 http(s) 链接丢弃", async () => {
    const { parseSource } = await loadModule();
    const parsed = parseSource("ithome", RSS);
    expect(parsed.boardName).toBe("IT之家");
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0]).toMatchObject({
      title: "新闻一",
      link: "https://www.ithome.com/0/1.htm",
      rank: 1,
      hotScore: "",
      desc: "摘要 & 内容",
    });
    expect(parsed.items[0].date).toMatch(/^2026-11-09T/);
    expect(parsed.items[1].title).toBe("新闻二");
  });

  it("资讯源按文本读取、缓存 5 分钟；请求头带各自 Referer", async () => {
    const handler = (await loadModule()).default;
    mockText(RSS);
    const res = await call(handler, { index: "3", source: "sspai" });
    expect(res.payload.kind).toBe("news");
    expect(res.payload.sourceLabel).toBe("少数派");
    expect(res.payload.items.length).toBeGreaterThan(0);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://sspai.com/feed",
      expect.objectContaining({ headers: expect.objectContaining({ Referer: "https://sspai.com/" }) }),
    );
    await call(handler, { index: "3", source: "sspai" });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("上游失败时降级为空列表 + 按源命名的错误，仍返回可用源列表", async () => {
    const handler = (await loadModule()).default;
    global.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => "" }));
    const res = await call(handler, { index: "3", source: "zhihu" });
    expect(res.code).toBe(200);
    expect(res.payload.items).toEqual([]);
    expect(res.payload.error).toBe("知乎热榜暂不可用");
    expect(res.payload.availableSources).toHaveLength(9);
    expect(loggerMock.error).toHaveBeenCalled();
  });

  it("百度源结构异常 / 非法链接时降级，不抛出", async () => {
    const handler = (await loadModule()).default;
    mockJSON(baidu([{ ...FIRST, url: "javascript:alert(1)" }], []));
    const res = await call(handler);
    expect(res.payload.items).toEqual([]);
    expect(res.payload.error).toBe("百度热搜暂不可用");
  });
});
