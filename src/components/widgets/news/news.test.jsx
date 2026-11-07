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
  { title: "百度新闻一", link: "https://example.com/1", date: "2026-11-07T10:00:00Z", source: "百度新闻" },
  { title: "IT之家新闻一", link: "https://example.com/2", date: "2026-11-07T09:00:00Z", source: "IT之家" },
  { title: "百度新闻二", link: "https://example.com/3", date: "2026-11-07T08:00:00Z", source: "百度新闻" },
  { title: "IT之家新闻二", link: "https://example.com/4", date: "2026-11-07T07:00:00Z", source: "IT之家" },
];

const payload = { items, feedNames: ["百度新闻", "IT之家"], sources: 2, updatedAt: "2026-11-07T10:00:00Z" };

function mockSWR(data = payload) {
  swrMock.mockReturnValue({ data, error: undefined, isValidating: false, mutate: vi.fn() });
}

function links() {
  return screen.getAllByRole("link");
}

describe("components/widgets/news", () => {
  beforeEach(() => {
    localStorage.clear();
    swrMock.mockReset();
    mockSWR();
  });

  it("直接铺开新闻列表，没有展开下拉的按钮", () => {
    render(<News options={{ index: 3 }} />);

    expect(links()).toHaveLength(4);
    expect(screen.getByText("百度新闻一")).toBeInTheDocument();
    expect(screen.getByText("IT之家新闻二")).toBeInTheDocument();
    expect(screen.queryByTitle("展开新闻列表")).toBeNull();
    expect(screen.queryByRole("list")).toBeInTheDocument();
  });

  it("顶部提供来源筛选，点选后只显示该来源并记住选择", () => {
    const { unmount } = render(<News options={{ index: 3 }} />);

    fireEvent.click(screen.getByRole("button", { name: "IT之家" }));
    expect(links()).toHaveLength(2);
    expect(screen.queryByText("百度新闻一")).toBeNull();
    expect(localStorage.getItem("homepage.newsSource")).toBe("IT之家");

    unmount();
    render(<News options={{ index: 3 }} />);
    expect(links()).toHaveLength(2);
    expect(screen.getByRole("button", { name: "IT之家" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("选中的来源被移除后自动回退到全部", () => {
    localStorage.setItem("homepage.newsSource", "已下线的源");
    render(<News options={{ index: 3 }} />);
    expect(links()).toHaveLength(4);
  });

  it("showSourceFilter 为 false 时不显示来源标签", () => {
    render(<News options={{ index: 3, showSourceFilter: false }} />);
    expect(screen.queryByRole("group", { name: "选择新闻来源" })).toBeNull();
    expect(links()).toHaveLength(4);
  });

  it("limit 限制首页铺开的条数", () => {
    render(<News options={{ index: 3, limit: 2 }} />);
    expect(links()).toHaveLength(2);
  });

  it("没有数据时显示提示而不是空白", () => {
    mockSWR({ items: [], feedNames: ["百度新闻"], sources: 1 });
    render(<News options={{ index: 3 }} />);
    expect(screen.getByText("暂无新闻，稍后会自动重试")).toBeInTheDocument();
  });
});
