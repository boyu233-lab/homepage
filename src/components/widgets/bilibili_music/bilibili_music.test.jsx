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
    bvid: "BV17VZpY1ENA",
    title: "给我们的组合起个名！",
    author: "田一名sir",
    category: "翻唱",
    duration: 15,
    view: 17882158,
    link: "https://www.bilibili.com/video/BV17VZpY1ENA",
  },
  {
    rank: 2,
    bvid: "BV1GJ411x7h7",
    title: "第二首歌",
    author: "某UP主",
    duration: 215,
    view: 9800,
    link: "https://www.bilibili.com/video/BV1GJ411x7h7",
  },
  {
    rank: 3,
    bvid: "BV1xx411c7mD",
    title: "第三首歌",
    author: "另一UP主",
    duration: 3725,
    view: 123456789,
    link: "https://www.bilibili.com/video/BV1xx411c7mD",
  },
];

const payload = {
  items,
  feedNames: ["B站音乐榜"],
  sources: 1,
  updatedAt: "2026-11-09T11:08:54.000Z",
  boardName: "音乐榜",
  total: 97,
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

describe("components/widgets/bilibili_music — B站音乐榜", () => {
  beforeEach(() => {
    swrMock.mockReset();
    mutate.mockReset();
    mockSWR();
  });

  it("常驻铺开榜单：排名、标题、播放量、时长、B站外链、更新时间", () => {
    render(<BilibiliMusic options={{ index: 4 }} />);

    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^播放 / })).toHaveLength(3);
    expect(screen.getByText("给我们的组合起个名！")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("1788.2万 · 0:15")).toBeInTheDocument();
    expect(screen.getByText("9800 · 3:35")).toBeInTheDocument();
    expect(screen.getByText("1.2亿 · 1:02:05")).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "在 B站打开 第二首歌" })).toHaveAttribute(
      "href",
      "https://www.bilibili.com/video/BV1GJ411x7h7",
    );
    expect(screen.getByText(/更新于/)).toBeInTheDocument();
  });

  it("前三名徽标按红/橙/黄着色", () => {
    render(<BilibiliMusic options={{ index: 4 }} />);
    const badges = screen.getAllByText(/^[1-3]$/);
    expect(badges[0]).toHaveStyle({ color: "#f87171" });
    expect(badges[1]).toHaveStyle({ color: "#fb923c" });
    expect(badges[2]).toHaveStyle({ color: "#fbbf24" });
  });

  it("点击条目在当前页挂载 B站官方播放器，可返回榜单", () => {
    render(<BilibiliMusic options={{ index: 4 }} />);
    expect(document.querySelector("iframe")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "播放 给我们的组合起个名！" }));

    const frame = screen.getByTitle("B站播放器：给我们的组合起个名！");
    expect(frame).toHaveAttribute("allow", "autoplay; fullscreen; picture-in-picture");
    expect(frame.getAttribute("src")).toContain("https://player.bilibili.com/player.html?");
    expect(frame.getAttribute("src")).toContain("bvid=BV17VZpY1ENA");
    expect(frame.getAttribute("src")).toContain("autoplay=1");
    expect(frame.getAttribute("src")).toContain("danmaku=0");
    expect(screen.queryByRole("list")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "返回音乐榜" }));
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("list")).toBeInTheDocument();
  });

  it("播放器内可上一首/下一首循环切换", () => {
    render(<BilibiliMusic options={{ index: 4 }} />);
    fireEvent.click(screen.getByRole("button", { name: "播放 给我们的组合起个名！" }));

    fireEvent.click(screen.getByRole("button", { name: "下一首" }));
    expect(screen.getByTitle("B站播放器：第二首歌").getAttribute("src")).toContain(
      "bvid=BV1GJ411x7h7",
    );

    fireEvent.click(screen.getByRole("button", { name: "上一首" }));
    expect(screen.getByTitle("B站播放器：给我们的组合起个名！")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "上一首" }));
    expect(screen.getByTitle("B站播放器：第三首歌")).toBeInTheDocument();
  });

  it("limit 限制铺开的条数", () => {
    render(<BilibiliMusic options={{ index: 4, limit: 2 }} />);
    expect(screen.getAllByRole("button", { name: /^播放 / })).toHaveLength(2);
  });

  it("手动刷新触发 SWR mutate", () => {
    render(<BilibiliMusic options={{ index: 4 }} />);
    fireEvent.click(screen.getByRole("button", { name: "刷新音乐榜" }));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("没有数据或请求失败时显示提示而不是空白", () => {
    mockSWR({ data: { ...payload, items: [] } });
    const first = render(<BilibiliMusic options={{ index: 4 }} />);
    expect(screen.getByText("暂无音乐榜，稍后会自动重试")).toBeInTheDocument();
    first.unmount();

    mockSWR({ error: new Error("boom"), data: undefined });
    render(<BilibiliMusic options={{ index: 4 }} />);
    expect(screen.getByText("音乐榜暂不可用，稍后会自动重试")).toBeInTheDocument();
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
