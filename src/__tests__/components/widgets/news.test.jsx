// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "test-utils/render-with-providers";

const { state, useSWR } = vi.hoisted(() => {
  const state = { data: undefined, error: undefined, isValidating: false };
  const useSWR = vi.fn(() => ({ ...state, mutate: vi.fn() }));
  return { state, useSWR };
});

vi.mock("swr", () => ({ default: useSWR }));

import News from "components/widgets/news/news";

function renderNews() {
  return renderWithProviders(<News options={{}} />, { settings: { target: "_self" } });
}

function payload(envelope) {
  return {
    items: [{ link: "https://example.com/1", title: "新闻一", rank: 1 }],
    updatedAt: new Date().toISOString(),
    availableSources: [{ key: "baidu", label: "百度热搜", kind: "board" }],
    ...(envelope ? { _envelope: envelope } : {}),
  };
}

describe("components/widgets/news - S5 陈旧角标", () => {
  beforeEach(() => {
    window.localStorage.clear();
    state.data = undefined;
    state.error = undefined;
    state.isValidating = false;
  });

  it("state=stale 时显示带 fetchedAt 相对时间的陈旧角标", () => {
    const fetchedAt = new Date(Date.now() - 3 * 60000).toISOString();
    state.data = payload({ fetchedAt, state: "stale", stale: true });
    renderNews();

    expect(screen.getByText(/陈旧/)).toBeInTheDocument();
    expect(screen.getByText(/分钟前/)).toBeInTheDocument();
  });

  it("stale=true 也能触发角标", () => {
    const fetchedAt = new Date(Date.now() - 2 * 3600000).toISOString();
    state.data = payload({ fetchedAt, state: "fresh", stale: true });
    renderNews();

    expect(screen.getByText(/陈旧/)).toBeInTheDocument();
    expect(screen.getByText(/小时前/)).toBeInTheDocument();
  });

  it("fresh 态不显示陈旧角标", () => {
    state.data = payload({ fetchedAt: new Date().toISOString(), state: "fresh", stale: false });
    renderNews();
    expect(screen.queryByText(/陈旧/)).toBeNull();
  });

  it("无 _envelope 时不显示陈旧角标，且 updatedAt 显示逻辑保持不变", () => {
    state.data = payload(null);
    renderNews();
    expect(screen.queryByText(/陈旧/)).toBeNull();
    expect(screen.getByText(/更新于/)).toBeInTheDocument();
  });

  it("stale 态下 updatedAt 仍然照常显示", () => {
    state.data = payload({ fetchedAt: new Date().toISOString(), state: "stale" });
    renderNews();
    expect(screen.getByText(/陈旧/)).toBeInTheDocument();
    expect(screen.getByText(/更新于/)).toBeInTheDocument();
  });
});
