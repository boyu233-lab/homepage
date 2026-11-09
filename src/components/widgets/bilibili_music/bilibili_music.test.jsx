// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { swrMock } = vi.hoisted(() => ({ swrMock: vi.fn() }));

vi.mock("swr", () => ({ default: swrMock }));
vi.mock("../widget/container", () => ({
  default: ({ children }) => <div data-testid="bili-container">{children}</div>,
}));
vi.mock("../widget/raw", () => ({ default: ({ children }) => <>{children}</> }));

import BilibiliMusic, { formatCount, formatDuration } from "./bilibili_music";

const BVID = "BV1sX8A6bEPr";
const COLLECTION = "百听不厌的120首纯音乐（经典不朽合集）";

const items = [
  {
    rank: 1,
    bvid: BVID,
    title: COLLECTION,
    author: "北流嘉措",
    duration: 270,
    view: 1164000,
    link: `https://www.bilibili.com/video/${BVID}`,
  },
  {
    rank: 2,
    bvid: "BV1d4411N7zD",
    title: "在纯音乐里面，我们就是歌词",
    author: "某UP主",
    duration: 3725,
    view: 9800,
    link: "https://www.bilibili.com/video/BV1d4411N7zD",
  },
  {
    rank: 3,
    bvid: "BV1xx411c7mD",
    title: "第三个视频",
    author: "另一UP主",
    duration: 65,
    view: 123456789,
    link: "https://www.bilibili.com/video/BV1xx411c7mD",
  },
];

const payload = {
  query: "纯音乐",
  page: 1,
  total: 1000,
  items,
  updatedAt: "2026-11-09T12:08:54.000Z",
};

const parts = [
  { page: 1, cid: 41105096717, part: "01.晚星 - 逆时针向", duration: 194, link: `https://www.bilibili.com/video/${BVID}?p=1` },
  { page: 2, cid: 41105097363, part: "02.夏恋 - Otokaze", duration: 267, link: `https://www.bilibili.com/video/${BVID}?p=2` },
  { page: 3, cid: 41105098152, part: "03.秋日私语 - Richard Clayderman", duration: 209, link: `https://www.bilibili.com/video/${BVID}?p=3` },
];

const pagesPayload = {
  bvid: BVID,
  title: COLLECTION,
  author: "北流嘉措",
  link: `https://www.bilibili.com/video/${BVID}`,
  total: 3,
  items: parts,
  updatedAt: "2026-11-09T12:09:00.000Z",
};

const mutate = vi.fn();
const pagesMutate = vi.fn();

function mockSWR(searchOverrides = {}, pagesOverrides = {}) {
  swrMock.mockImplementation((key) =>
    typeof key === "string" && key.includes("bilibili_pages")
      ? { data: pagesPayload, error: undefined, isValidating: false, mutate: pagesMutate, ...pagesOverrides }
      : { data: payload, error: undefined, isValidating: false, mutate, ...searchOverrides },
  );
}

function searchFor(text) {
  fireEvent.change(screen.getByRole("searchbox", { name: "搜索关键词" }), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "搜索 B站视频" }));
}

function openCollection() {
  fireEvent.click(screen.getByRole("button", { name: `打开选集 ${COLLECTION}` }));
}

