// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state, useSWR, openSpy } = vi.hoisted(() => {
  const state = { bookmarks: [], services: [] };
  const useSWR = vi.fn((key) => {
    if (key === "/api/bookmarks") return { data: state.bookmarks };
    if (key === "/api/services") return { data: state.services };
    return { data: undefined };
  });
  return { state, useSWR, openSpy: vi.fn() };
});

vi.mock("swr", () => ({ default: useSWR }));

import CommandPalette from "components/commandpalette/commandpalette";

const STORAGE_KEY = "homepage.commandpalette.frequency";
const FREQUENT_KEY = "service:媒体:Jellyfin:https://example.com/jellyfin";

function sampleData() {
  return {
    bookmarks: [
      {
        name: "开发",
        bookmarks: [
          { name: "Pro Git Book", href: "https://example.com/book", abbr: "PGB" },
          { name: "GitHub", href: "https://example.com/github", abbr: "GH" },
        ],
      },
      {
        name: "Git 服务",
        bookmarks: [{ name: "Runner", href: "https://example.com/runner", abbr: "RN" }],
      },
    ],
    services: [
      {
        name: "媒体",
        services: [
          { name: "Jellyfin", href: "https://example.com/jellyfin", abbr: "JF" },
          { name: "Portal", href: "https://example.com/git-mirror", abbr: "git" },
        ],
        groups: [
          { name: "子分组", services: [{ name: "Nested Service", href: "https://example.com/nested" }] },
        ],
      },
    ],
  };
}

function resultRows() {
  return within(screen.getByRole("list"))
    .getAllByRole("listitem")
    .map((li) => li.textContent);
}

describe("components/commandpalette/commandpalette", () => {
  beforeEach(() => {
    window.localStorage.clear();
    const data = sampleData();
    state.bookmarks = data.bookmarks;
    state.services = data.services;
    useSWR.mockClear();
    openSpy.mockClear();
    vi.stubGlobal("open", openSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("未打开时不渲染任何可见 UI", () => {
    render(<CommandPalette />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Ctrl+K 打开命令面板", () => {
    render(<CommandPalette />);
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Meta+K 打开命令面板", () => {
    render(<CommandPalette />);
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("/ 在非输入焦点时打开，输入框聚焦时不打开", () => {
    render(
      <>
        <input data-testid="other" />
        <CommandPalette />
      </>,
    );
    fireEvent.keyDown(document, { key: "/" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });

    const input = screen.getByTestId("other");
    input.focus();
    fireEvent.keyDown(input, { key: "/" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("复用 /api/bookmarks 与 /api/services，不新增 API", () => {
    render(<CommandPalette />);
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    const keys = useSWR.mock.calls.map(([key]) => key);
    expect(keys).toContain("/api/bookmarks");
    expect(keys).toContain("/api/services");
    expect(new Set(keys)).toEqual(new Set(["/api/bookmarks", "/api/services"]));
  });

  it("本地加权顺序为 名称前缀 > 名称包含 > 缩写 > 分组名", () => {
    render(<CommandPalette />);
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "git" } });

    const rows = resultRows();
    expect(rows[0]).toContain("GitHub");
    expect(rows[1]).toContain("Pro Git Book");
    expect(rows[2]).toContain("Portal");
    expect(rows[3]).toContain("Runner");
  });

  it("嵌套服务分组也被检索", () => {
    render(<CommandPalette />);
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "nested" } });
    expect(resultRows()[0]).toContain("Nested Service");
  });

  it("↑/↓ 选择 + Enter 打开链接，并把频次写入 localStorage", () => {
    render(<CommandPalette />);
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "git" } });
    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "Enter" });

    expect(openSpy).toHaveBeenCalledWith("https://example.com/book", "_blank", "noreferrer");
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    expect(Object.values(stored)).toContain(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("最近使用频次参与空查询排序", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ [FREQUENT_KEY]: 9 }));
    render(<CommandPalette />);
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(resultRows()[0]).toContain("Jellyfin");
  });

  it("无匹配时显示明确空态", () => {
    render(<CommandPalette />);
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "zzzz-not-exist" } });
    expect(screen.getByText("未找到匹配项")).toBeInTheDocument();
  });

  it("Esc 关闭命令面板", () => {
    render(<CommandPalette />);
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
