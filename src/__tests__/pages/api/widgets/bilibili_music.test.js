import { beforeEach, describe, expect, it, vi } from "vitest";

const { loggerMock, getOptionsMock } = vi.hoisted(() => ({
  loggerMock: { error: vi.fn() },
  getOptionsMock: vi.fn(async () => ({})),
}));

vi.mock("utils/auth", () => ({ withAuth: (handler) => handler }));
vi.mock("utils/config/widget-helpers", () => ({ getPrivateWidgetOptions: getOptionsMock }));
vi.mock("utils/logger", () => ({ default: () => loggerMock }));

const FIRST = {
  bvid: "BV17VZpY1ENA",
  title: "给我们的组合起个名！",
  tname: "翻唱",
  duration: 15,
  pubdate: 1743423401,
  owner: { name: "田一名sir" },
  stat: { view: 17882158, like: 1535728 },
};
const SECOND = {
  bvid: "BV1GJ411x7h7",
  title: "第二首歌",
  tname: "原创音乐",
  duration: 215,
  pubdate: 1743423500,
  owner: { name: "某UP主" },
  stat: { view: 9800, like: 320 },
};

function ranking(list = [FIRST, SECOND], overrides = {}) {
  return { code: 0, message: "OK", data: { note: "音乐区排行", list }, ...overrides };
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

async function call(handler) {
  const res = makeRes();
  await (handler || (await loadHandler()))({ query: { index: "4" } }, res);
  return res;
}

describe("pages/api/widgets/bilibili_music — B站音乐区排行榜", () => {
  beforeEach(() => {
    getOptionsMock.mockReset();
    getOptionsMock.mockResolvedValue({});
    loggerMock.error.mockReset();
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ranking() }));
  });

  it("固定请求音乐区排行，解析出排名/标题/UP主/时长/播放数并白名单拼接链接", async () => {
    const res = await call();
    expect(res.code).toBe(200);
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
    expect(getOptionsMock).toHaveBeenCalledWith("bilibili_music", "4");
    expect(res.payload.feedNames).toEqual(["B站音乐榜"]);
    expect(res.payload.boardName).toBe("音乐榜");
    expect(res.payload.total).toBe(2);
    expect(res.payload.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(res.payload.items[0]).toMatchObject({
      rank: 1,
      bvid: "BV17VZpY1ENA",
      title: "给我们的组合起个名！",
      author: "田一名sir",
      category: "翻唱",
      duration: 15,
      view: 17882158,
      like: 1535728,
      link: "https://www.bilibili.com/video/BV17VZpY1ENA",
    });
    expect(res.payload.items[1].rank).toBe(2);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.bilibili.com/x/web-interface/ranking/v2?rid=3&type=all",
      expect.objectContaining({
        headers: expect.objectContaining({ Referer: "https://www.bilibili.com/" }),
      }),
    );
  });

  it("过滤非法 bvid、缺标题、重复项，链接不接受上游 URL", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () =>
        ranking([
          { ...FIRST, bvid: "javascript:alert(1)" },
          { ...FIRST, title: "   " },
          { ...FIRST, bvid: "BV17VZpY1ENA", link: "http://evil.example/x" },
          { ...FIRST, bvid: "BV17VZpY1ENA" },
          SECOND,
        ]),
    }));
    const res = await call();
    expect(res.payload.items).toHaveLength(2);
    expect(res.payload.items[0].link).toBe("https://www.bilibili.com/video/BV17VZpY1ENA");
    expect(res.payload.items[0].rank).toBe(1);
    expect(res.payload.items[1].rank).toBe(2);
  });

  it("最多返回 50 条", async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      ...FIRST,
      bvid: `BV${String(i).padStart(10, "0")}`,
      title: `歌曲 ${i}`,
    }));
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ranking(many) }));
    const res = await call();
    expect(res.payload.items).toHaveLength(50);
    expect(res.payload.total).toBe(60);
  });

  it("5 分钟内复用缓存，不重复请求上游", async () => {
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
    expect(res.payload.error).toBe("音乐榜暂不可用");
    expect(loggerMock.error).toHaveBeenCalled();
  });

  it("B站风控返回非 0 code 时同样降级", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ code: -352, message: "风控校验失败" }),
    }));
    const res = await call();
    expect(res.payload.items).toEqual([]);
    expect(res.payload.error).toBe("音乐榜暂不可用");
  });

  it("榜单为空或结构异常时降级，不抛出", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ranking([]) }));
    expect((await call()).payload.error).toBe("音乐榜暂不可用");
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: {} }) }));
    expect((await call()).payload.error).toBe("音乐榜暂不可用");
    expect(loggerMock.error).toHaveBeenCalled();
  });
});
