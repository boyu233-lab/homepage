import { withAuth } from "utils/auth";
import { CONF_DIR } from "utils/config/config";
import { invalidateDashboardData } from "utils/config/dashboard";
import {
  BACKUP_KEEP,
  CONFIG_FILES,
  applyContent,
  fileStats,
  isKnownFile,
  listBackups,
  maxUploadBytes,
  readConfigFile,
  restoreBackup,
  validateContent,
} from "utils/config/upload";
import { guardPublicWidget } from "utils/rate-limit";

// 2MB 硬上限与 utils/config/upload.js 的 maxUploadBytes() 对齐
export const config = {
  api: { bodyParser: { sizeLimit: "2mb" } },
};

/** 管理面写操作的 CSRF 兜底：NextAuth 的 SameSite=Lax cookie 之外再加一层显式同源校验 */
function sameOrigin(req) {
  const headers = req.headers || {};
  if (headers["sec-fetch-site"] === "cross-site") return false;
  const origin = headers.origin || headers.referer;
  if (!origin) return true;
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    return true;
  }
  const host = headers["x-forwarded-host"] || headers.host;
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

function writePolicy() {
  const raw = Number(process.env.HOMEPAGE_CONFIG_WRITE_LIMIT);
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(1000, Math.floor(raw)) : 30;
  return { bucket: "config-write", limit, windowMs: 60_000, concurrent: 0, sameOrigin: false };
}

async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");

  if (req.method === "GET") {
    const { download, read } = req.query || {};
    if (typeof download === "string") {
      if (!isKnownFile(download)) return res.status(400).json({ error: "不支持的文件" });
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${download}"`);
      return res.status(200).send(readConfigFile(CONF_DIR, download));
    }
    if (typeof read === "string") {
      if (!isKnownFile(read)) return res.status(400).json({ error: "不支持的文件" });
      return res.status(200).json({ file: read, content: readConfigFile(CONF_DIR, read) });
    }
    return res.status(200).json({
      files: fileStats(CONF_DIR),
      backups: Object.fromEntries(CONFIG_FILES.map((file) => [file, listBackups(CONF_DIR, file)])),
      maxBytes: maxUploadBytes(),
      backupKeep: BACKUP_KEEP,
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  if (!sameOrigin(req)) return res.status(403).json({ error: "跨站请求被拒绝" });

  const decision = guardPublicWidget(req, res, writePolicy());
  if (!decision.allowed) return undefined;

  const { action = "upload", file, content, backup } = req.body || {};
  if (!isKnownFile(file)) {
    return res.status(400).json({ error: `不支持的文件名：${String(file)}`, allowed: CONFIG_FILES });
  }

  try {
    if (action === "validate") {
      const result = validateContent(file, content);
      return res.status(result.valid ? 200 : 400).json(result);
    }

    if (action === "upload") {
      const result = applyContent(CONF_DIR, file, content);
      if (!result.ok) return res.status(400).json(result);
      // dashboard 数据有内存缓存，不清掉的话 services/widgets 改动要等容器重启才生效
      invalidateDashboardData();
      return res.status(200).json({ file, ...result, revalidated: true });
    }

    if (action === "restore") {
      if (!listBackups(CONF_DIR, file).some((entry) => entry.name === backup)) {
        return res.status(400).json({ error: "备份不存在或名称不合法" });
      }
      const result = restoreBackup(CONF_DIR, file, backup);
      if (!result.ok) return res.status(400).json(result);
      invalidateDashboardData();
      return res.status(200).json({ file, ...result, revalidated: true });
    }

    return res.status(400).json({ error: `未知操作：${String(action)}` });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// 列表会暴露配置文件的 sha256，写操作会改磁盘：一律要求登录（POST 天然不在公开读白名单内）
export default withAuth(handler);
