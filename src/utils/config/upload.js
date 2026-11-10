import { createHash } from "crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";

import { loadYaml } from "utils/config/yaml";

// 可上传文件表与 utils/mcp/homepage-mcp.js 的 CONFIG_FILES 保持一致。
// 目标路径只由本表的固定键拼接而成，绝不拼接用户提供的相对路径，从根上杜绝 ../ 穿越与任意文件写入。
export const FILE_META = {
  "settings.yaml": {
    label: "全局设置",
    yaml: true,
    root: "object",
    desc: "标题、主题、语言、布局、快捷启动",
  },
  "services.yaml": {
    label: "服务卡片",
    yaml: true,
    root: "array",
    desc: "首页服务分组、图标与状态检测",
  },
  "bookmarks.yaml": {
    label: "书签",
    yaml: true,
    root: "array",
    desc: "分组与书签链接（也可在「书签管理」页编辑）",
  },
  "widgets.yaml": {
    label: "信息部件",
    yaml: true,
    root: "array",
    desc: "搜索、时间、热榜、B站音乐等部件配置",
  },
  "docker.yaml": { label: "Docker 发现", yaml: true, root: "object", desc: "Docker socket 与自动发现" },
  "kubernetes.yaml": { label: "Kubernetes", yaml: true, root: "object", desc: "集群与 Ingress 发现" },
  "proxmox.yaml": { label: "Proxmox", yaml: true, root: "object", desc: "PVE 集群状态" },
  "custom.css": { label: "自定义样式", yaml: false, desc: "首页布局与配色覆盖（刷新即生效）" },
  "custom.js": { label: "自定义脚本", yaml: false, desc: "首页交互脚本（刷新即生效）" },
};

export const CONFIG_FILES = Object.keys(FILE_META);
export const BACKUP_KEEP = 10;
const DEFAULT_MAX_BYTES = 512 * 1024;
const HARD_MAX_BYTES = 2 * 1024 * 1024;

/** 单文件上限，可用 HOMEPAGE_CONFIG_UPLOAD_MAX_BYTES 调小/调大（硬上限 2MB，与 API bodyParser 对齐） */
export function maxUploadBytes() {
  const raw = Number(process.env.HOMEPAGE_CONFIG_UPLOAD_MAX_BYTES);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_MAX_BYTES;
  return Math.min(HARD_MAX_BYTES, Math.max(1024, Math.floor(raw)));
}

export function isKnownFile(file) {
  return typeof file === "string" && Object.prototype.hasOwnProperty.call(FILE_META, file);
}

export function assertKnownFile(file) {
  if (!isKnownFile(file)) {
    throw new Error(`不支持的文件：${String(file)}。仅允许 ${CONFIG_FILES.join(", ")}`);
  }
}

