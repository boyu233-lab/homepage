import { beforeEach, describe, expect, it, vi } from "vitest";

import createMockRes from "test-utils/create-mock-res";

const { fs, config, logger } = vi.hoisted(() => ({
  fs: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  },
  config: {
    CONF_DIR: "/conf",
  },
  logger: {
    error: vi.fn(),
  },
}));

vi.mock("fs", () => ({
  default: fs,
  ...fs,
}));

vi.mock("utils/config/config", () => config);

vi.mock("utils/logger", () => ({
  default: () => logger,
}));

import handler from "pages/api/config/[path]";

describe("pages/api/config/[path]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 422 for unsupported files", async () => {
    const req = { query: { path: "not-supported.txt" } };
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(422);
  });

  it("returns empty content when the file doesn't exist", async () => {
    fs.existsSync.mockReturnValueOnce(false);

    const req = { query: { path: "custom.css" } };
    const res = createMockRes();

    await handler(req, res);

    expect(res.headers["Content-Type"]).toBe("text/css");
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("");
  });

  it("returns file content when the file exists", async () => {
    fs.existsSync.mockReturnValueOnce(true);
    fs.readFileSync.mockReturnValueOnce("body{}");

    const req = { query: { path: "custom.js" } };
    const res = createMockRes();

    await handler(req, res);

    expect(res.headers["Content-Type"]).toBe("text/javascript");
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("body{}");
  });

  it("sets no-cache so an uploaded stylesheet is never served stale", async () => {
    fs.existsSync.mockReturnValueOnce(true);
    fs.readFileSync.mockReturnValueOnce("body{}");

    const res = createMockRes();
    await handler({ query: { path: "custom.css" } }, res);

    expect(res.headers["Cache-Control"]).toBe("no-cache, must-revalidate");
    expect(res.headers["Content-Type"]).toBe("text/css");
    expect(res.body).toBe("body{}");
    // ETag / 304 由 Next.js 的 res.send 原生提供，本 handler 不重复设置
    expect(res.headers.ETag).toBeUndefined();
  });

  it("logs and returns 500 when reading the file throws", async () => {
    fs.existsSync.mockReturnValueOnce(true);
    fs.readFileSync.mockImplementationOnce(() => {
      throw new Error("boom");
    });

    const req = { query: { path: "custom.css" } };
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toBe("Internal Server Error");
    expect(logger.error).toHaveBeenCalled();
  });
});
