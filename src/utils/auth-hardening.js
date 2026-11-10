// v1.1 登录与凭据加固（A3）。
// 上游官方明确不做应用层密码尝试限流，只给 fail2ban / CrowdSec 留日志。
// 本 fork 面向「可从外网访问的单人 NAS」，因此在应用层补一层轻量锁定，
// 并对「长度够但明显是占位符」的 NEXTAUTH_SECRET 做检测。
//
// 纯内存状态：单机容器足够；重启即清空，不引入 Redis / SQLite 依赖。

const WEAK_SECRET_PATTERNS = [
  [/change[_-]?me/i, "包含 CHANGE_ME 占位符"],
  [/smoketest|placeholder|example[_-]?secret/i, "是测试/示例值"],
  [/^(.)\1+$/, "是单一重复字符"],
  [/^\d+$/, "是纯数字"],
];

/** 返回 secret 的弱点描述；没有弱点返回 null。不修改、不记录 secret 本身。 */
export function secretWeakness(secret) {
  if (typeof secret !== "string" || !secret) return null;
  for (const [pattern, reason] of WEAK_SECRET_PATTERNS) {
    if (pattern.test(secret)) return reason;
  }
  return null;
}

function envInt(name, fallback, min, max) {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.floor(raw)));
}

/**
 * 从 NextAuth CredentialsProvider 的第二个参数里取客户端标识。
 * authorize(credentials, req) 的 req.headers 是普通对象，不是 Headers 实例，
 * 因此这里同时兼容普通对象与 Headers。取不到时回退到 "unknown" 共享桶，
 * 宁可限得紧一点也不放行无法识别来源的暴力尝试。
 */
export function loginClientKey(req) {
  const headers = req?.headers;
  const read = (name) => {
    if (!headers) return null;
    if (typeof headers.get === "function") return headers.get(name);
    return headers[name] ?? headers[name.toLowerCase()] ?? null;
  };
  const forwarded = read("x-forwarded-for") || read("x-real-ip") || req?.socket?.remoteAddress || "";
  const first = String(forwarded).split(",")[0].trim();
  return first || "unknown";
}

/**
 * 固定窗口失败计数 + 临时锁定。
 * maxFailures 次失败 / windowMs 内触发锁定，锁定 lockMs 毫秒；成功后清零。
 */
export function createLoginLimiter(options = {}) {
  const maxFailures = options.maxFailures ?? envInt("HOMEPAGE_LOGIN_MAX_FAILURES", 5, 1, 100);
  const windowMs = options.windowMs ?? envInt("HOMEPAGE_LOGIN_WINDOW_MS", 60_000, 1_000, 3_600_000);
  const lockMs = options.lockMs ?? envInt("HOMEPAGE_LOGIN_LOCK_MS", 300_000, 1_000, 86_400_000);
  const state = new Map();

  function entry(key) {
    const now = Date.now();
    const current = state.get(key);
    if (!current) return { failures: 0, firstAt: now, lockedUntil: 0 };
    if (now - current.firstAt >= windowMs && now >= current.lockedUntil) {
      return { failures: 0, firstAt: now, lockedUntil: 0 };
    }
    return current;
  }

  return {
    maxFailures,
    windowMs,
    lockMs,
    isLocked(key) {
      const current = state.get(key);
      return Boolean(current && current.lockedUntil > Date.now());
    },
    retryAfterSeconds(key) {
      const current = state.get(key);
      if (!current || current.lockedUntil <= Date.now()) return 0;
      return Math.ceil((current.lockedUntil - Date.now()) / 1000);
    },
    recordFailure(key) {
      const current = entry(key);
      const failures = current.failures + 1;
      const lockedUntil = failures >= maxFailures ? Date.now() + lockMs : current.lockedUntil;
      state.set(key, { ...current, failures, lockedUntil });
      return { failures, lockedUntil };
    },
    recordSuccess(key) {
      state.delete(key);
    },
    reset() {
      state.clear();
    },
  };
}
