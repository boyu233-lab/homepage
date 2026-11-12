// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "test-utils/render-with-providers";

import Error from "components/widgets/widget/error";

function renderError(envelope) {
  return renderWithProviders(<Error options={{}} envelope={envelope} />, { settings: { target: "_self" } });
}

describe("components/widgets/widget/error - S5 envelope", () => {
  it("不传 envelope 时行为与既有完全一致", () => {
    renderWithProviders(<Error options={{}} />, { settings: { target: "_self" } });
    expect(screen.getByText("widget.api_error")).toBeInTheDocument();
  });

  it.each([
    ["config_missing", "配置缺失"],
    ["upstream_error", "上游不可达"],
    ["invalid_params", "参数无效"],
    ["auth_required", "需登录"],
    ["disabled", "未启用"],
    ["unknown", "未知"],
    ["not_registered", "未知"],
  ])("kind=%s 显示中文原因 %s", (kind, expected) => {
    renderError({ state: "error", error: { kind, message: "ignored" } });
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.queryByText("widget.api_error")).toBeNull();
  });

  it("显示「数据截至 X 分钟前」(按 fetchedAt 计算)", () => {
    const fetchedAt = new Date(Date.now() - 5 * 60000).toISOString();
    renderError({ fetchedAt, state: "stale", error: null });
    expect(screen.getByText(/数据截至 \d+ 分钟前/)).toBeInTheDocument();
  });

  it("优先用 ageMs 计算新鲜度", () => {
    renderError({ ageMs: 12 * 60000, error: { kind: "upstream_error" } });
    expect(screen.getByText("数据截至 12 分钟前")).toBeInTheDocument();
  });

  it("无 fetchedAt/ageMs 时不虚构新鲜度文案", () => {
    renderError({ error: { kind: "config_missing" } });
    expect(screen.getByText("配置缺失")).toBeInTheDocument();
    expect(screen.queryByText(/数据截至/)).toBeNull();
  });

  it("state=error 无快照(fetchedAt=null / ageMs=0)时不虚构数据截至文案", () => {
    renderError({ fetchedAt: null, ageMs: 0, state: "error", error: { kind: "upstream_error" } });
    expect(screen.getByText("上游不可达")).toBeInTheDocument();
    expect(screen.queryByText(/数据截至/)).toBeNull();
  });

  it("stale 有快照时按 fetchedAt 显示数据截至", () => {
    const fetchedAt = new Date(Date.now() - 7 * 60000).toISOString();
    renderError({ fetchedAt, ageMs: 0, state: "stale", stale: true, error: null });
    expect(screen.getByText("数据截至 7 分钟前")).toBeInTheDocument();
  });
});
