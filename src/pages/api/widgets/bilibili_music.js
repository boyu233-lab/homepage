import { withAuth } from "utils/auth";
import { getPrivateWidgetOptions } from "utils/config/widget-helpers";
import createLogger from "utils/logger";

const logger = createLogger("bilibili_music");

// B站音乐区排行榜（服务端代理，浏览器不直连 api.bilibili.com，访客 IP 不外泄）。
// rid=3 音乐区 / type=all，地址写死且不接受配置里的 URL，避免 SSRF。
const RANKING_URL = "https://api.bilibili.com/x/web-interface/ranking/v2?rid=3&type=all";
const SOURCE_NAME = "B站音乐榜";

// 音乐区排行榜按天更新，默认缓存 24 小时；实际周期由 widgets.yaml 的
// bilibili_music.refreshInterval 经前端透传，clamp 到 1 分钟 ~ 7 天。
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_CACHE_TTL_MS = 60 * 1000;
const MAX_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// 手动刷新（force=1）也保留最小间隔，避免被反复调用触发 B站风控
const FORCE_MIN_INTERVAL_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const MAX_ITEMS = 50;
// B站风控会把自定义/简写 UA 判为爬虫并返回 code=-352；必须用完整浏览器头
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const BVID_PATTERN = /^BV[0-9A-Za-z]{10}$/;
let cache = null;

export function cacheTTL(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return DEFAULT_CACHE_TTL_MS;
  return Math.min(MAX_CACHE_TTL_MS, Math.max(MIN_CACHE_TTL_MS, ms));
}

function text(value, max = 120) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

export function normalizeRanking(json) {
  if (json?.code !== 0 || !Array.isArray(json?.data?.list)) {
    throw new Error(`B站返回异常: code=${json?.code ?? "unknown"}`);
  }

  const seen = new Set();
  const items = [];
  for (const entry of json.data.list) {
    const bvid = typeof entry?.bvid === "string" ? entry.bvid.trim() : "";
    const title = text(entry?.title);
    // 只接受合法 bvid：链接由服务端按白名单格式拼接，绝不透传上游 URL
    if (!BVID_PATTERN.test(bvid) || !title || seen.has(bvid)) continue;
    seen.add(bvid);

    items.push({
      rank: items.length + 1,
      bvid,
      title,
      author: text(entry?.owner?.name, 60),
      category: text(entry?.tname, 20),
      duration: count(entry?.duration),
      view: count(entry?.stat?.view),
      like: count(entry?.stat?.like),
      pubdate: count(entry?.pubdate),
      link: `https://www.bilibili.com/video/${bvid}`,
    });
    if (items.length >= MAX_ITEMS) break;
  }

  if (!items.length) throw new Error("音乐榜为空");
  return {
    items,
    updatedAt: new Date().toISOString(),
    boardName: "音乐榜",
    sources: 1,
    feedNames: [SOURCE_NAME],
    total: json.data.list.length,
  };
}

export async function loadRanking({ ttl = DEFAULT_CACHE_TTL_MS, force = false } = {}) {
  if (cache) {
    const age = Date.now() - cache.at;
    // 无论自动还是手动，都保留 60 秒最小间隔，防止被刷触发风控
    if (age < FORCE_MIN_INTERVAL_MS) return cache.payload;
    if (!force && age < ttl) return cache.payload;
  }

  const response = await fetch(RANKING_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh;q=0.9",
      Referer: "https://www.bilibili.com/",
      Origin: "https://www.bilibili.com",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const payload = normalizeRanking(await response.json());
  cache = { at: Date.now(), payload };
  return payload;
}

async function handler(req, res) {
  const { index, force, refreshInterval } = req.query;
  await getPrivateWidgetOptions("bilibili_music", index);

  let payload;
  try {
    payload = await loadRanking({ ttl: cacheTTL(refreshInterval), force: force === "1" });
  } catch (error) {
    logger.error("B站音乐榜获取失败: %s", error?.message ?? String(error));
    payload = {
      items: [],
      updatedAt: null,
      boardName: "音乐榜",
      sources: 1,
      feedNames: [SOURCE_NAME],
      error: "音乐榜暂不可用",
    };
  }

  res.setHeader("Cache-Control", "private, no-store");
  return res.status(200).json(payload);
}

export default withAuth(handler);
