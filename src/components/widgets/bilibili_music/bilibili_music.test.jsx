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

const items = [
  {
    rank: 1,
    bvid: "BV1BZbSzZEGT",
    title: "【无损音质】《晴天》",
    author: "VV音乐局",
    duration: 270,
    view: 3460783,
    link: "https://www.bilibili.com/video/BV1BZbSzZEGT",
  },
  {
    rank: 2,
    bvid: "BV1d4411N7zD",
    title: "【4K修复】晴天 MV",
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
  query: "周杰伦 晴天",
  page: 1,
  total: 1000,
  items,
  updatedAt: "2026-11-09T12:08:54.000Z",
};

const mutate = vi.fn();

function mockSWR(overrides = {}) {
  swrMock.mockReturnValue({
    data: payload,
    error: undefined,
    isValidating: false,
    mutate,
    ...overrides,
  });
}

function searchFor(text) {
  fireEvent.change(screen.getByRole("searchbox", { name: "搜索关键词" }), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "搜索 B站视频" }));
}

describe("components/widgets/bilibili_music — B站搜索与手动选播", () => {
  beforeEach(() => {
    window.localStorage.clear();
    swrMock.mockReset();
    mutate.mockReset();
    global.fetch = vi.fn(async () => ({ json: async () => payload }));
    mockSWR();
  });

  it("初始为搜索起始态：不请求上游，显示输入框与提示", () => {
    render(<BilibiliMusic options={{ index: 4 }} />);
    expect(swrMock).toHaveBeenCalledWith(null, expect.any(Object));
    expect(screen.getByRole("searchbox", { name: "搜索关键词" })).toBeInTheDocument();
    expect(screen.getByText("输入关键词搜索 B站视频，点击结果即可在此播放")).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /^播放 / })).toHaveLength(0);
  });

  it("提交关键词后按 q/page/refreshInterval 请求搜索并列出结果", () => {
    render(<BilibiliMusic options={{ index: 4 }} />);
    searchFor("周杰伦 晴天");

    expect(swrMock).toHaveBeenLastCalledWith(
      expect.stringContaining("q=%E5%91%A8%E6%9D%B0%E4%BC%A6+%E6%99%B4%E5%A4%A9"),
      expect.any(Object),
    );
    expect(screen.getAllByRole("button", { name: /^播放 / })).toHaveLength(3);
    expect(screen.getByText("【无损音质】《晴天》")).toBeInTheDocument();
    expect(screen.getByText("346.1万 · 4:30")).toBeInTheDocument();
    expect(screen.getByText("9800 · 1:02:05")).toBeInTheDocument();
    expect(screen.getByText("1.2亿 · 1:05")).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "在 B站打开 【4K修复】晴天 MV" })).toHaveAttribute(
      "href",
      "https://www.bilibili.com/video/BV1d4411N7zD",
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
    expect(swrMock).toHaveBeenLastCalledWith(expect.stringContaining("q=%E6%99%B4%E5%A4%A9"), expect.any(Object));
  });

  it("点击搜索结果挂载同源纯音频播放条，歌单仍常驻且当前项高亮", () => {
    render(<BilibiliMusic options={{ index: 4 }} />);
    searchFor("晴天");
    expect(document.querySelector("audio")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "播放 【无损音质】《晴天》" }));

    const audio = document.querySelector("audio.bili-audio-el");
    expect(audio).not.toBeNull();
    expect(audio.getAttribute("src")).toBe("/api/widgets/bilibili_audio?bvid=BV1BZbSzZEGT");
    expect(audio).toHaveAttribute("controls");
    expect(audio).toHaveAttribute("autoplay");
    expect(document.querySelector("iframe")).toBeNull(); // 关键：不显示画面
    expect(screen.getByText(/仅音频播放/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^播放 / })).toHaveLength(3); // 播放时歌单不消失
    expect(screen.getByRole("button", { name: "播放 【无损音质】《晴天》" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(document.querySelector(".bili-list-item-playing")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "停止播放" }));
    expect(document.querySelector("audio")).toBeNull();
    expect(screen.getAllByRole("button", { name: /^播放 / })).toHaveLength(3);
  });

  it("播放时可直接点歌单里的其它条目切歌", () => {
    render(<BilibiliMusic options={{ index: 4 }} />);
    searchFor("晴天");
    fireEvent.click(screen.getByRole("button", { name: "播放 【无损音质】《晴天》" }));

    fireEvent.click(screen.getByRole("button", { name: "播放 第三个视频" }));

    expect(document.querySelector("audio").getAttribute("src")).toContain("bvid=BV1xx411c7mD");
    expect(screen.getAllByRole("button", { name: /^播放 / })).toHaveLength(3);
    expect(screen.getByRole("button", { name: "播放 第三个视频" })).toHaveAttribute("aria-current", "true");
  });

  it("音量调整一次即锁定：切歌与再次播放都不会回弹到 100%", () => {
    render(<BilibiliMusic options={{ index: 4 }} />);
    searchFor("晴天");
    fireEvent.click(screen.getByRole("button", { name: "播放 【无损音质】《晴天》" }));

    const audio = document.querySelector("audio");
    audio.volume = 0.35;
    fireEvent(audio, new Event("volumechange"));
    expect(window.localStorage.getItem("homepage.bilibiliVolume")).toBe("0.35");

    fireEvent.click(screen.getByRole("button", { name: "下一个" }));
    const next = document.querySelector("audio");
    expect(next.volume).toBeCloseTo(0.35);

    next.volume = 1; // 模拟新音轨默认音量
    fireEvent(next, new Event("play"));
    expect(next.volume).toBeCloseTo(0.35);
  });

  it("纯音频支持上一个/下一个循环切换与播放结束自动切下一首", () => {
    render(<BilibiliMusic options={{ index: 4 }} />);
    searchFor("晴天");
    fireEvent.click(screen.getByRole("button", { name: "播放 【无损音质】《晴天》" }));

    fireEvent.click(screen.getByRole("button", { name: "下一个" }));
    expect(document.querySelector("audio").getAttribute("src")).toContain("bvid=BV1d4411N7zD");

    fireEvent.click(screen.getByRole("button", { name: "上一个" }));
    expect(document.querySelector("audio").getAttribute("src")).toContain("bvid=BV1BZbSzZEGT");

    fireEvent.click(screen.getByRole("button", { name: "上一个" }));
    expect(document.querySelector("audio").getAttribute("src")).toContain("bvid=BV1xx411c7mD");

    fireEvent.ended(document.querySelector("audio"));
    expect(document.querySelector("audio").getAttribute("src")).toContain("bvid=BV1BZbSzZEGT");
  });

  it("音频加载失败时给出提示，切歌后清除", () => {
    render(<BilibiliMusic options={{ index: 4 }} />);
    searchFor("晴天");
    fireEvent.click(screen.getByRole("button", { name: "播放 【无损音质】《晴天》" }));

    fireEvent.error(document.querySelector("audio"));
    expect(screen.getByText(/音频加载失败/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下一个" }));
    expect(screen.queryByText(/音频加载失败/)).toBeNull();
  });

  it("结果可翻页，页码进入请求 key", () => {
    render(<BilibiliMusic options={{ index: 4 }} />);
    searchFor("晴天");
    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(swrMock).toHaveBeenLastCalledWith(expect.stringContaining("page=2"), expect.any(Object));
  });

  it("limit 限制每页展示条数", () => {
    render(<BilibiliMusic options={{ index: 4, limit: 2 }} />);
    searchFor("晴天");
    expect(screen.getAllByRole("button", { name: /^播放 / })).toHaveLength(2);
  });

  it("重新搜索走 force=1 跳过服务端缓存", () => {
    render(<BilibiliMusic options={{ index: 4 }} />);
    searchFor("晴天");
    fireEvent.click(screen.getByRole("button", { name: "重新搜索" }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("force=1"));
  });

  it("空结果 / 请求失败 / 搜索中分别给出提示", () => {
    mockSWR({ data: { ...payload, items: [] } });
    const first = render(<BilibiliMusic options={{ index: 4 }} />);
    searchFor("不存在的词");
    expect(screen.getByText("没有找到相关视频，换个关键词试试")).toBeInTheDocument();
    first.unmount();

    mockSWR({ error: new Error("boom"), data: undefined });
    const second = render(<BilibiliMusic options={{ index: 4 }} />);
    searchFor("晴天");
    expect(screen.getByText("搜索暂不可用，稍后重试")).toBeInTheDocument();
    second.unmount();

    mockSWR({ data: undefined, isValidating: true });
    render(<BilibiliMusic options={{ index: 4 }} />);
    searchFor("晴天");
    expect(screen.getByText("正在搜索 B站视频…")).toBeInTheDocument();
  });

  it("空关键词不触发搜索", () => {
    render(<BilibiliMusic options={{ index: 4 }} />);
    searchFor("   ");
    expect(screen.getByText("输入关键词搜索 B站视频，点击结果即可在此播放")).toBeInTheDocument();
    expect(swrMock).toHaveBeenLastCalledWith(null, expect.any(Object));
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
