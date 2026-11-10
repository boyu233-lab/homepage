import { createHash, timingSafeEqual } from "node:crypto";

import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

import { withAllowedHost } from "utils/auth";
import { createLoginLimiter, loginClientKey, secretWeakness } from "utils/auth-hardening";
import { applyNextAuthEnv, isAuthEnabled } from "utils/env";
import createLogger from "utils/logger";

const MIN_AUTH_SECRET_LENGTH = 32;
const loginLimiter = createLoginLimiter();

const authEnabled = isAuthEnabled();
const issuer = process.env.HOMEPAGE_OIDC_ISSUER;
const clientId = process.env.HOMEPAGE_OIDC_CLIENT_ID;
const clientSecret = process.env.HOMEPAGE_OIDC_CLIENT_SECRET;
const homepageAuthPassword = process.env.HOMEPAGE_AUTH_PASSWORD;
const homepageAuthPasswordDigest = homepageAuthPassword
  ? createHash("sha256").update(homepageAuthPassword, "utf8").digest()
  : null;

// Also done in instrumentation.js
applyNextAuthEnv();

const defaultScope = process.env.HOMEPAGE_OIDC_SCOPE || "openid email profile";
const cleanedIssuer = issuer ? issuer.replace(/\/+$/, "") : issuer;
const hasOidcConfig = Boolean(issuer && clientId && clientSecret);
const hasAnyOidcConfig = Boolean(issuer || clientId || clientSecret);
let parsedAuthUrl;

if (authEnabled) {
  if (!process.env.NEXTAUTH_URL) {
    throw new Error("Homepage auth is enabled but HOMEPAGE_EXTERNAL_URL (or NEXTAUTH_URL) is missing.");
  }

  try {
    parsedAuthUrl = new URL(process.env.NEXTAUTH_URL);
  } catch {
    throw new Error("HOMEPAGE_EXTERNAL_URL (or NEXTAUTH_URL) must be an absolute HTTP(S) URL.");
  }

  if (
    !["http:", "https:"].includes(parsedAuthUrl.protocol) ||
    parsedAuthUrl.username ||
    parsedAuthUrl.password ||
    parsedAuthUrl.search ||
    parsedAuthUrl.hash
  ) {
    throw new Error(
      "HOMEPAGE_EXTERNAL_URL (or NEXTAUTH_URL) must be an absolute HTTP(S) URL without credentials, query, or fragment.",
    );
  }

  if (hasOidcConfig) {
    if (!process.env.NEXTAUTH_SECRET) {
      throw new Error("OIDC auth is enabled but required settings are missing.");
    }
  } else if (hasAnyOidcConfig) {
    throw new Error("OIDC auth is enabled but required settings are missing.");
  } else if (!homepageAuthPassword || !process.env.NEXTAUTH_SECRET) {
    throw new Error("Password auth is enabled but required settings are missing.");
  }

  if (process.env.NEXTAUTH_SECRET.length < MIN_AUTH_SECRET_LENGTH) {
    throw new Error(
      `HOMEPAGE_AUTH_SECRET (or NEXTAUTH_SECRET) must be at least ${MIN_AUTH_SECRET_LENGTH} characters. Generate one with: openssl rand -base64 32`,
    );
  }

  // 长度达标但仍是 CHANGE_ME / 测试值时，默认醒目告警；设 HOMEPAGE_REQUIRE_STRONG_SECRET=true
  // 则直接拒绝启动，避免「占位符长度刚好够」这种隐性风险被带到公网。
  const weakness = secretWeakness(process.env.NEXTAUTH_SECRET);
  if (weakness) {
    const message = `NEXTAUTH_SECRET 疑似占位符（${weakness}）。请立刻用 openssl rand -base64 32 重新生成。`;
    if (process.env.HOMEPAGE_REQUIRE_STRONG_SECRET === "true") {
      throw new Error(message);
    }
    createLogger("nextauth").warn(message);
  }
}

