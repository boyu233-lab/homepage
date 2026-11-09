import { beforeEach, describe, expect, it, vi } from "vitest";

const { loggerMock, getOptionsMock } = vi.hoisted(() => ({
  loggerMock: { error: vi.fn() },
  getOptionsMock: vi.fn(async () => ({})),
}));

vi.mock("utils/auth", () => ({ withAuth: (handler) => handler }));
vi.mock("utils/config/widget-helpers", () => ({ getPrivateWidgetOptions: getOptionsMock }));
vi.mock("utils/logger", () => ({ default: () => loggerMock }));

const BVID = "BV1sX8A6bEPr";
const VIEW_OK = {
  code: 0,
  message: "OK",
  data: {
    bvid: BVID,
    title: "百听不厌的120首纯音乐（经典不朽合集）",
    owner: { name: "北流嘉措" },
    cid: 41105096717,
    duration: 30984,
    pages: [
      { page: 1, cid: 41105096717, part: "01.晚星 - 逆时针向", duration: 194 },
      { page: 2, cid: 41105097363, part: "02.夏恋 - Otokaze", duration: 267 },
      { page: 3, cid: 41105098152, part: "03.秋日私语 - <em>Richard Clayderman</em>", duration: 209 },
      { page: 4, cid: 0, part: "无效分P", duration: 100 },
    ],
  },
};

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
  return (await import("pages/api/widgets/bilibili_pages")).default;
}

async function call(query = { index: "4", bvid: BVID }, handler) {
  const res = makeRes();
  await (handler || (await loadHandler()))({ query }, res);
  return res;
}

describe("pages/api/widgets/bilibili_pages — B站视频选集", () => {
  beforeEach(() => {
    getOptionsMock.mockReset();
    getOptionsMock.mockResolvedValue({});
    loggerMock.error.mockReset();
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => VIEW_OK }));
  });

  it("非法 bvid 直接 400，且不请求上游", async () => {
    const res = await call({ index: "4", bvid: "javascript:alert(1)" });
    expect(res.code).toBe(400);
    expect(res.payload.error).toBe("invalid bvid");
    expect(global.fetch).not.toHaveBeenCalled();
    expect(getOptionsMock).toHaveBeenCalledWith("bilibili_music", "4");
  });

  it("固定请求 wbi/view，按分P返回 cid / 曲名 / 时长 / 带 ?p= 的链接", async () => {
    const res = await call();
    expect(res.code).toBe(200);
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
    expect(global.fetch.mock.calls[0][0]).toBe(
      `https://api.bilibili.com/x/web-interface/wbi/view?bvid=${BVID}`,
    );
    expect(global.fetch.mock.calls[0][1].headers).toMatchObject({
      Referer: "https://www.bilibili.com/",
      "User-Agent": expect.stringContaining("AppleWebKit"),
    });
    expect(res.payload).toMatchObject({
      bvid: BVID,
      title: "百听不厌的120首纯音乐（经典不朽合集）",
      author: "北流嘉措",
      total: 3,
      link: `https://www.bilibili.com/video/${BVID}`,
    });
    expect(res.payload.items[0]).toEqual({
      page: 1,
      cid: 41105096717,
      part: "01.晚星 - 逆时针向",
      duration: 194,
      link: `https://www.bilibili.com/video/${BVID}?p=1`,
    });
    expect(res.payload.items[2].part).toBe("03.秋日私语 - Richard Clayderman"); // 剥掉 HTML 标签
    expect(res.payload.items).toHaveLength(3); // cid 非法的分P被丢弃
  });

  it("同一 bvid 复用缓存，force=1 才重新拉上游", async () => {
    const handler = await loadHandler();
    const q = { index: "4", bvid: BVID };
    await call(q, handler);
    await call(q, handler);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await call({ ...q, force: "1" }, handler);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("单P视频没有 pages 时用顶层 cid 兜底成一个分P", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { title: "单曲", cid: 31268997329, duration: 270 } }),
    }));
    const res = await call();
    expect(res.payload.total).toBe(1);
    expect(res.payload.items[0]).toMatchObject({ page: 1, cid: 31268997329, duration: 270 });
  });

  it("上游失败 / 风控 / 无分P时降级为空选集，不抛异常", async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 412, json: async () => ({}) }));
    expect(await call()).toMatchObject({ payload: { error: "选集暂不可用", items: [] } });

    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ code: -352 }) }));
    expect((await call()).payload.error).toBe("选集暂不可用");

    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ code: 0, data: {} }) }));
    expect((await call()).payload.error).toBe("选集暂不可用");
    expect(loggerMock.error).toHaveBeenCalledTimes(3);
  });

  it("cidInView 只允许该视频真实存在的分P", async () => {
    const { cidInView } = await import("utils/bilibili-view");
    const { normalizeView } = await import("utils/bilibili-view");
    const view = normalizeView(VIEW_OK, BVID);
    expect(cidInView(view, 41105097363)).toBe(true);
    expect(cidInView(view, 999999)).toBe(false);
    expect(cidInView(view, undefined)).toBe(false);
  });
});
