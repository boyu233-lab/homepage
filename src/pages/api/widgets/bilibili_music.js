import { withAuth } from "utils/auth";
import { getPrivateWidgetOptions } from "utils/config/widget-helpers";
import createLogger from "utils/logger";
import { withPublicWidgetGuard } from "utils/rate-limit";

const logger = createLogger("bilibili_music");

// 历史命名：v1.0.2 这里曾是「B站音乐区排行榜」，v1.0.3 起改为
// 「输入关键词搜索 B站视频 → 手动选择播放」。widget key 保持不变，
// 这样已有部署只换镜像也不会出现 Missing bilibili_music。
//
// 上游地址写死、只接受关键词与页码，绝不透传配置里的 URL，避免 SSRF。
// 该端点在完整浏览器 UA 下免登录可用（已实测容器内网 code=0）。
const SEARCH_BASE = "https://api.bilibili.com/x/web-interface/wbi/search/type";
const SEARCH_TYPE = "video";
const WIDGET_TYPE = "bilibili_music";

const MAX_QUERY_LENGTH = 60;
const MAX_PAGE = 10;
const MAX_ITEMS = 20; // B站搜索每页固定 20 条
const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;
const MIN_CACHE_TTL_MS = 60 * 1000;
const MAX_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// 手动刷新（force=1）也保留最小间隔，避免反复调用触发 B站风控
const FORCE_MIN_INTERVAL_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const MAX_CACHE_ENTRIES = 40;

// B站会把自定义 / 简写 UA 判为爬虫并返回 code=-352；必须用完整浏览器头
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const BVID_PATTERN = /^BV[0-9A-Za-z]{10}$/;

// 按「关键词 + 页码」独立缓存；Map 同时充当简单 LRU
const cache = new Map();

export function cacheTTL(value) {
  const ms = Number(Array.isArray(value) ? value[0] : value);
  if (!Number.isFinite(ms) || ms <= 0) return DEFAULT_CACHE_TTL_MS;
  return Math.min(MAX_CACHE_TTL_MS, Math.max(MIN_CACHE_TTL_MS, ms));
}

export function normalizeQuery(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return "";
  // 去掉控制字符，压缩空白，限制长度：关键词会拼进 URL，必须收敛
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_QUERY_LENGTH);
}

export function normalizePage(value) {
  const number = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(number) && number >= 1 ? Math.min(MAX_PAGE, number) : 1;
}

// B站搜索结果标题带 <em class="keyword"> 高亮标签与 HTML 实体，
// 必须剥成纯文本：React 会再做一次转义，避免出现字面量标签 / &amp;
export function cleanText(value, max = 120) {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:nbsp|#160);/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);
}

// "4:30" / "1:02:05" → 秒；数字直接按秒处理
export function parseDuration(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value);
  const parts = String(value ?? "")
    .trim()
    .split(":")
    .map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part) || part < 0)) return 0;
  return Math.floor(parts.reduce((total, part) => total * 60 + part, 0));
}

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

export function normalizeSearch(json, { query, page }) {
  if (json?.code !== 0 || !Array.isArray(json?.data?.result)) {
    throw new Error(`B站返回异常: code=${json?.code ?? "unknown"}`);
  }

  const seen = new Set();
  const items = [];
  for (const entry of json.data.result) {
    const bvid = typeof entry?.bvid === "string" ? entry.bvid.trim() : "";
    const title = cleanText(entry?.title, 120);
    // 只接受合法 bvid：链接由服务端按白名单格式拼接，绝不透传上游 arcurl / url
    if (!BVID_PATTERN.test(bvid) || !title || seen.has(bvid)) continue;
    seen.add(bvid);

    items.push({
      rank: items.length + 1,
      bvid,
      title,
      author: cleanText(entry?.author, 60),
      duration: parseDuration(entry?.duration),
      view: count(entry?.play),
      pubdate: count(entry?.pubdate),
      link: `https://www.bilibili.com/video/${bvid}`,
    });
    if (items.length >= MAX_ITEMS) break;
  }

  // 搜不到是正常业务结果，不抛错，交给前端显示「没有找到相关视频」
  return {
    query,
    page,
    total: count(json.data.numResults),
    items,
    updatedAt: new Date().toISOString(),
  };
}

export async function loadSearch({ query, page = 1, ttl = DEFAULT_CACHE_TTL_MS, force = false } = {}) {
  const key = `${query}\u0000${page}`;
  const hit = cache.get(key);
  if (hit) {
    const age = Date.now() - hit.at;
    // 无论自动还是手动，都保留 60 秒最小间隔，防止被刷触发风控
    if (age < FORCE_MIN_INTERVAL_MS) return hit.payload;
    if (!force && age < ttl) return hit.payload;
  }

  const url = `${SEARCH_BASE}?${new URLSearchParams({
    search_type: SEARCH_TYPE,
    keyword: query,
    page: String(page),
  })}`;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh;q=0.9",
      Referer: "https://search.bilibili.com/",
      Origin: "https://www.bilibili.com",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const payload = normalizeSearch(await response.json(), { query, page });
  cache.delete(key);
  cache.set(key, { at: Date.now(), payload });
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  return payload;
}

async function handler(req, res) {
  const { index, q, page, force, refreshInterval } = req.query;
  await getPrivateWidgetOptions(WIDGET_TYPE, index);

  const query = normalizeQuery(q);
  const pageNumber = normalizePage(page);
  let payload;
  try {
    payload = query
      ? await loadSearch({
          query,
          page: pageNumber,
          ttl: cacheTTL(refreshInterval),
          force: force === "1",
        })
      : { query: "", page: 1, total: 0, items: [], updatedAt: null };
  } catch (error) {
    logger.error("B站搜索失败 (%s, 第 %s 页): %s", query, pageNumber, error?.message ?? String(error));
    payload = {
      query,
      page: pageNumber,
      total: 0,
      items: [],
      updatedAt: null,
      error: "搜索暂不可用",
    };
  }

  res.setHeader("Cache-Control", "private, no-store");
  return res.status(200).json(payload);
}

export default withAuth(withPublicWidgetGuard(handler, "search"));
