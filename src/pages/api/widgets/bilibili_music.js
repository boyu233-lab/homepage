import { withAuth } from "utils/auth";
import { getPrivateWidgetOptions } from "utils/config/widget-helpers";
import createLogger from "utils/logger";

const logger = createLogger("bilibili_music");

// B站音乐区排行榜（服务端代理，浏览器不直连 api.bilibili.com，访客 IP 不外泄）。
// rid=3 音乐区 / type=all，地址写死且不接受配置里的 URL，避免 SSRF。
const RANKING_URL = "https://api.bilibili.com/x/web-interface/ranking/v2?rid=3&type=all";
const SOURCE_NAME = "B站音乐榜";
const CACHE_TTL_MS = 5 * 60 * 1000; // 榜单小时级更新，缓存 5 分钟，避免触发风控
const FETCH_TIMEOUT_MS = 8000;
const MAX_ITEMS = 50;
const BVID_PATTERN = /^BV[0-9A-Za-z]{10}$/;
let cache = null;

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

async function loadRanking() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.payload;

  const response = await fetch(RANKING_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; homepage-bilibili/1.0)",
      Accept: "application/json",
      Referer: "https://www.bilibili.com/",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const payload = normalizeRanking(await response.json());
  cache = { at: Date.now(), payload };
  return payload;
}

async function handler(req, res) {
  const { index } = req.query;
  await getPrivateWidgetOptions("bilibili_music", index);

  let payload;
  try {
    payload = await loadRanking();
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
