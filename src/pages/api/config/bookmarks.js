import fs from "fs";
import path from "path";

import * as yaml from "js-yaml";

import { withAuth } from "utils/auth";
import { CONF_DIR } from "utils/config/config";
import { loadYaml } from "utils/config/yaml";

const logger = console;

const FILE = "bookmarks.yaml";
const MAX_GROUPS = 50;
const MAX_BOOKMARKS_PER_GROUP = 200;
const MAX_TEXT_LENGTH = 500;
const MAX_HREF_LENGTH = 2000;
const MAX_FILE_BYTES = 512 * 1024;
const BACKUP_KEEP = 10;
const RESERVED_KEYS = new Set(["__proto__", "prototype", "constructor"]);

/**
 * 把 Homepage 的"易写"嵌套 YAML 结构
 *   [ { 分组名: [ { 书签名: [ {字段...}, {字段...} ] } ] } ]
 * 拍平为前端友好的平铺结构
 *   [ { name, bookmarks: [ { name, href, ...其它字段 } ] } ]
 * 注意：一个书签下若有多个字段映射，会全部合并，不再只取第一个。
 */
export function flatten(data) {
  if (!Array.isArray(data)) return [];
  return data
    .map((group) => {
      if (!group || typeof group !== "object") return null;
      const name = Object.keys(group)[0];
      if (!name || RESERVED_KEYS.has(name)) return null;
      const entries = Array.isArray(group[name]) ? group[name] : [];
      return {
        name,
        bookmarks: entries
          .map((entry) => {
            if (!entry || typeof entry !== "object") return null;
            const bname = Object.keys(entry)[0];
            if (!bname || RESERVED_KEYS.has(bname)) return null;
            const rawFields = Array.isArray(entry[bname]) ? entry[bname] : [entry[bname]];
            const fields = rawFields.reduce(
              (acc, item) => (item && typeof item === "object" ? { ...acc, ...item } : acc),
              {},
            );
            return { name: bname, ...fields };
          })
          .filter(Boolean),
      };
    })
    .filter(Boolean);
}

/**
 * 把平铺结构还原成 Homepage 期望的嵌套 YAML。
 * 除 name 外的所有字段（含 mdi 图标、自定义扩展字段）都会原样保留，避免静默丢字段。
 */
export function toYamlString(groups) {
  const nested = (groups || []).map((g) => ({
    [g.name]: (g.bookmarks || []).map((b) => {
      const fields = {};
      if (b.href !== undefined && b.href !== null && b.href !== "") fields.href = b.href;
      Object.keys(b).forEach((key) => {
        if (key === "name" || key === "href" || RESERVED_KEYS.has(key)) return;
        const value = b[key];
        if (value === undefined || value === null || value === "") return;
        fields[key] = value;
      });
      return { [b.name]: [fields] };
    }),
  }));
  return yaml.dump(nested, { lineWidth: -1, noRefs: true, sortKeys: false });
}

/** 提取文件头部注释 / --- 文档头，可视化保存时原样拼回，避免丢注释 */
export function extractHeader(raw) {
  const lines = String(raw || "").split(/\r?\n/);
  const header = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#") || trimmed === "---" || trimmed === "...") {
      header.push(line);
    } else break;
  }
  while (header.length && header[header.length - 1].trim() === "") header.pop();
  return header.length ? `${header.join("\n")}\n` : "";
}

export function buildYaml(groups, currentRaw) {
  return extractHeader(currentRaw) + toYamlString(groups);
}

function isSafeName(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= MAX_TEXT_LENGTH &&
    !RESERVED_KEYS.has(value.trim()) &&
    !/[\r\n]/.test(value)
  );
}

