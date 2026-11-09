import { withAuth } from "utils/auth";
import { getPrivateWidgetOptions } from "utils/config/widget-helpers";
import createLogger from "utils/logger";

const logger = createLogger("news");

// 百度热搜榜官方接口（服务端代理，浏览器不直连第三方，访客 IP 不外泄）。
// 裸请求即可 200，返回 data.cards[0]：topContent 置顶 + content 50 条 + updateTime。
const BOARD_URL = "https://top.baidu.com/api/board?platform=pc&tab=realtime";
const SOURCE_NAME = "百度热搜";
const CACHE_TTL_MS = 60 * 1000; // 榜单分钟级更新，缓存 1 分钟
const FETCH_TIMEOUT_MS = 8000;
const MAX_ITEMS = 50;
let cache = null;

// hotTag：0 无 / 1 新 / 2 沸 / 3 热；未知值不展示角标，避免把内部编码透给前端。
const HOT_TAGS = { 1: "新", 2: "沸", 3: "热" };

function safeLink(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function normalizeDate(value) {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) {
    const millis = seconds < 1e12 ? seconds * 1000 : seconds;
    const parsed = new Date(millis);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function normalizeBoard(json) {
  const card = json?.data?.cards?.[0];
  if (!card || !Array.isArray(card.content)) throw new Error("热搜榜数据结构异常");

  const updatedAt = normalizeDate(card.updateTime);
  const entries = [
    ...(Array.isArray(card.topContent) ? card.topContent.map((entry) => ({ ...entry, isTop: true })) : []),
    ...card.content,
  ];

  const seen = new Set();
  const items = [];
  for (const entry of entries) {
    const title = typeof entry?.word === "string" ? entry.word.trim() : "";
    const link = safeLink(entry?.url || entry?.rawUrl);
    if (!title || !link || seen.has(link)) continue;
    seen.add(link);

    const index = Number(entry.index);
    items.push({
      title,
      link,
      date: updatedAt,
      source: SOURCE_NAME,
      rank: entry.isTop ? 0 : Number.isFinite(index) ? index + 1 : items.length + 1,
      hotScore: String(entry.hotScore ?? ""),
      hotTag: HOT_TAGS[Number(entry.hotTag)] ?? "",
      desc: typeof entry.desc === "string" ? entry.desc.trim() : "",
      isTop: Boolean(entry.isTop),
    });
    if (items.length >= MAX_ITEMS) break;
  }

  if (!items.length) throw new Error("热搜榜为空");
  return {
    items,
    updatedAt,
    boardName: typeof card.text === "string" ? card.text : "热搜榜",
    sources: 1,
    feedNames: [SOURCE_NAME],
    total: card.content.length,
  };
}

async function loadBoard() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.payload;

  const response = await fetch(BOARD_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      "User-Agent": "homepage-news/1.1",
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const payload = normalizeBoard(await response.json());
  cache = { at: Date.now(), payload };
  return payload;
}

async function handler(req, res) {
  const { index } = req.query;
  await getPrivateWidgetOptions("news", index);

  let payload;
  try {
    payload = await loadBoard();
  } catch (error) {
    logger.error("百度热搜获取失败: %s", error.message);
    payload = {
      items: [],
      updatedAt: null,
      boardName: "热搜榜",
      sources: 1,
      feedNames: [SOURCE_NAME],
      error: "热搜暂不可用",
    };
  }

  // 公开内容，但仍禁止代理/CDN 缓存，避免登录态或个性化数据串味
  res.setHeader("Cache-Control", "private, no-store");
  return res.status(200).json(payload);
}

export default withAuth(handler);
