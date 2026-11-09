// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { swrMock } = vi.hoisted(() => ({ swrMock: vi.fn() }));

vi.mock("swr", () => ({ default: swrMock }));
vi.mock("../widget/container", () => ({
  default: ({ children }) => <div data-testid="news-container">{children}</div>,
}));
vi.mock("../widget/raw", () => ({ default: ({ children }) => <>{children}</> }));

import News from "./news";

const SOURCES = [
  { key: "baidu", label: "百度热搜", kind: "board" },
  { key: "weibo", label: "微博热搜", kind: "board" },
  { key: "zhihu", label: "知乎热榜", kind: "board" },
  { key: "toutiao", label: "头条热榜", kind: "board" },
  { key: "douyin", label: "抖音热榜", kind: "board" },
  { key: "bilibili", label: "B站热搜", kind: "board" },
  { key: "bing", label: "Bing 资讯", kind: "news" },
  { key: "ithome", label: "IT之家", kind: "news" },
  { key: "sspai", label: "少数派", kind: "news" },
];

const items = [
  {
    title: "置顶热搜",
    link: "https://www.baidu.com/s?wd=top",
    rank: 0,
    isTop: true,
    hotScore: "7904533",
    hotTag: "",
    desc: "置顶摘要",
    date: "2026-11-09T12:00:00.000Z",
  },
  {
    title: "为什么小电驴也卖不动了",
    link: "https://www.baidu.com/s?wd=one",
    rank: 1,
    isTop: false,
    hotScore: "7808644",
    hotTag: "新",
    desc: "摘要一",
    date: "2026-11-09T12:00:00.000Z",
  },
  {
    title: "哈工大研究生卖气球月入3千",
    link: "https://www.baidu.com/s?wd=two",
    rank: 2,
    isTop: false,
    hotScore: "7139811",
    hotTag: "热",
    desc: "摘要二",
    date: "2026-11-09T12:00:00.000Z",
  },
  {
    title: "你家盐早该换了",
    link: "https://www.baidu.com/s?wd=four",
    rank: 4,
    isTop: false,
    hotScore: "7040000",
    hotTag: "",
    desc: "摘要四",
    date: "2026-11-09T12:00:00.000Z",
  },
];

const payload = {
  items,
  availableSources: SOURCES,
  source: "baidu",
  sourceLabel: "百度热搜",
  kind: "board",
  boardName: "热搜榜",
  feedNames: ["百度热搜"],
  updatedAt: "2026-11-09T12:00:00.000Z",
  total: 50,
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

function lastKey() {
  return swrMock.mock.calls.at(-1)[0];
}

describe("components/widgets/news — 多源热榜标签切换", () => {
  beforeEach(() => {
    window.localStorage.clear();
    swrMock.mockReset();
    mutate.mockReset();
    mockSWR();
  });

  it("工具栏单行铺开 9 个来源标签，默认选中百度热搜", () => {
    render(<News options={{ index: 3 }} />);
    expect(screen.getAllByRole("tab")).toHaveLength(9);
    expect(screen.getByRole("tab", { name: "百度热搜" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Bing 资讯" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "IT之家" })).toBeInTheDocument();
    expect(lastKey()).toContain("source=baidu");
  });

  it("榜单列表：置顶箭头、前三名颜色、热度与角标", () => {
    render(<News options={{ index: 3 }} />);
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getByText("置顶热搜")).toBeInTheDocument();
    expect(screen.getByText("↑")).toBeInTheDocument();
    expect(screen.getByText("790.5万")).toBeInTheDocument();
    expect(screen.getByText("新")).toBeInTheDocument();
    expect(screen.getByText("热")).toBeInTheDocument();
    expect(screen.getByText(/更新于/)).toBeInTheDocument();
  });

  it("点击标签切换来源：请求带新 source，并记住选择", () => {
    render(<News options={{ index: 3 }} />);
    fireEvent.click(screen.getByRole("tab", { name: "微博热搜" }));
    expect(screen.getByRole("tab", { name: "微博热搜" })).toHaveAttribute("aria-selected", "true");
    expect(lastKey()).toContain("source=weibo");
    expect(window.localStorage.getItem("homepage.newsSource")).toBe("weibo");
  });

  it("重新打开页面时恢复上次选择的来源", () => {
    window.localStorage.setItem("homepage.newsSource", "zhihu");
    render(<News options={{ index: 3 }} />);
    expect(screen.getByRole("tab", { name: "知乎热榜" })).toHaveAttribute("aria-selected", "true");
    expect(lastKey()).toContain("source=zhihu");
  });

  it("localStorage 里是垃圾值时安全回退百度", () => {
    window.localStorage.setItem("homepage.newsSource", "https://evil.example/x");
    render(<News options={{ index: 3 }} />);
    expect(screen.getByRole("tab", { name: "百度热搜" })).toHaveAttribute("aria-selected", "true");
  });

  it("资讯类来源右侧显示发布时间而不是热度", () => {
    mockSWR({
      data: {
        ...payload,
        source: "ithome",
        sourceLabel: "IT之家",
        kind: "news",
        items: [{ ...items[1], hotScore: "", title: "IT之家新闻一" }],
      },
    });
    render(<News options={{ index: 3 }} />);
    fireEvent.click(screen.getByRole("tab", { name: "IT之家" }));
    expect(screen.getByText("IT之家新闻一")).toBeInTheDocument();
    expect(screen.queryByText("780.9万")).not.toBeInTheDocument();
    expect(screen.getByText(/11\/09/)).toBeInTheDocument();
  });

  it("limit 限制铺开的条数", () => {
    render(<News options={{ index: 3, limit: 2 }} />);
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("手动刷新触发 mutate，按钮标题跟随当前来源", () => {
    render(<News options={{ index: 3 }} />);
    fireEvent.click(screen.getByRole("button", { name: "刷新百度热搜" }));
    expect(mutate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("tab", { name: "头条热榜" }));
    expect(screen.getByRole("button", { name: "刷新头条热榜" })).toBeInTheDocument();
  });

  it("没有数据或请求失败时显示按来源命名的提示", () => {
    const first = render(<News options={{ index: 3 }} />);
    first.unmount();

    mockSWR({ data: { ...payload, items: [] } });
    const second = render(<News options={{ index: 3 }} />);
    expect(screen.getByText("百度热搜暂无内容，稍后会自动重试")).toBeInTheDocument();
    second.unmount();

    mockSWR({ error: new Error("boom"), data: { ...payload, items: [] } });
    render(<News options={{ index: 3 }} />);
    expect(screen.getByText("百度热搜暂不可用，稍后会自动重试")).toBeInTheDocument();
  });

  it("API 尚未返回时用内置来源列表也能渲染标签", () => {
    mockSWR({ data: undefined, isValidating: true });
    render(<News options={{ index: 3 }} />);
    expect(screen.getAllByRole("tab")).toHaveLength(9);
    expect(screen.getByText("正在获取百度热搜…")).toBeInTheDocument();
  });
});