function isValidHref(value) {
  if (typeof value !== "string" || value.length > MAX_HREF_LENGTH) return false;
  const href = value.trim();
  if (!href || /[\r\n]/.test(href)) return false;
  // 允许同源相对路径，但不允许 //host 这种协议相对 URL
  if (href.startsWith("/") && !href.startsWith("//")) return true;
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** 手写输入校验（项目未引入 zod），返回错误说明或 null */
export function validateGroups(groups) {
  if (!Array.isArray(groups)) return "groups 必须是数组";
  if (groups.length > MAX_GROUPS) return `分组数不能超过 ${MAX_GROUPS}`;
  const groupNames = new Set();

  for (const group of groups) {
    if (!group || typeof group !== "object" || !isSafeName(group.name)) {
      return "分组名不能为空、超长或包含换行";
    }
    const groupName = group.name.trim();
    if (groupNames.has(groupName)) return `分组名重复：${groupName}`;
    groupNames.add(groupName);

    if (!Array.isArray(group.bookmarks)) return `分组「${groupName}」的 bookmarks 必须是数组`;
    if (group.bookmarks.length > MAX_BOOKMARKS_PER_GROUP) {
      return `分组「${groupName}」的标签数不能超过 ${MAX_BOOKMARKS_PER_GROUP}`;
    }
    const bookmarkNames = new Set();
    for (const bookmark of group.bookmarks) {
      if (!bookmark || typeof bookmark !== "object" || !isSafeName(bookmark.name)) {
        return `分组「${groupName}」中存在空或非法的标签名`;
      }
      const bookmarkName = bookmark.name.trim();
      if (bookmarkNames.has(bookmarkName)) return `分组「${groupName}」中标签名重复：${bookmarkName}`;
      bookmarkNames.add(bookmarkName);
      if (!isValidHref(bookmark.href)) {
        return `标签「${bookmarkName}」的链接不合法（需 http(s):// 或 / 开头的相对路径）`;
      }
      for (const [key, value] of Object.entries(bookmark)) {
        if (RESERVED_KEYS.has(key)) return `字段 ${key} 不允许使用`;
        if (value === undefined || value === null) continue;
        if (!["string", "number", "boolean"].includes(typeof value)) return `字段 ${key} 类型不合法`;
        if (typeof value === "string" && value.length > MAX_TEXT_LENGTH) return `字段 ${key} 内容过长`;
      }
    }
  }
  return null;
}

/** 源码模式：校验原文能被 Homepage 正确解析，并符合基本结构约束 */
export function validateRaw(raw) {
  if (typeof raw !== "string") return "raw 必须是字符串";
  if (Buffer.byteLength(raw, "utf8") > MAX_FILE_BYTES) return `文件内容不能超过 ${MAX_FILE_BYTES} 字节`;
  let parsed;
  try {
    parsed = loadYaml(raw);
  } catch (error) {
    return `YAML 解析失败：${error.message}`;
  }
  if (parsed === undefined || parsed === null) return "YAML 内容为空";
  const groups = flatten(parsed);
  if (!groups.length) return "YAML 不是合法的 bookmarks 分组结构";
  const error = validateGroups(groups);
  return error ? `YAML 结构校验失败：${error}` : null;
}

function timestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function nextBackupName(dir) {
  let name = `${FILE}.${timestamp()}.bak`;
  let suffix = 1;
  while (fs.existsSync(path.join(dir, name))) {
    name = `${FILE}.${timestamp()}-${suffix}.bak`;
    suffix += 1;
  }
  return name;
}

/** 时间戳多版本备份，保留最近 BACKUP_KEEP 份 */
export function backupCurrent(dir, filePath) {
  if (!fs.existsSync(filePath)) return null;
  const name = nextBackupName(dir);
  fs.copyFileSync(filePath, path.join(dir, name));
  const backups = fs
    .readdirSync(dir)
    .filter((entry) => /^bookmarks\.yaml\.\d{8}-\d{6}(?:-\d+)?\.bak$/.test(entry))
    .sort();
  while (backups.length > BACKUP_KEEP) {
    const oldest = backups.shift();
    try {
      fs.unlinkSync(path.join(dir, oldest));
    } catch (error) {
      logger.warn?.("Failed to remove old bookmarks backup:", error);
    }
  }
  return name;
}

/** 临时文件 + rename 原子替换，避免写入中途留下半截 YAML */
export function writeAtomic(filePath, content) {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, content, "utf8");
    fs.renameSync(tmp, filePath);
  } finally {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      // 临时文件清理失败不影响本次写入结果
    }
  }
}

async function handler(req, res) {
  const filePath = path.join(CONF_DIR, FILE);
  res.setHeader("Cache-Control", "private, no-store");

  if (req.method === "GET") {
    try {
      const raw = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
      const parsed = loadYaml(raw);
      return res.status(200).json({ groups: flatten(parsed), raw });
    } catch (error) {
      logger.error("Failed to read bookmarks:", error);
      return res.status(500).json({ error: String(error) });
    }
  }

  if (req.method === "POST") {
    try {
      const body = req.body || {};
      // 源码模式：原样写回（保住全部注释/格式）；可视化模式：结构化重建 + 保留文件头注释
      const isRawMode = Object.prototype.hasOwnProperty.call(body, "raw");
      let content;
      if (isRawMode) {
        const error = validateRaw(body.raw);
        if (error) return res.status(400).json({ error });
        content = body.raw;
      } else {
        const error = validateGroups(body.groups);
        if (error) return res.status(400).json({ error });
        const currentRaw = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
        content = buildYaml(body.groups, currentRaw);
        const selfCheck = validateRaw(content);
        if (selfCheck) return res.status(400).json({ error: `生成的 YAML 自检失败：${selfCheck}` });
      }

      const backup = backupCurrent(CONF_DIR, filePath);
      writeAtomic(filePath, content);
      return res.status(200).json({ ok: true, backup, mode: isRawMode ? "raw" : "visual" });
    } catch (error) {
      logger.error("Failed to write bookmarks:", error);
      return res.status(500).json({ error: String(error) });
    }
  }

  return res.status(405).json({ error: "Method Not Allowed" });
}

// 该接口不在公开读白名单内（含原始 YAML 源码），GET/POST 都需要登录；
// 写操作还额外要求未命中 isPublicRead，因此即使将来放宽白名单也不会被匿名写入。
export default withAuth(handler);
