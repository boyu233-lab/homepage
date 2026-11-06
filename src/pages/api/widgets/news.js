import { withAuth } from "utils/auth";
import { getPrivateWidgetOptions } from "utils/config/widget-helpers";
import createLogger from "utils/logger";
import { parseFeed } from "widgets/feed/utils";

const logger = createLogger("news");

// 默认新闻源：中文 RSS，服务端代理拉取，浏览器不直连第三方，访客 IP 不外泄。
// 想完全自托管或换源：给容器加 HOMEPAGE_NEWS_FEEDS=https://your/rss.xml,... ，
// 也可以在 widgets.yaml 的 news 项里写 url: <单个 RSS 地址>（该字段不会下发到前端）。
const DEFAULT_FEEDS = [
  { name: "百度新闻", url: "https://news.baidu.com/n?cmd=1&class=civilnews&tn=rss" },
  { name: "新浪国内", url: "https://rss.sina.com.cn/news/china/focus15.xml" },
  { name: "IT之家", url: "https://www.ithome.com/rss/" },
];

const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const PER_FEED_LIMIT = 8; // 每个源各取几条再合并，避免单一源把列表刷满
const MAX_ITEMS = 20;
const cache = new Map();

function safeFeed(url, name) {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    return { name: name || parsed.hostname, url: parsed.href };
  } catch {
    return null;
  }
}

function resolveFeeds(options) {
  const fromEnv = (process.env.HOMEPAGE_NEWS_FEEDS || "")
    .split(",")
    .map((value, index) => safeFeed(value, `自定义源 ${index + 1}`))
    .filter(Boolean);
  if (fromEnv.length) return fromEnv;

  const single = safeFeed(options?.url, "自定义源");
  if (single) return [single];

  return DEFAULT_FEEDS;
}

async function loadFeed(feed) {
  const response = await fetch(feed.url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      "User-Agent": "homepage-news/1.0",
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const xml = await response.text();
  return parseFeed(xml)
    .map((item) => ({ title: item.title, link: item.link, date: item.date, source: feed.name }))
    .filter((item) => item.title && item.link)
    .slice(0, PER_FEED_LIMIT);
}

async function collectNews(feeds) {
  const key = feeds.map((feed) => feed.url).join("|");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.payload;

  const results = await Promise.allSettled(feeds.map((feed) => loadFeed(feed)));
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      logger.error("新闻源 %s 获取失败: %s", feeds[index].name, result.reason?.message);
    }
  });

  const seen = new Set();
  const items = results
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .filter((item) => {
      if (seen.has(item.link)) return false;
      seen.add(item.link);
      return true;
    })
    .sort((a, b) => (b.date ? Date.parse(b.date) : 0) - (a.date ? Date.parse(a.date) : 0))
    .slice(0, MAX_ITEMS);

  const payload = { items, updatedAt: new Date().toISOString(), sources: feeds.length };
  cache.set(key, { at: Date.now(), payload });
  return payload;
}

async function handler(req, res) {
  const { index } = req.query;
  const options = (await getPrivateWidgetOptions("news", index)) ?? {};
  const feeds = resolveFeeds(options);

  let payload;
  try {
    payload = await collectNews(feeds);
  } catch (error) {
    logger.error("新闻聚合失败: %s", error.message);
    payload = { items: [], updatedAt: null, sources: 0 };
  }

  // 新闻是公开内容，但仍禁止代理/CDN 缓存，避免登录态或个性化数据串味
  res.setHeader("Cache-Control", "private, no-store");
  return res.status(200).json(payload);
}

export default withAuth(handler);