// Give fail2ban / CrowdSec etc something to match on
function logFailedPasswordSignIn() {
  createLogger("nextauth").warn("Failed password sign-in attempt");
}

function logNextAuthError(code, metadata) {
  const error = metadata instanceof Error ? metadata : metadata?.error;

  if (error?.message) {
    createLogger("nextauth").error("%s: %s", code, error.message);
  } else {
    createLogger("nextauth").error("%s", code);
  }
}

let providers = [];
if (authEnabled) {
  if (hasOidcConfig) {
    providers = [
      {
        id: "homepage-oidc",
        name: process.env.HOMEPAGE_OIDC_NAME || "Homepage OIDC",
        type: "oauth",
        idToken: true,
        checks: ["pkce", "state", "nonce"],
        issuer: cleanedIssuer,
        wellKnown: `${cleanedIssuer}/.well-known/openid-configuration`,
        clientId,
        clientSecret,
        authorization: {
          params: {
            scope: defaultScope,
          },
        },
        profile(profile) {
          return {
            id: profile.sub ?? profile.id ?? profile.user_id ?? profile.uid ?? profile.email,
            name: profile.name ?? profile.preferred_username ?? profile.nickname ?? profile.email,
            email: profile.email ?? null,
            image: profile.picture ?? null,
          };
        },
      },
    ];
  } else {
    providers = [
      CredentialsProvider({
        name: "Password",
        credentials: {
          password: { label: "Password", type: "password" },
        },
        async authorize(credentials, request) {
          const clientKey = loginClientKey(request);
          const provided = credentials?.password;
          // 锁定期内即使密码正确也拒绝，避免攻击者靠持续重试撞开窗口边界。
          if (loginLimiter.isLocked(clientKey)) {
            createLogger("nextauth").warn(
              "Password sign-in temporarily locked for client (retry after %ss)",
              loginLimiter.retryAfterSeconds(clientKey),
            );
            return null;
          }
          if (!homepageAuthPasswordDigest || typeof provided !== "string") {
            loginLimiter.recordFailure(clientKey);
            logFailedPasswordSignIn();
            return null;
          }
          const providedDigest = createHash("sha256").update(provided, "utf8").digest();
          const isMatch = timingSafeEqual(providedDigest, homepageAuthPasswordDigest);
          if (!isMatch) {
            loginLimiter.recordFailure(clientKey);
            logFailedPasswordSignIn();
            return null;
          }
          loginLimiter.recordSuccess(clientKey);
          return {
            id: "homepage",
            name: "Homepage",
          };
        },
      }),
    ];
  }
}

export const authOptions = {
  providers,
  session: {
    strategy: "jwt",
  },
  secret: process.env.NEXTAUTH_SECRET,
  useSecureCookies: parsedAuthUrl?.protocol === "https:",
  pages: {
    signIn: "/auth/signin",
  },
  logger: {
    error: logNextAuthError,
    warn: (code) => createLogger("nextauth").warn("%s", code),
    debug: (code) => createLogger("nextauth").debug("%s", code),
  },
  events: {
    signIn: async ({ account }) =>
      createLogger("nextauth").debug("Sign in via provider '%s'", account?.provider ?? "unknown"),
    signOut: async () => createLogger("nextauth").debug("Sign out"),
  },
};

const nextAuthHandler = NextAuth(authOptions);

async function handler(req, res) {
  // 运行时求值：生产镜像若构建期未带 HOMEPAGE_AUTH_ENABLED=true，
  // providers 会是空的，此时必须显式报错而不是静默放行匿名请求。
  if (!isAuthEnabled()) {
    return res.status(200).json({});
  }
  if (!authEnabled) {
    throw new Error(
      "Homepage auth is enabled at runtime but was disabled when the server bundle was built. " +
        "Rebuild the image with HOMEPAGE_AUTH_ENABLED=true and the same NEXTAUTH_SECRET / NEXTAUTH_URL.",
    );
  }

  return nextAuthHandler(req, res);
}

export default withAllowedHost(handler);
