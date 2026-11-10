// R1 spike：最小内容服务（shadow 端口）。
// 目标不是做完整产品，而是用最少代码证明：热榜逻辑可以脱离 Next.js / Homepage 镜像独立运行，
// 且对浏览器暴露的响应契约与现有 /api/widgets/news 一致。
//
// 只用 Node 原生 http + 从 news.js 逐字抽取的 news-core.mjs；无 Express / Fastify / 数据库。
// 运行：node services/content-service/src/server.mjs
// 默认监听 127.0.0.1:3406，可用 CONTENT_SERVICE_PORT 覆盖。

import http from "node:http";

import { AVAILABLE_SOURCES, SOURCES, loadSource } from "./news-core.mjs";

const PORT = Number(process.env.CONTENT_SERVICE_PORT || 3406);
const HOST = process.env.CONTENT_SERVICE_HOST || "127.0.0.1";
const DEFAULT_SOURCE = "baidu";

const stats = {
  startedAt: new Date().toISOString(),
  requests: 0,
  bySource: {},
  upstreamFetches: 0,
  errors: 0,
};

// 统计上游实际抓取次数（验证两端缓存策略是否一致），不改变 fetch 行为。
const originalFetch = globalThis.fetch;
globalThis.fetch = (...args) => {
  stats.upstreamFetches += 1;
  return originalFetch(...args);
};

function errorPayload(key) {
  const source = SOURCES[key];
  return {
    items: [],
    updatedAt: null,
    boardName: source.label,
    sources: 1,
    feedNames: [source.label],
    source: key,
    sourceLabel: source.label,
    kind: source.kind,
    availableSources: AVAILABLE_SOURCES,
    error: `${source.label}暂不可用`,
  };
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/healthz") {
    return send(res, 200, { status: "up", ...stats, rss: process.memoryUsage().rss });
  }
  if (url.pathname !== "/api/widgets/news") {
    return send(res, 404, { error: "Not Found" });
  }

  stats.requests += 1;
  const rawSource = url.searchParams.get("source");
  const key = Object.prototype.hasOwnProperty.call(SOURCES, rawSource) ? rawSource : DEFAULT_SOURCE;
  stats.bySource[key] = (stats.bySource[key] || 0) + 1;

  let payload;
  try {
    payload = await loadSource(key);
  } catch {
    stats.errors += 1;
    payload = errorPayload(key);
  }
  return send(res, 200, payload);
});

server.listen(PORT, HOST, () => {
  console.log(`content-service (R1 spike) listening on http://${HOST}:${PORT}`);
  console.log(`sources: ${AVAILABLE_SOURCES.map((s) => s.key).join(", ")}`);
});
