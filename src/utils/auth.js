import { getToken } from "next-auth/jwt";

import { isAuthEnabled } from "utils/env";

/**
 * 本 fork 的公开读白名单。
 * 设计：导航仪表盘公开，仅"管理面 / 代理面 / 写操作"需要登录。
 * 只有 GET/HEAD 且路径命中白名单时才匿名放行；其余一律要求有效会话。
 *
 * 不放行（必须登录）的敏感端点：
 *   /api/config/bookmarks  —— 管理页读写接口（含原始 YAML 源码）
 *   /api/config/upload     —— 配置上传 / 下载 / 回滚接口（v1.2.0）
 *   /api/services/proxy    —— 会转发到配置中的内网服务
 *   /api/revalidate        —— 触发配置重载（有副作用）
 *   /api/mcp               —— MCP 管理面
 *
 * 如需额外放行某个只读端点，可用环境变量 HOMEPAGE_PUBLIC_READ_PATHS 追加，
 * 逗号分隔，支持以 * 结尾做前缀匹配，例如：
 *   HOMEPAGE_PUBLIC_READ_PATHS=/api/services/proxy,/api/widgets/mywidget*
 */
const PUBLIC_READ_PATHS = [
  "/api/healthcheck",
  "/api/bookmarks",
  "/api/services",
  "/api/hash",
  "/api/validate",
  "/api/widgets",
  "/api/theme",
  "/api/releases",
  "/api/config/custom.css",
  "/api/config/custom.js",
];

// 这些前缀下的端点都是导航页渲染所需的只读数据（widget 数据、服务状态等）
const PUBLIC_READ_PREFIXES = [
  "/api/widgets/",
  "/api/docker/",
  "/api/kubernetes/",
  "/api/proxmox/",
  "/api/ping",
  "/api/siteMonitor",
  "/api/search/searchSuggestion",
];

const RESERVED_PATHS = [
  "/api/config/bookmarks",
  "/api/config/upload",
  "/api/services/proxy",
  "/api/revalidate",
  "/api/mcp",
];

function normalizePath(pathname) {
  let value = pathname;
  try {
    value = decodeURIComponent(value);
  } catch {
    // 保留原始值，非法编码的路径不会误命中白名单
  }
  if (value.length > 1) value = value.replace(/\/+$/, "");
  return value;
}

function extraPublicPaths() {
  return (process.env.HOMEPAGE_PUBLIC_READ_PATHS || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** 判断某个路径是否属于"匿名可读"的只读数据面 */
export function isPublicReadPath(pathname) {
  if (typeof pathname !== "string" || !pathname) return false;
  const path = normalizePath(pathname);
  if (RESERVED_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) return false;
  if (PUBLIC_READ_PATHS.includes(path)) return true;
  if (PUBLIC_READ_PREFIXES.some((p) => path === p || path.startsWith(p.endsWith("/") ? p : `${p}/`))) return true;
  for (const entry of extraPublicPaths()) {
    if (entry === "*") return true;
    if (entry.endsWith("*") ? path.startsWith(entry.slice(0, -1)) : path === normalizePath(entry)) return true;
  }
  return false;
}

/** 判断本次请求是否为"白名单内的只读请求"，用于 withAuth */
export function isPublicRead(req) {
  if (req?.method !== "GET" && req?.method !== "HEAD") return false;
  if (typeof req?.url !== "string" || !req.url) return false;
  try {
    return isPublicReadPath(new URL(req.url, "http://localhost").pathname);
  } catch {
    return false;
  }
}

export function isAllowedHost(host) {
  if (process.env.HOMEPAGE_ALLOWED_HOSTS === "*") return true;
  const port = process.env.PORT || 3000;
  // 自动信任 HOMEPAGE_EXTERNAL_URL / NEXTAUTH_URL 推导出的 host，
  // 这样在群晖/局域网用域名或 IP 访问时无需再单独设置 HOMEPAGE_ALLOWED_HOSTS。
  let externalHost = null;
  try {
    const url = new URL(process.env.NEXTAUTH_URL || process.env.HOMEPAGE_EXTERNAL_URL || "");
    if (url.host) externalHost = url.host;
  } catch {
    externalHost = null;
  }
  const allowedHosts = [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]
    .concat(externalHost ? [externalHost] : [])
    .concat(
      process.env.HOMEPAGE_ALLOWED_HOSTS
        ? process.env.HOMEPAGE_ALLOWED_HOSTS.split(",").map((entry) => entry.trim())
        : [],
    );
  if (host && allowedHosts.includes(host)) return true;
  console.error(
    `Host validation failed for: ${host}. Hint: Set the HOMEPAGE_ALLOWED_HOSTS environment variable to allow requests from this host / port.`,
  );
  return false;
}

export function withAllowedHost(handler) {
  return async function hostCheckedHandler(req, res) {
    if (!isAllowedHost(req.headers?.host)) {
      return res.status(400).json({ error: "Host validation failed. See logs for more details." });
    }
    return handler(req, res);
  };
}

// Match NextAuth, which picks the cookie name from the parsed URL protocol
export function secureCookie() {
  try {
    return new URL(process.env.NEXTAUTH_URL || process.env.HOMEPAGE_EXTERNAL_URL).protocol === "https:";
  } catch {
    return false;
  }
}

async function authorized(req, res) {
  // 运行时求值：middleware / 生产镜像的构建期与运行期 env 注入时机不同，
  // 不能在模块顶层把 isAuthEnabled() 或 secret 固化。
  if (!isAuthEnabled()) return true;

  res.setHeader("Cache-Control", "private, no-store");
  return Boolean(
    await getToken({
      req,
      secret: process.env.NEXTAUTH_SECRET || process.env.HOMEPAGE_AUTH_SECRET,
      secureCookie: secureCookie(),
    }),
  );
}

export function withAuth(handler, { public: isPublic } = {}) {
  return withAllowedHost(async function authenticatedHandler(req, res) {
    // 显式标记为 public 的处理器（如登录页 CSS）与白名单内的只读 GET 都放行；
    // 其它请求（含所有写操作、管理接口、代理接口）一律要求有效会话。
    const isPublicReq = isPublic?.(req) || isPublicRead(req);
    if (!isPublicReq && !(await authorized(req, res))) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    return handler(req, res);
  });
}

export function withPageAuth(getProps) {
  return async function authenticatedPage(context) {
    if (!isAllowedHost(context.req?.headers?.host)) {
      return { notFound: true };
    }
    if (!(await authorized(context.req, context.res))) {
      // resolvedUrl is a path supplied by Next.js, never an external destination.
      const callbackUrl = context.resolvedUrl || "/";
      return {
        redirect: {
          destination: `/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`,
          permanent: false,
        },
      };
    }
    return getProps(context);
  };
}
