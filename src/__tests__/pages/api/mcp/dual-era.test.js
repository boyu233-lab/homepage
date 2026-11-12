import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getServerSession, errorMock } = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  errorMock: vi.fn(),
}));

vi.mock("next-auth/next", () => ({ getServerSession }));
vi.mock("utils/logger", () => ({ default: () => ({ error: errorMock, warn: vi.fn(), debug: vi.fn() }) }));

import { handleMcpRequest, mcpHttpStatus } from "utils/mcp/homepage-mcp";

const MODERN_META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
};

function modern(method, extraParams = {}, headers = {}) {
  return handleMcpRequest(
    { jsonrpc: "2.0", id: 7, method, params: { _meta: { ...MODERN_META }, ...extraParams } },
    { "Mcp-Method": method, ...headers },
  );
}

describe("MCP dual-era — handleMcpRequest (direct)", () => {
  it("keeps legacy initialize byte-identical (AC-01)", () => {
    const res = handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "initialize" });
    expect(res.result.protocolVersion).toBe("2025-11-25");
    expect(res.result.capabilities).toEqual({ tools: {}, resources: {} });
    expect(res.result.serverInfo).toEqual({ name: "homepage", version: "1.0.0" });
    expect(res.result.resultType).toBeUndefined();
    expect(res.result._meta).toBeUndefined();
  });

  it("keeps legacy tools/list free of modern fields", () => {
    const res = handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.result.tools.length).toBeGreaterThan(0);
    expect(res.result.resultType).toBeUndefined();
    expect(res.result.ttlMs).toBeUndefined();
    expect(res.result.cacheScope).toBeUndefined();
    expect(res.result._meta).toBeUndefined();
  });

  it("implements server/discover without requiring _meta (AC-03)", () => {
    const res = handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "server/discover" });
    expect(res.result.resultType).toBe("complete");
    expect(res.result.supportedVersions).toEqual(["2026-07-28", "2025-11-25"]);
    expect(res.result.capabilities).toEqual({ tools: {}, resources: {} });
    expect(res.result.instructions).toEqual(expect.any(String));
    expect(res.result.ttlMs).toEqual(expect.any(Number));
    expect(res.result.cacheScope).toBeTruthy();
    expect(res.result._meta["io.modelcontextprotocol/serverInfo"]).toEqual({ name: "homepage", version: "1.0.0" });
    expect(mcpHttpStatus(res)).toBe(200);
  });

  it("returns -32602 + 400 when modern request misses clientCapabilities (AC-02)", () => {
    const res = handleMcpRequest(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } },
      },
      { "Mcp-Method": "tools/list" },
    );
    expect(res.error.code).toBe(-32602);
    expect(mcpHttpStatus(res)).toBe(400);
  });

  it("treats MCP-Protocol-Version header as modern and still requires _meta", () => {
    const res = handleMcpRequest(
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
      { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/list" },
    );
    expect(res.error.code).toBe(-32602);
    expect(mcpHttpStatus(res)).toBe(400);
  });

  it("returns -32022 + data + 400 for an unsupported version", () => {
    const res = handleMcpRequest({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/list",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "1999-01-01",
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }, { "Mcp-Method": "tools/list" });
    expect(res.error.code).toBe(-32022);
    expect(res.error.data.supported).toEqual(["2026-07-28", "2025-11-25"]);
    expect(res.error.data.requested).toBe("1999-01-01");
    expect(mcpHttpStatus(res)).toBe(400);
  });

  it("returns -32020 + 400 when Mcp-Method disagrees with body method (AC-04)", () => {
    const res = modern("tools/list", {}, { "Mcp-Method": "resources/list" });
    expect(res.error.code).toBe(-32020);
    expect(mcpHttpStatus(res)).toBe(400);
  });

  it("returns -32020 + 400 when Mcp-Name disagrees with params.name", () => {
    const res = modern("tools/call", { name: "list_config_files" }, { "Mcp-Name": "read_config_file" });
    expect(res.error.code).toBe(-32020);
    expect(mcpHttpStatus(res)).toBe(400);
  });

  it("adds modern metadata to tools/list results", () => {
    const res = modern("tools/list", {}, { "Mcp-Method": "tools/list" });
    expect(res.result.resultType).toBe("complete");
    expect(res.result.ttlMs).toEqual(expect.any(Number));
    expect(res.result.cacheScope).toBeTruthy();
    expect(res.result._meta["io.modelcontextprotocol/serverInfo"]).toEqual({ name: "homepage", version: "1.0.0" });
    expect(res.result.tools.length).toBeGreaterThan(0);
  });

  it("adds modern metadata to resources/list and resources/read results", () => {
    const list = modern("resources/list", {}, { "Mcp-Method": "resources/list" });
    expect(list.result.resultType).toBe("complete");
    expect(list.result.ttlMs).toEqual(expect.any(Number));
    expect(list.result.resources.length).toBeGreaterThan(0);

    const read = modern(
      "resources/read",
      { uri: "homepage://config/settings.yaml" },
      { "Mcp-Method": "resources/read", "Mcp-Name": "homepage://config/settings.yaml" },
    );
    expect(read.result.resultType).toBe("complete");
    expect(read.result.ttlMs).toEqual(expect.any(Number));
    expect(read.result.contents).toHaveLength(1);
  });

  it("returns -32020 + 400 when the Mcp-Method header is missing", () => {
    const res = handleMcpRequest(
      { jsonrpc: "2.0", id: 8, method: "tools/list", params: { _meta: { ...MODERN_META } } },
      {},
    );
    expect(res.error.code).toBe(-32020);
    expect(res.error.data.header).toBe("Mcp-Method");
    expect(res.error.data.required).toBe(true);
    expect(mcpHttpStatus(res)).toBe(400);
  });

  it("requires Mcp-Name for named operations", () => {
    const res = modern("tools/call", { name: "list_config_files" });
    expect(res.error.code).toBe(-32020);
    expect(res.error.data.header).toBe("Mcp-Name");
    expect(res.error.data.required).toBe(true);
    expect(mcpHttpStatus(res)).toBe(400);
  });
});

function mockResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader: vi.fn((key, value) => {
      res.headers[key] = value;
    }),
    status: vi.fn((code) => {
      res.statusCode = code;
      return res;
    }),
    json: vi.fn((body) => {
      res.body = body;
      return res;
    }),
    end: vi.fn((body) => {
      res.body = body;
      return res;
    }),
  };
  return res;
}

async function loadHandler() {
  vi.resetModules();
  return (await import("pages/api/mcp/index")).default;
}

describe("pages/api/mcp — modern HTTP status mapping", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    getServerSession.mockReset();
    errorMock.mockReset();
    process.env = {
      ...originalEnv,
      HOMEPAGE_MCP_ENABLED: "true",
      HOMEPAGE_MCP_TOKEN: "mcp-tok-0123456789abcdefghijklmnopqrstuv",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("maps a modern validation error to HTTP 400", async () => {
    const handler = await loadHandler();
    const res = mockResponse();

    await handler(
      {
        method: "POST",
        headers: {
          authorization: "Bearer mcp-tok-0123456789abcdefghijklmnopqrstuv",
          "Mcp-Method": "tools/list",
        },
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } },
        },
      },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body.error.code).toBe(-32602);
  });

  it("keeps legacy requests at HTTP 200", async () => {
    const handler = await loadHandler();
    const res = mockResponse();

    await handler(
      {
        method: "POST",
        headers: { authorization: "Bearer mcp-tok-0123456789abcdefghijklmnopqrstuv" },
        body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
      },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.result.tools.length).toBeGreaterThan(0);
  });
});