export function sha256(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * 上传前校验：类型 / 体积 / 二进制混入 / YAML 可解析 / 顶层结构。
 * 顶层结构检查用于拦截「把 bookmarks.yaml 的内容传成了 widgets.yaml」这类选错文件的误操作。
 */
export function validateContent(file, content) {
  if (!isKnownFile(file)) return { valid: false, error: `不支持的文件：${String(file)}` };
  if (typeof content !== "string") return { valid: false, error: "文件内容必须是文本" };

  const bytes = Buffer.byteLength(content, "utf8");
  const limit = maxUploadBytes();
  if (bytes > limit) return { valid: false, error: `文件 ${bytes} 字节，超过 ${limit} 字节上限` };
  if (content.includes("\u0000")) return { valid: false, error: "文件包含二进制内容（NUL 字节）" };

  const meta = FILE_META[file];
  if (!meta.yaml) return { valid: true, bytes };

  let parsed;
  try {
    parsed = loadYaml(content);
  } catch (error) {
    return {
      valid: false,
      bytes,
      error: `YAML 解析失败：${error.message}`,
      mark: error.mark
        ? { line: error.mark.line + 1, column: error.mark.column + 1, snippet: error.mark.snippet }
        : undefined,
    };
  }
  // 空文件 / 纯注释 / null 都等价于「清空该配置项」，Homepage 会回退到 skeleton，允许上传。
  if (parsed === undefined || parsed === null) return { valid: true, bytes };

  const actual = Array.isArray(parsed) ? "array" : typeof parsed === "object" ? "object" : "scalar";
  if (actual !== meta.root) {
    const expected = meta.root === "array" ? "数组（列表）" : "对象（键值）";
    const got = actual === "array" ? "数组" : actual === "object" ? "对象" : "标量";
    return { valid: false, bytes, error: `${file} 顶层应为${expected}，实际是${got}，请确认没有选错文件` };
  }
  return { valid: true, bytes };
}

function timestamp(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/** 备份名严格形如 widgets.yaml.20261110-215530[-2].bak，回滚时用它做白名单校验 */
export function backupPattern(file) {
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}\\.\\d{8}-\\d{6}(?:-\\d+)?\\.bak$`);
}

export function isBackupName(file, name) {
  return isKnownFile(file) && typeof name === "string" && backupPattern(file).test(name);
}

export function listBackups(dir, file) {
  assertKnownFile(file);
  if (!existsSync(dir)) return [];
  const pattern = backupPattern(file);
  return readdirSync(dir)
    .filter((name) => pattern.test(name))
    .map((name) => {
      const stat = statSync(join(dir, name));
      return { name, bytes: stat.size, modified: stat.mtime.toISOString(), mtimeMs: stat.mtimeMs };
    })
    // 同一秒内的多次上传会生成 -01/-02 后缀，字典序无法正确表达先后，按 mtime 排序
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name))
    .map(({ mtimeMs, ...entry }) => entry);
}

/** 写盘前备份原文件，按文件各自保留最近 BACKUP_KEEP 份 */
export function backupCurrent(dir, file) {
  assertKnownFile(file);
  const filePath = join(dir, file);
  if (!existsSync(filePath)) return null;
  mkdirSync(dir, { recursive: true });

  const stamp = timestamp();
  let name = `${file}.${stamp}.bak`;
  let suffix = 1;
  while (existsSync(join(dir, name))) {
    name = `${file}.${stamp}-${String(suffix).padStart(2, "0")}.bak`;
    suffix += 1;
  }
  copyFileSync(filePath, join(dir, name));

  const backups = listBackups(dir, file);
  while (backups.length > BACKUP_KEEP) {
    const oldest = backups.pop();
    try {
      unlinkSync(join(dir, oldest.name));
    } catch (error) {
      // 旧备份清理失败不影响本次写入
      console.warn(`Failed to remove old config backup ${oldest.name}:`, error);
    }
  }
  return name;
}

/** 临时文件 + rename 原子替换，避免写入中途留下半截配置被 Homepage 读到 */
export function writeAtomic(filePath, content) {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmp, content, "utf8");
    renameSync(tmp, filePath);
  } finally {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      // 临时文件清理失败不影响本次写入结果
    }
  }
}

export function readConfigFile(dir, file) {
  assertKnownFile(file);
  const filePath = join(dir, file);
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
}

export function fileStats(dir) {
  return CONFIG_FILES.map((file) => {
    const meta = FILE_META[file];
    const filePath = join(dir, file);
    if (!existsSync(filePath)) {
      return { name: file, ...meta, exists: false, bytes: 0, modified: null, sha256: null };
    }
    const stat = statSync(filePath);
    const content = readFileSync(filePath, "utf8");
    return {
      name: file,
      ...meta,
      exists: true,
      bytes: stat.size,
      modified: stat.mtime.toISOString(),
      sha256: sha256(content),
    };
  });
}

/** 校验 → 备份 → 原子写。返回结构化结果，HTTP 层只负责映射状态码 */
export function applyContent(dir, file, content) {
  assertKnownFile(file);
  const check = validateContent(file, content);
  if (!check.valid) return { ok: false, error: check.error, mark: check.mark };
  mkdirSync(dir, { recursive: true });
  const backup = backupCurrent(dir, file);
  writeAtomic(join(dir, file), content);
  return { ok: true, backup, bytes: check.bytes, sha256: sha256(content) };
}

/** 按备份名回滚；回滚前也会把「当前内容」再备份一份，避免误点后无法找回 */
export function restoreBackup(dir, file, backup) {
  assertKnownFile(file);
  if (!isBackupName(file, backup)) throw new Error("备份文件名不合法");
  const source = join(dir, backup);
  if (!existsSync(source)) throw new Error("备份不存在");

  const content = readFileSync(source, "utf8");
  const check = validateContent(file, content);
  if (!check.valid) return { ok: false, error: `备份内容校验失败：${check.error}` };

  const current = backupCurrent(dir, file);
  writeAtomic(join(dir, file), content);
  return {
    ok: true,
    restoredFrom: backup,
    backup: current,
    bytes: check.bytes,
    sha256: sha256(content),
  };
}
