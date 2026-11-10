// v1.1 公开 widget 读接口防护（A2）。
//
// 背景：utils/auth.js 把 /api/widgets/ 整个前缀设为匿名可读，其中包含 9 个服务端抓外网的
// 热榜接口和一个会把 B站 CDN 音轨流式转发给浏览器的代理。公网暴露时可被人刷流量 / 当免费
// 代理用。这里在 handler 层补：按客户端 IP 的令牌窗口限流、音频并发上限、跨站盗链校验，
// 以及最小安全响应头；阈值全部可用环境变量覆盖，误伤时可一键关闭。
//
// 纯内存状态：单容器单机足够，重启清空，不引入外部依赖。所有策略在请求进入时才求值，
// 便于测试与运行时调参。

function envInt(name, fallback, min, max) {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.floor(raw)));
}

function enabled() {
  return process.env.HOMEPAGE_RATE_LIMIT_ENABLED !== "false";
}

/** 匿名 widget 请求的默认策略。数值刻意留足余量，避免误伤首页并发拉取与拖动进度条。 */
export function widgetPolicy(name) {
  if (name === "audio") {
    return {
      bucket: "audio",
      limit: envInt("HOMEPAGE_AUDIO_LIMIT", 60, 1, 10000),
      windowMs: envInt("HOMEPAGE_AUDIO_WINDOW_MS", 60_000, 1_000, 3_600_000),
      concurrent: envInt("HOMEPAGE_AUDIO_CONCURRENT", 4, 1, 64),
      sameOrigin: true,
    };
  }
  return {
    bucket: name || "widget",
    limit: envInt("HOMEPAGE_PUBLIC_WIDGET_LIMIT", 180, 1, 100000),
    windowMs: envInt("HOMEPAGE_PUBLIC_WIDGET_WINDOW_MS", 60_000, 1_000, 3_600_000),
    concurrent: 0,
    sameOrigin: false,
  };
}

const windows = new Map(); // "bucket:client" -> { start, count }
const inflight = new Map(); // "bucket:client" -> number

/** 测试与诊断用：清空全部计数。 */
export function resetRateLimits() {
  windows.clear();
  inflight.clear();
}

export function rateLimitSnapshot() {
  return {
    windows: [...windows.entries()].map(([key, value]) => ({ key, ...value })),
    inflight: [...inflight.entries()],
  };
}

function header(req, name) {
  const headers = req?.headers;
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  return headers[name] ?? headers[name.toLowerCase()] ?? null;
}

/**
 * 取客户端标识。群晖 / 反向代理场景下 remoteAddress 会是代理地址，因此默认信任
 * x-forwarded-for；部署时务必让反代覆盖该头（见部署文档 6.10）。若设
 * HOMEPAGE_TRUST_PROXY=false，则只看 socket 地址。
 */
export function clientKey(req) {
  const trustProxy = process.env.HOMEPAGE_TRUST_PROXY !== "false";
  const forwarded = trustProxy ? header(req, "x-forwarded-for") || header(req, "x-real-ip") : null;
  const first = String(forwarded || "").split(",")[0].trim();
  const remote = req?.socket?.remoteAddress || req?.connection?.remoteAddress || "";
  return first || remote || "unknown";
}

function sameOriginAllowed(req) {
  const site = header(req, "sec-fetch-site");
  if (site === "cross-site") return false;

  const origin = header(req, "origin") || header(req, "referer");
  if (!origin) return true; // 部分媒体请求不带这些头，宽松放行
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    return true;
  }
  const host = header(req, "x-forwarded-host") || header(req, "host");
  if (!host || originHost === host) return true;
  const extras = (process.env.HOMEPAGE_PUBLIC_ORIGINS || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return extras.some((entry) => {
    try {
      return new URL(entry).host === originHost;
    } catch {
      return entry === originHost;
    }
  });
}

function checkWindow(key, policy, now) {
  const current = windows.get(key);
  if (!current || now - current.start >= policy.windowMs) {
    windows.set(key, { start: now, count: 1 });
    return { count: 1, start: now };
  }
  current.count += 1;
  return current;
}

function setSecurityHeaders(res, policy, decision) {
  if (typeof res?.setHeader !== "function") return;
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-RateLimit-Limit", String(policy.limit));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, policy.limit - decision.count)));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil((decision.start + policy.windowMs) / 1000)));
  if (policy.concurrent) {
    res.setHeader("X-RateLimit-Concurrent", String(policy.concurrent));
  }
}

/**
 * 包装 widget handler：先做跨站校验与限流，再执行原 handler。
 * 返回 false 表示已自行写出 403/429/503，调用方不应再处理请求。
 */
export function guardPublicWidget(req, res, policy) {
  // 单元测试构造的纯 { query } 桩没有 headers/socket：真实 HTTP 请求一定带 headers。
  // 这种情况下视为不可识别来源，直接放行，避免测试桩被计入共享桶。
  if (!req || (!req.headers && !req.socket && !req.connection)) return { allowed: true, release: null };

  const p = policy || widgetPolicy();
  if (!enabled()) return { allowed: true, release: null };

  if (p.sameOrigin && !sameOriginAllowed(req)) {
    if (typeof res?.status === "function") {
      res.status(403).json({ error: "Cross-site request rejected" });
    }
    return { allowed: false, release: null };
  }

  const now = Date.now();
  const windowKey = `${p.bucket}:${clientKey(req)}`;
  const decision = checkWindow(windowKey, p, now);
  setSecurityHeaders(res, p, decision);

  if (decision.count > p.limit) {
    const retryAfter = Math.max(1, Math.ceil((decision.start + p.windowMs - now) / 1000));
    if (typeof res?.status === "function") {
      if (typeof res.setHeader === "function") res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({ error: "Too many requests", retryAfter });
    }
    return { allowed: false, release: null };
  }

  let release = null;
  if (p.concurrent) {
    const current = inflight.get(windowKey) || 0;
    if (current >= p.concurrent) {
      if (typeof res?.status === "function") {
        if (typeof res.setHeader === "function") res.setHeader("Retry-After", "1");
        res.status(503).json({ error: "Too many concurrent streams" });
      }
      return { allowed: false, release: null };
    }
    inflight.set(windowKey, current + 1);
    let released = false;
    release = () => {
      if (released) return;
      released = true;
      const left = (inflight.get(windowKey) || 1) - 1;
      if (left <= 0) inflight.delete(windowKey);
      else inflight.set(windowKey, left);
    };
  }
  return { allowed: true, release };
}

/** 便捷包装器：export default withAuth(withPublicWidgetGuard(handler, "audio")) */
export function withPublicWidgetGuard(handler, policy) {
  const resolved = typeof policy === "string" ? widgetPolicy(policy) : policy || widgetPolicy();
  return async function guardedHandler(req, res) {
    const decision = guardPublicWidget(req, res, resolved);
    if (!decision.allowed) return undefined;
    if (decision.release && typeof res?.once === "function") {
      res.once("finish", decision.release);
      res.once("close", decision.release);
    } else if (decision.release) {
      // 没有事件钩子的响应对象（测试桩）：handler 结束后立即释放
      try {
        return await handler(req, res);
      } finally {
        decision.release();
      }
    }
    return handler(req, res);
  };
}
