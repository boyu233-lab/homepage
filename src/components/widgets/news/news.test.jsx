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

const items = [
  {
    title: "永远做党和人民的忠诚卫士",
    link: "https://www.baidu.com/s?wd=top",
    rank: 0,
    isTop: true,
    hotScore: "7904533",
    hotTag: "",
    desc: "置顶摘要",
  },
  {
    title: "为什么小电驴也卖不动了",
    link: "https://www.baidu.com/s?wd=one",
    rank: 1,
    isTop: false,
    hotScore: "7808644",
    hotTag: "新",
    desc: "摘要一",
  },
  {
    title: "哈工大研究生卖气球月入3千",
    link: "https://www.baidu.com/s?wd=two",
    rank: 2,
    isTop: false,
    hotScore: "7139811",
    hotTag: "热",
    desc: "摘要二",
  },
  {
    title: "你家盐早该换了",
    link: "https://www.baidu.com/s?wd=four",
    rank: 4,
    isTop: false,
    hotScore: "5000",
    hotTag: "",
    desc: "",
  },
];

const payload = {
  items,
  feedNames: ["百度热搜"],
  sources: 1,
  updatedAt: "2026-11-09T09:08:54.000Z",
  boardName: "热搜榜",
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

function links() {
  return screen.getAllByRole("link");
}

describe("components/widgets/news — 百度热搜榜", () => {
  beforeEach(() => {
    localStorage.clear();
    swrMock.mockReset();
    mutate.mockReset();
    mockSWR();
  });

  it("常驻铺开榜单：置顶箭头、排名、标题、热度、新/热角标", () => {
    render(<News options={{ index: 3 }} />);

    expect(links()).toHaveLength(4);
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getByText("↑")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("为什么小电驴也卖不动了")).toBeInTheDocument();
    expect(screen.getByText("780.9万")).toBeInTheDocument();
    expect(screen.getByText("5000")).toBeInTheDocument();
    expect(screen.getByText("新")).toBeInTheDocument();
    expect(screen.getByText("热")).toBeInTheDocument();
    expect(screen.queryByTitle("展开新闻列表")).toBeNull();
  });

  it("纯榜单不再显示来源筛选标签，也不读写 localStorage 选择", () => {
    localStorage.setItem("homepage.newsSource", "百度新闻");
    render(<News options={{ index: 3 }} />);
    expect(screen.queryByRole("group", { name: "选择新闻来源" })).toBeNull();
    expect(links()).toHaveLength(4);
  });

  it("链接跳百度搜索，悬停提示用摘要，工具栏显示更新时间", () => {
    render(<News options={{ index: 3 }} />);
    expect(links()[1]).toHaveAttribute("href", "https://www.baidu.com/s?wd=one");
    expect(links()[1]).toHaveAttribute("target", "_blank");
    expect(screen.getByTitle("摘要一")).toBeInTheDocument();
    expect(screen.getByText(/更新于/)).toBeInTheDocument();
  });

  it("前三名徽标按红/橙/黄着色", () => {
    render(<News options={{ index: 3 }} />);
    const badges = screen.getAllByText(/^(\d+|↑)$/);
    expect(badges[1]).toHaveStyle({ color: "#f87171" });
    expect(badges[2]).toHaveStyle({ color: "#fb923c" });
  });

  it("limit 限制铺开的条数", () => {
    render(<News options={{ index: 3, limit: 2 }} />);
    expect(links()).toHaveLength(2);
  });

  it("手动刷新触发 SWR mutate", () => {
    render(<News options={{ index: 3 }} />);
    fireEvent.click(screen.getByRole("button", { name: "刷新热搜" }));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("没有数据时显示热搜提示而不是空白", () => {
    mockSWR({ data: { ...payload, items: [] } });
    render(<News options={{ index: 3 }} />);
    expect(screen.getByText("暂无热搜，稍后会自动重试")).toBeInTheDocument();
  });

  it("请求失败时显示错误提示", () => {
    mockSWR({ error: new Error("boom"), data: undefined });
    render(<News options={{ index: 3 }} />);
    expect(screen.getByText("热搜暂不可用，稍后会自动重试")).toBeInTheDocument();
  });
});