describe("components/widgets/bilibili_music — 搜索 → 视频选集 → 逐首纯音频播放", () => {
  beforeEach(() => {
    window.localStorage.clear();
    swrMock.mockReset();
    mutate.mockReset();
    pagesMutate.mockReset();
    global.fetch = vi.fn(async () => ({ json: async () => payload }));
    mockSWR();
  });

  it("初始为搜索起始态：两个请求 key 都是 null，显示输入框与提示", () => {
    render(<BilibiliMusic options={{ index: 4 }} />);
    expect(swrMock).toHaveBeenCalledWith(null, expect.any(Object));
    expect(swrMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("searchbox", { name: "搜索关键词" })).toBeInTheDocument();
    expect(screen.getByText("输入关键词搜索 B站视频，点开结果即可查看选集并播放")).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /^打开选集 / })).toHaveLength(0);
  });

  it("提交关键词后按 q/page/refreshInterval 请求搜索并列出「视频」结果", () => {
    render(<BilibiliMusic options={{ index: 4 }} />);
    searchFor("纯音乐");

    expect(swrMock).toHaveBeenCalledWith(
      expect.stringContaining("q=%E7%BA%AF%E9%9F%B3%E4%B9%90"),
      expect.any(Object),
    );
    expect(screen.getAllByRole("button", { name: /^打开选集 / })).toHaveLength(3);
    expect(screen.getByText(COLLECTION)).toBeInTheDocument();
    expect(screen.getByText("116.4万 · 4:30")).toBeInTheDocument();
    expect(screen.getByText("9800 · 1:02:05")).toBeInTheDocument();
    expect(screen.getByText("1.2亿 · 1:05")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: `在 B站打开 ${COLLECTION}` })).toHaveAttribute(
      "href",
      `https://www.bilibili.com/video/${BVID}`,
    );
    expect(screen.getByText(/第 1 页 · 更新于/)).toBeInTheDocument();
  });

  it("搜索词记入最近搜索，起始态可一键再次搜索", () => {
    const first = render(<BilibiliMusic options={{ index: 4 }} />);
    searchFor("晴天");
    expect(JSON.parse(window.localStorage.getItem("homepage.bilibiliRecent"))).toEqual(["晴天"]);
    first.unmount();

    render(<BilibiliMusic options={{ index: 4 }} />);
    expect(screen.getByText("最近搜索")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "晴天" }));
    expect(swrMock).toHaveBeenCalledWith(expect.stringContaining("q=%E6%99%B4%E5%A4%A9"), expect.any(Object));
  });

  it("点开视频后按 bvid 请求选集，歌单变成该视频的分P而不是搜索结果", () => {
    render(<BilibiliMusic options={{ index: 4 }} />);
    searchFor("纯音乐");
    expect(document.querySelector("audio")).toBeNull();

    openCollection();

    expect(swrMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/widgets/bilibili_pages?index=4&bvid=BV1sX8A6bEPr"),
      expect.any(Object),
    );
    expect(screen.getByRole("button", { name: "返回搜索结果" })).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /^打开选集 / })).toHaveLength(0);
    // 关键：3 条是同一个视频的 3 个分P，不是 3 个不同标题的搜索结果
    expect(screen.getAllByRole("button", { name: /^播放 / })).toHaveLength(3);
    expect(screen.getByRole("button", { name: "播放 01.晚星 - 逆时针向" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "播放 02.夏恋 - Otokaze" })).toBeInTheDocument();
    expect(screen.getByText("3:14")).toBeInTheDocument();
    expect(screen.getByText("4:27")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "在 B站打开 02.夏恋 - Otokaze" })).toHaveAttribute(
      "href",
      `https://www.bilibili.com/video/${BVID}?p=2`,
    );

    const audio = document.querySelector("audio.bili-audio-el");
    expect(audio).not.toBeNull();
    expect(audio.getAttribute("src")).toBe(
      `/api/widgets/bilibili_audio?bvid=${BVID}&cid=41105096717`,
    );
    expect(audio).toHaveAttribute("controls");
    expect(audio).toHaveAttribute("autoplay");
    expect(document.querySelector("iframe")).toBeNull(); // 不显示画面
    expect(screen.getByText(/仅音频播放/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "播放 01.晚星 - 逆时针向" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(document.querySelector(".bili-list-item-playing")).not.toBeNull();
  });

  it("点选集里任意一首即可切歌：cid 跟着分P变，标题与高亮同步", () => {
    render(<BilibiliMusic options={{ index: 4 }} />);
    searchFor("纯音乐");
    openCollection();

    fireEvent.click(screen.getByRole("button", { name: "播放 02.夏恋 - Otokaze" }));

    expect(document.querySelector("audio").getAttribute("src")).toContain("cid=41105097363");
    expect(screen.getAllByText(/02.夏恋 - Otokaze/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "播放 02.夏恋 - Otokaze" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getAllByRole("button", { name: /^播放 / })).toHaveLength(3);
  });

  it("上一个/下一个/播完自动切下一首都在同一视频的分P之间移动", () => {
    render(<BilibiliMusic options={{ index: 4 }} />);
    searchFor("纯音乐");
    openCollection();

    fireEvent.click(screen.getByRole("button", { name: "下一个" }));
    expect(document.querySelector("audio").getAttribute("src")).toContain("cid=41105097363");

    fireEvent.click(screen.getByRole("button", { name: "上一个" }));
    expect(document.querySelector("audio").getAttribute("src")).toContain("cid=41105096717");

    fireEvent.click(screen.getByRole("button", { name: "上一个" }));
    expect(document.querySelector("audio").getAttribute("src")).toContain("cid=41105098152");

    fireEvent.ended(document.querySelector("audio"));
    expect(document.querySelector("audio").getAttribute("src")).toContain("cid=41105096717");
  });

  it("音量调整一次即锁定：切换分P后不会回弹到 100%", () => {
    render(<BilibiliMusic options={{ index: 4 }} />);
    searchFor("纯音乐");
    openCollection();

    const audio = document.querySelector("audio");
    audio.volume = 0.35;
    fireEvent(audio, new Event("volumechange"));
    expect(window.localStorage.getItem("homepage.bilibiliVolume")).toBe("0.35");

    fireEvent.click(screen.getByRole("button", { name: "下一个" }));
    const next = document.querySelector("audio");
    expect(next.volume).toBeCloseTo(0.35);

    next.volume = 1;
    fireEvent(next, new Event("play"));
    expect(next.volume).toBeCloseTo(0.35);
  });

  it("停止后选集歌单仍常驻，再点任意分P可恢复播放", () => {
    render(<BilibiliMusic options={{ index: 4 }} />);
    searchFor("纯音乐");
    openCollection();

    fireEvent.click(screen.getByRole("button", { name: "停止播放" }));
    expect(document.querySelector("audio")).toBeNull();
    expect(screen.getAllByRole("button", { name: /^播放 / })).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "播放 03.秋日私语 - Richard Clayderman" }));
    expect(document.querySelector("audio").getAttribute("src")).toContain("cid=41105098152");
  });

  it("返回搜索结果后回到视频列表，并请求另一个视频时选集不会串台", () => {
    render(<BilibiliMusic options={{ index: 4 }} />);
    searchFor("纯音乐");
    openCollection();

    fireEvent.click(screen.getByRole("button", { name: "返回搜索结果" }));
    expect(document.querySelector("audio")).toBeNull();
    expect(screen.getAllByRole("button", { name: /^打开选集 / })).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "打开选集 在纯音乐里面，我们就是歌词" }));
    expect(swrMock).toHaveBeenCalledWith(
      expect.stringContaining("bvid=BV1d4411N7zD"),
      expect.any(Object),
    );
    expect(screen.getByText("该视频没有可用选集")).toBeInTheDocument(); // mock 的选集属于上一个 bvid
  });

  it("音频加载失败时给出提示，切换到其它分P后清除", () => {
    render(<BilibiliMusic options={{ index: 4 }} />);
    searchFor("纯音乐");
    openCollection();

    fireEvent.error(document.querySelector("audio"));
    expect(screen.getByText(/音频加载失败/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下一个" }));
    expect(screen.queryByText(/音频加载失败/)).toBeNull();
  });

  it("选集超过 20 首时分页，切到下一页可看到后面的分P", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      page: i + 1,
      cid: 41105096717 + i,
      part: `第${i + 1}首`,
      duration: 200,
      link: `https://www.bilibili.com/video/${BVID}?p=${i + 1}`,
    }));
    mockSWR({}, { data: { ...pagesPayload, total: 25, items: many } });
    render(<BilibiliMusic options={{ index: 4 }} />);
    searchFor("纯音乐");
    openCollection();

    expect(screen.getByText("第 1 / 2 页 · 共 25 首")).toBeInTheDocument();
    expect(screen.getByText("第20首")).toBeInTheDocument();
    expect(screen.queryByText("第21首")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getByText("第21首")).toBeInTheDocument();
    expect(screen.queryByText("第20首")).toBeNull();
  });

  it("搜索结果可翻页，页码进入请求 key", () => {
    render(<BilibiliMusic options={{ index: 4 }} />);
    searchFor("纯音乐");
    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(swrMock).toHaveBeenCalledWith(expect.stringContaining("page=2"), expect.any(Object));
  });

  it("limit 限制搜索结果每页条数", () => {
    render(<BilibiliMusic options={{ index: 4, limit: 2 }} />);
    searchFor("纯音乐");
    expect(screen.getAllByRole("button", { name: /^打开选集 / })).toHaveLength(2);
  });

  it("刷新：搜索视图走搜索 force=1，选集视图走选集 force=1", () => {
    render(<BilibiliMusic options={{ index: 4 }} />);
    searchFor("纯音乐");
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("bilibili_music?"));
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("force=1"));

    global.fetch = vi.fn(async () => ({ json: async () => pagesPayload }));
    openCollection();
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("bilibili_pages?"));
    expect(pagesMutate).toHaveBeenCalledTimes(1);
  });

  it("空结果 / 请求失败 / 搜索中分别给出提示", () => {
    mockSWR({ data: { ...payload, items: [] } });
    const first = render(<BilibiliMusic options={{ index: 4 }} />);
    searchFor("不存在的词");
    expect(screen.getByText("没有找到相关视频，换个关键词试试")).toBeInTheDocument();
    first.unmount();

    mockSWR({ error: new Error("boom"), data: undefined });
    const second = render(<BilibiliMusic options={{ index: 4 }} />);
    searchFor("纯音乐");
    expect(screen.getByText("搜索暂不可用，稍后重试")).toBeInTheDocument();
    second.unmount();

    mockSWR({ data: undefined, isValidating: true });
    render(<BilibiliMusic options={{ index: 4 }} />);
    searchFor("纯音乐");
    expect(screen.getByText("正在搜索 B站视频…")).toBeInTheDocument();
  });

  it("选集读取失败 / 加载中给对应提示", () => {
    const first = render(<BilibiliMusic options={{ index: 4 }} />);
    searchFor("纯音乐");
    openCollection();
    mockSWR({}, { data: undefined, isValidating: true });
    fireEvent.click(screen.getByRole("button", { name: "返回搜索结果" }));
    openCollection();
    expect(screen.getByText("正在读取视频选集…")).toBeInTheDocument();
    first.unmount();

    mockSWR({}, { data: { error: "选集暂不可用" } });
    render(<BilibiliMusic options={{ index: 4 }} />);
    searchFor("纯音乐");
    openCollection();
    expect(screen.getByText("选集读取失败，稍后重试")).toBeInTheDocument();
  });

  it("空关键词不触发搜索", () => {
    render(<BilibiliMusic options={{ index: 4 }} />);
    searchFor("   ");
    expect(screen.getByText("输入关键词搜索 B站视频，点开结果即可查看选集并播放")).toBeInTheDocument();
    expect(swrMock).toHaveBeenCalledWith(null, expect.any(Object));
  });

  it("formatCount / formatDuration 处理边界值", () => {
    expect(formatCount(undefined)).toBe("0");
    expect(formatCount(-1)).toBe("0");
    expect(formatCount(9999)).toBe("9999");
    expect(formatCount(10000)).toBe("1.0万");
    expect(formatCount(100000000)).toBe("1.0亿");
    expect(formatDuration(undefined)).toBe("--:--");
    expect(formatDuration(0)).toBe("--:--");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3661)).toBe("1:01:01");
  });
});
