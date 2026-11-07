import { withAuth } from "utils/auth";
import { getPrivateWidgetOptions } from "utils/config/widget-helpers";
import createLogger from "utils/logger";
import { parseFeed } from "widgets/feed/utils";

const logger = createLogger("news");

// 内置可选新闻源（中文 RSS，服务端代理拉取，浏览器不直连第三方，访客 IP 不外泄）。
// 只启用其中一部分：给容器加 HOMEPAGE_NEWS_SOURCES=baidu,ithome
// 可用 key：baidu / sina / ithome / sspai / sina-tech
const FEED_CATALOG = {
  baidu: { name: "百度新闻", url: "https://news.baidu.com/n?cmd=1&class=civilnews&tn=rss" },
  sina: { name: "新浪国内", url: "https://rss.sina.com.cn/news/china/focus15.xml" },
  ithome: { name: "IT之家", url: "https://www.ithome.com/rss/" },
  sspai: { name: "少数派", url: "https://sspai.com/feed" },
  "sina-tech": { name: "新浪科技", url: "https://rss.sina.com.cn/tech/rollnews.xml" },
};

// 默认启用三个；想换组合用 HOMEPAGE_NEWS_SOURCES，想完全自定义用 HOMEPAGE_NEWS_FEEDS。
const DEFAULT_FEED_KEYS = ["baidu", "sina", "ithome"];

const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const PER_FEED_LIMIT = 8; // 每个源各取几条再合并，避免单一源把列表刷满
const MAX_ITEMS = 30;
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

// 解析逗号分隔的源列表，支持 "名称=https://..." 与纯 URL 两种写法。
// URL 里的 = 与 & 不受影响：只有当第一个 = 后面确实是 http(s) 地址时才当作名称分隔符。
function parseFeedList(raw) {
  if (typeof raw !== "string" || !raw.trim()) return [];
  return raw
    .split(",")
    .map((entry, index) => {
      const value = entry.trim();
      if (!value) return null;
      const eq = value.indexOf("=");
      if (eq > 0 && /^https?:\/\//i.test(value.slice(eq + 1).trim())) {
        return safeFeed(value.slice(eq + 1).trim(), value.slice(0, eq).trim());
      }
      return safeFeed(value, `自定义源 ${index + 1}`);
    })
    .filter(Boolean);
}

function resolveFeeds(options) {
  // 1) 按 key 或中文名从内置目录里挑选（最省事，不用记 URL）
  const picked = (process.env.HOMEPAGE_NEWS_SOURCES || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .map((value) => {
      const byKey = FEED_CATALOG[value];
      if (byKey) return byKey;
      const byName = Object.values(FEED_CATALOG).find((feed) => feed.name.toLowerCase() === value);
      return byName || null;
    })
    .filter(Boolean);
  if (picked.length) return picked;

  // 2) 完全自定义源（环境变量优先，其次是 widgets.yaml 里私有的 news.url）
  const fromEnv = parseFeedList(process.env.HOMEPAGE_NEWS_FEEDS || "");
  if (fromEnv.length) return fromEnv;

  const fromConfig = parseFeedList(options?.url);
  if (fromConfig.length) return fromConfig;

  // 3) 默认三个
  return DEFAULT_FEED_KEYS.map((key) => FEED_CATALOG[key]);
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

  const payload = {
    items,
    updatedAt: new Date().toISOString(),
    sources: feeds.length,
    feedNames: feeds.map((feed) => feed.name),
  };
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
    payload = { items: [], updatedAt: null, sources: feeds.length, feedNames: feeds.map((f) => f.name) };
  }

  // 新闻是公开内容，但仍禁止代理/CDN 缓存，避免登录态或个性化数据串味
  res.setHeader("Cache-Control", "private, no-store");
  return res.status(200).json(payload);
}

export default withAuth(handler);
