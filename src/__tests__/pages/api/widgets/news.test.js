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

function board(content = [FIRST, SECOND], topContent = [TOP], overrides = {}) {
  return {
    success: true,
    data: {
      cards: [
        {
          component: "hotList",
          text: "热搜榜",
          typeName: "realtime",
          updateTime: 1794215334,
          topContent,
          content,
          ...overrides,
        },
      ],
    },
  };
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

// 每个用例重新加载模块，隔离模块级缓存
async function loadHandler() {
  vi.resetModules();
  return (await import("pages/api/widgets/news")).default;
}

async function call(handler) {
  const res = makeRes();
  await (handler || (await loadHandler()))({ query: { index: "3" } }, res);
  return res;
}

describe("pages/api/widgets/news — 百度热搜榜", () => {
  beforeEach(() => {
    getOptionsMock.mockReset();
    getOptionsMock.mockResolvedValue({});
    loggerMock.error.mockReset();
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => board() }));
  });

  it("解析置顶 + 榜单，返回排名/热度/角标与榜单更新时间", async () => {
    const res = await call();
    expect(res.code).toBe(200);
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
    expect(res.payload.feedNames).toEqual(["百度热搜"]);
    expect(res.payload.sources).toBe(1);
    expect(res.payload.total).toBe(2);
    expect(res.payload.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(res.payload.items[0]).toMatchObject({
      title: "置顶热搜",
      link: "https://www.baidu.com/s?wd=top",
      source: "百度热搜",
      rank: 0,
      isTop: true,
      desc: "置顶摘要",
    });
    expect(res.payload.items[1]).toMatchObject({
      title: "为什么小电驴也卖不动了",
      rank: 1,
      hotScore: "7808644",
      hotTag: "新",
      isTop: false,
    });
    expect(res.payload.items[2].hotTag).toBe("热");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://top.baidu.com/api/board?platform=pc&tab=realtime",
      expect.objectContaining({ headers: expect.objectContaining({ Accept: "application/json" }) }),
    );
  });

  it("过滤非法链接、缺标题、重复项，未知角标不透传", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () =>
        board(
          [
            { ...FIRST, url: "javascript:alert(1)" },
            { ...SECOND, word: "  " },
            { ...FIRST, hotTag: "99", url: "https://www.baidu.com/s?wd=one" },
            { ...FIRST, url: "https://www.baidu.com/s?wd=one" },
          ],
          [],
        ),
    }));
    const res = await call();
    expect(res.payload.items).toHaveLength(1);
    expect(res.payload.items[0].link).toBe("https://www.baidu.com/s?wd=one");
    expect(res.payload.items[0].hotTag).toBe("");
  });

  it("1 分钟内复用缓存，不重复请求上游", async () => {
    const handler = await loadHandler();
    await call(handler);
    await call(handler);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(getOptionsMock).toHaveBeenCalledTimes(2);
  });

  it("上游 HTTP 失败时返回空列表与错误标记，并记录日志", async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    const res = await call();
    expect(res.code).toBe(200);
    expect(res.payload.items).toEqual([]);
    expect(res.payload.error).toBe("热搜暂不可用");
    expect(loggerMock.error).toHaveBeenCalled();
  });

  it("数据结构异常时同样降级，不抛出", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: {} }) }));
    const res = await call();
    expect(res.payload.items).toEqual([]);
    expect(loggerMock.error).toHaveBeenCalled();
  });

  it("榜单为空时降级", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => board([], []) }));
    const res = await call();
    expect(res.payload.items).toEqual([]);
    expect(res.payload.error).toBe("热搜暂不可用");
  });
});
