import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";

import { isAllowedHost, secureCookie } from "utils/auth";
import { isAuthEnabled } from "utils/env";

// 本 fork 设计目标：导航仪表盘完全公开，仅"编辑面"需要登录。
// - 页面层：只有 /manage 由本 middleware 守门（单一守门，页面自身不再 withPageAuth）。
// - API 层：由 utils/auth.js 的 withAuth 按"白名单式公开读"统一处理，
//   管理接口 / 服务代理 / 所有写操作都要求有效会话。
const PROTECTED_PAGES = ["/manage"];

// GHSA-qxcr-4rv3-v23r：Next.js 会对携带内部按需重验证头的请求跳过 middleware/proxy，
// 上游曾因此出现鉴权与 Host 校验绕过。本 fork 的敏感 API 由 withAuth 在 handler 层把关、
// /manage 由页面层 getServerSideProps 二次校验；这里再拒绝外部伪造的重验证头，形成第三道防线。
const REVALIDATION_HEADER_PREFIX = "x-prerender-revalidate";

function currentAuthSecret() {
  // 运行时读取，避免生产镜像在构建期把 secret 固化
  return process.env.NEXTAUTH_SECRET || process.env.HOMEPAGE_AUTH_SECRET;
}

// 兼容 NextRequest 的 Headers、Map 与单元测试里的普通对象三种形态。
function requestHeaderNames(headers) {
  if (!headers) return [];
  if (typeof headers.keys === "function") {
    try {
      return [...headers.keys()];
    } catch {
      // 某些自定义桩的 keys() 不可迭代，回退到对象键
    }
  }
  return Object.keys(headers);
}

function readRequestHeader(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  return headers[name] ?? headers[name.toLowerCase()] ?? null;
}

export async function proxy(req) {
  if (
    requestHeaderNames(req.headers).some((name) =>
      String(name).toLowerCase().startsWith(REVALIDATION_HEADER_PREFIX),
    )
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!isAllowedHost(readRequestHeader(req.headers, "host"))) {
    return NextResponse.json({ error: "Host validation failed. See logs for more details." }, { status: 400 });
  }

  // 同样在运行时求值：middleware 会被单独打包，构建期 env 未必等于运行期 env
  if (!isAuthEnabled()) return NextResponse.next();

  const { pathname, search } = new URL(req.url);
  if (!PROTECTED_PAGES.includes(pathname)) return NextResponse.next();

  const token = await getToken({ req, secret: currentAuthSecret(), secureCookie: secureCookie() });
  if (!token) {
    // Same-origin by construction, so this cannot be used as an open redirect
    const signInUrl = new URL("/auth/signin", req.url);
    signInUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
    const response = NextResponse.redirect(signInUrl);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  const response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  // 对所有应用与 API 路由生效；放行 Next.js 内部资源、静态资源、鉴权页与 NextAuth 端点。
  matcher: [
    "/",
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|manifest.json|sitemap.xml|icons/|api/auth|auth/).*)",
  ],
};
