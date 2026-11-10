// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useSWR, globalMutate } = vi.hoisted(() => ({
  useSWR: vi.fn(),
  globalMutate: vi.fn(),
}));

vi.mock("swr", () => ({ default: useSWR, mutate: globalMutate }));

import ConfigUpdater from "components/manage/config-updater";

const DATA = {
  files: [
    {
      name: "custom.css",
      label: "自定义样式",
      desc: "首页布局与配色覆盖",
      exists: true,
      bytes: 12,
      modified: "2026-11-10T12:00:00.000Z",
      sha256: "abc",
    },
    {
      name: "widgets.yaml",
      label: "信息部件",
      desc: "部件配置",
      exists: false,
      bytes: 0,
      modified: null,
      sha256: null,
    },
  ],
  backups: {},
  maxBytes: 524288,
  backupKeep: 10,
};

function jsonResponse(body, ok = true) {
  return { ok, status: ok ? 200 : 400, json: async () => body };
}

describe("components/manage/config-updater", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSWR.mockReturnValue({ data: DATA, error: null, mutate: vi.fn().mockResolvedValue(undefined) });
  });

  it("渲染说明、上传区与配置文件表格", () => {
    render(<ConfigUpdater />);
    expect(screen.getByText(/上传配置文件/)).toBeInTheDocument();
    expect(screen.getByText("选择文件（可多选）")).toBeInTheDocument();
    expect(screen.getByText("custom.css")).toBeInTheDocument();
    expect(screen.getByText("widgets.yaml")).toBeInTheDocument();
    expect(screen.getByText(/暂无备份/)).toBeInTheDocument();
  });

  it("选中文件后先校验再上传，并展示结果", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
      const payload = JSON.parse(options.body);
      if (payload.action === "validate") return jsonResponse({ valid: true });
      return jsonResponse({ ok: true, backup: "custom.css.20261110-220000.bak" });
    });

    const { container } = render(<ConfigUpdater />);
    const input = container.querySelector('input[type="file"]');
    Object.defineProperty(input, "files", {
      value: [{ name: "custom.css", size: 5, text: async () => "new{}" }],
      configurable: true,
    });
    fireEvent.change(input);

    await waitFor(() => expect(screen.getByText("上传并应用")).toBeInTheDocument());
    expect(screen.getByText("✓")).toBeInTheDocument();

    fireEvent.click(screen.getByText("上传并应用"));
    await waitFor(() => expect(screen.getByText(/1 个配置已写入并生效/)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/config/upload",
      expect.objectContaining({ method: "POST" }),
    );
    fetchMock.mockRestore();
  });

  it("校验失败的文件不允许上传", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: "YAML 解析失败" }, false),
    );

    const { container } = render(<ConfigUpdater />);
    const input = container.querySelector('input[type="file"]');
    Object.defineProperty(input, "files", {
      value: [{ name: "widgets.yaml", size: 8, text: async () => "- a: [" }],
      configurable: true,
    });
    fireEvent.change(input);

    await waitFor(() => expect(screen.getByText(/YAML 解析失败/)).toBeInTheDocument());
    expect(screen.getByText("上传并应用")).toBeDisabled();
    fetchMock.mockRestore();
  });
});
