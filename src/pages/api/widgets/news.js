import { xml2js } from "xml-js";

import { withAuth } from "utils/auth";
import { getPrivateWidgetOptions } from "utils/config/widget-helpers";
import createLogger from "utils/logger";

const logger = createLogger("news");

// 多源热榜 / 资讯聚合：所有上游地址写死在本表里，请求只接受白名单 key，
// 绝不从 query 里取 URL，避免 SSRF。浏览器只访问本站 API，访客 IP 不外泄。
const DEFAULT_SOURCE = "baidu";
const FETCH_TIMEOUT_MS = 8000;
const MAX_ITEMS = 50;
// 部分平台（B站热搜等）会对简写 / 自定义 UA 返回风控码，统一用完整浏览器头
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const HOT_TAGS = { 1: "新", 2: "沸", 3: "热" };
const TOUTIAO_LABELS = { hot: "热", new: "新" };

function text(value, max = 120) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

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

function rssDate(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function xmlText(node) {
  if (!node) return "";
  if (typeof node === "string") return node;
  return node._cdata ?? node._text ?? "";
}

function stripHtml(value) {
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTag(value) {
  const tag = text(value, 4);
  if (tag === "新" || tag === "沸" || tag === "热") return tag;
  if (tag === "爆") return "沸";
  return "";
}

// 统一条目结构：热榜有 rank / hotScore / hotTag，资讯有 date；前端据此决定右侧显示什么。
function buildItems(entries, mapper, source) {
  const seen = new Set();
  const items = [];
  for (const [index, entry] of entries.entries()) {
    const mapped = mapper(entry, index);
    if (!mapped || !mapped.title || !mapped.link || seen.has(mapped.link)) continue;
    seen.add(mapped.link);
    items.push({
      title: mapped.title,
      link: mapped.link,
      desc: mapped.desc ?? "",
      date: mapped.date ?? new Date().toISOString(),
      source,
      rank: mapped.rank ?? items.length + 1,
      hotScore: mapped.hotScore == null ? "" : String(mapped.hotScore),
      hotTag: mapped.hotTag ?? "",
      isTop: Boolean(mapped.isTop),
    });
    if (items.length >= MAX_ITEMS) break;
  }
  if (!items.length) throw new Error("榜单为空");
  return items;
}

function parseBaidu(json) {
  const card = json?.data?.cards?.[0];
  if (!card || !Array.isArray(card.content)) throw new Error("百度热搜数据结构异常");
  const updatedAt = normalizeDate(card.updateTime);
  const entries = [
    ...(Array.isArray(card.topContent) ? card.topContent.map((entry) => ({ ...entry, isTop: true })) : []),
    ...card.content,
  ];
  const items = buildItems(
    entries,
    (entry) => ({
      title: text(entry.word),
      link: safeLink(entry.url || entry.rawUrl),
      rank: entry.isTop ? 0 : Number(entry.index) + 1,
      hotScore: entry.hotScore,
      hotTag: HOT_TAGS[Number(entry.hotTag)] ?? "",
      desc: text(entry.desc, 200),
      date: updatedAt,
      isTop: entry.isTop,
    }),
    "百度热搜",
  );
  return { items, updatedAt, boardName: text(card.text) || "热搜榜", total: card.content.length };
}

function parseWeibo(json) {
  const list = json?.data?.realtime;
  if (!Array.isArray(list)) throw new Error("微博热搜数据结构异常");
  const updatedAt = new Date().toISOString();
  const items = buildItems(
    list,
    (entry, index) => {
      if (entry?.is_ad || entry?.ad_type) return null;
      const word = text(entry.word);
      if (!word) return null;
      const query = text(entry.word_scheme) || word;
      return {
        title: word,
        link: `https://s.weibo.com/weibo?q=${encodeURIComponent(query)}`,
        rank: Number(entry.realpos) || index + 1,
        hotScore: entry.num,
        hotTag: normalizeTag(entry.label_name || entry.small_icon_desc),
        desc: text(entry.note, 200),
        date: updatedAt,
      };
    },
    "微博热搜",
  );
  return { items, updatedAt, boardName: "微博热搜榜", total: list.length };
}

function parseZhihu(json) {
  const list = json?.data;
  if (!Array.isArray(list)) throw new Error("知乎热榜数据结构异常");
  const updatedAt = new Date().toISOString();
  const items = buildItems(
    list,
    (entry, index) => {
      const target = entry?.target;
      const title = text(target?.title);
      if (!title) return null;
      // 上游 id 是超过 2^53 的数字，JSON 解析会丢精度；从 URL 字符串里取完整 id
      const targetUrl = text(target?.url, 200);
      const idMatch = targetUrl.match(/\/questions?\/(\d+)/);
      const link = idMatch ? `https://www.zhihu.com/question/${idMatch[1]}` : safeLink(targetUrl);
      const heat = text(entry?.detail_text);
      const match = heat.match(/([\d.]+)\s*万/);
      return {
        title,
        link,
        rank: index + 1,
        hotScore: match ? Math.round(Number(match[1]) * 10000) : "",
        desc: text(target?.excerpt, 200),
        date: normalizeDate(target?.created),
      };
    },
    "知乎热榜",
  );
  return { items, updatedAt, boardName: "知乎热榜", total: list.length };
}

function parseToutiao(json) {
  const list = json?.data;
  if (!Array.isArray(list)) throw new Error("头条热榜数据结构异常");
  const updatedAt = new Date().toISOString();
  const items = buildItems(
    list,
    (entry, index) => {
      const id = String(entry?.ClusterIdStr ?? "");
      const link = /^\d+$/.test(id)
        ? `https://www.toutiao.com/trending/${id}/`
        : safeLink(entry?.Url);
      return {
        title: text(entry.Title),
        link,
        rank: index + 1,
        hotScore: entry.HotValue,
        hotTag: TOUTIAO_LABELS[entry.Label] ?? "",
        desc: text(entry.QueryWord, 200),
        date: updatedAt,
      };
    },
    "头条热榜",
  );
  return { items, updatedAt, boardName: "头条热榜", total: list.length };
}

function parseDouyin(json) {
  const list = json?.word_list;
  if (!Array.isArray(list)) throw new Error("抖音热榜数据结构异常");
  const updatedAt = new Date().toISOString();
  const items = buildItems(
    list,
    (entry, index) => {
      const word = text(entry.word);
      return {
        title: word,
        link: `https://www.douyin.com/search/${encodeURIComponent(word)}`,
        rank: index + 1,
        hotScore: entry.hot_value,
        desc: "",
        date: updatedAt,
      };
    },
    "抖音热榜",
  );
  return { items, updatedAt, boardName: "抖音热榜", total: list.length };
}

function parseBilibili(json) {
  const list = json?.data?.trending?.list;
  if (!Array.isArray(list)) throw new Error("B站热搜数据结构异常");
  const updatedAt = new Date().toISOString();
  const items = buildItems(
    list,
    (entry, index) => {
      const keyword = text(entry.keyword);
      return {
        title: text(entry.show_name) || keyword,
        link: `https://search.bilibili.com/all?keyword=${encodeURIComponent(keyword)}`,
        rank: index + 1,
        hotScore: entry.heat_score,
        desc: "",
        date: updatedAt,
      };
    },
    "B站热搜",
  );
  return { items, updatedAt, boardName: "B站热搜", total: list.length };
}

function parseRss(xml, label) {
  const doc = xml2js(xml, { compact: true, ignoreDeclaration: true, ignoreComment: true });
  const channel = doc?.rss?.channel;
  if (!channel) throw new Error("RSS 结构异常");
  const raw = channel.item;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const updatedAt = new Date().toISOString();
  const items = buildItems(
    list,
    (entry, index) => ({
      title: stripHtml(xmlText(entry.title)),
      link: safeLink(xmlText(entry.link)),
      rank: index + 1,
      hotScore: "",
      desc: stripHtml(xmlText(entry.description)).slice(0, 200),
      date: rssDate(xmlText(entry.pubDate)),
    }),
    label,
  );
  return {
    items,
    updatedAt,
    boardName: stripHtml(xmlText(channel.title)) || label,
    total: list.length,
  };
}

const SOURCES = {
  baidu: {
    label: "百度热搜",
    kind: "board",
    ttl: 60 * 1000,
    url: "https://top.baidu.com/api/board?platform=pc&tab=realtime",
    referer: "https://top.baidu.com/",
    parse: parseBaidu,
  },
  weibo: {
    label: "微博热搜",
    kind: "board",
    ttl: 60 * 1000,
    url: "https://weibo.com/ajax/side/hotSearch",
    referer: "https://weibo.com/",
    parse: parseWeibo,
  },
  zhihu: {
    label: "知乎热榜",
    kind: "board",
    ttl: 60 * 1000,
    url: "https://api.zhihu.com/topstory/hot-list?limit=50",
    referer: "https://www.zhihu.com/",
    parse: parseZhihu,
  },
  toutiao: {
    label: "头条热榜",
    kind: "board",
    ttl: 60 * 1000,
    url: "https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc",
    referer: "https://www.toutiao.com/",
    parse: parseToutiao,
  },
  douyin: {
    label: "抖音热榜",
    kind: "board",
    ttl: 60 * 1000,
    url: "https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/",
    referer: "https://www.douyin.com/",
    parse: parseDouyin,
  },
  bilibili: {
    label: "B站热搜",
    kind: "board",
    ttl: 60 * 1000,
    url: "https://api.bilibili.com/x/web-interface/search/square?limit=10",
    referer: "https://www.bilibili.com/",
    parse: parseBilibili,
  },
  bing: {
    label: "Bing 资讯",
    kind: "news",
    ttl: 5 * 60 * 1000,
    url: "https://www.bing.com/search?q=%E4%BB%8A%E6%97%A5%E7%83%AD%E7%82%B9%E6%96%B0%E9%97%BB&format=rss",
    referer: "https://www.bing.com/",
    parse: (raw) => parseRss(raw, "Bing 资讯"),
  },
  ithome: {
    label: "IT之家",
    kind: "news",
    ttl: 5 * 60 * 1000,
    url: "https://www.ithome.com/rss/",
    referer: "https://www.ithome.com/",
    parse: (raw) => parseRss(raw, "IT之家"),
  },
  sspai: {
    label: "少数派",
    kind: "news",
    ttl: 5 * 60 * 1000,
    url: "https://sspai.com/feed",
    referer: "https://sspai.com/",
    parse: (raw) => parseRss(raw, "少数派"),
  },
};

const AVAILABLE_SOURCES = Object.entries(SOURCES).map(([key, source]) => ({
  key,
  label: source.label,
  kind: source.kind,
}));

export { SOURCES, AVAILABLE_SOURCES, parseRss, parseBaidu, parseWeibo, parseZhihu, parseToutiao, parseDouyin, parseBilibili };

const caches = new Map();

export function parseSource(key, raw) {
  const source = SOURCES[key];
  if (!source) throw new Error("未知来源");
  return source.parse(raw);
}

async function loadSource(key) {
  const source = SOURCES[key];
  const cached = caches.get(key);
  if (cached && Date.now() - cached.at < source.ttl) return cached.payload;

  const response = await fetch(source.url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      "User-Agent": USER_AGENT,
      Accept: source.kind === "news" ? "application/rss+xml, application/xml, text/xml, */*" : "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh;q=0.9",
      Referer: source.referer,
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const raw = source.kind === "news" ? await response.text() : await response.json();
  const parsed = parseSource(key, raw);
  const payload = {
    items: parsed.items,
    updatedAt: parsed.updatedAt,
    boardName: parsed.boardName,
    sources: 1,
    feedNames: [source.label],
    total: parsed.total,
    source: key,
    sourceLabel: source.label,
    kind: source.kind,
    availableSources: AVAILABLE_SOURCES,
  };
  caches.set(key, { at: Date.now(), payload });
  return payload;
}

async function handler(req, res) {
  const { index, source } = req.query;
  const key = Object.prototype.hasOwnProperty.call(SOURCES, source) ? source : DEFAULT_SOURCE;
  await getPrivateWidgetOptions("news", index);

  let payload;
  try {
    payload = await loadSource(key);
  } catch (error) {
    logger.error("%s 获取失败: %s", SOURCES[key].label, error?.message ?? String(error));
    payload = {
      items: [],
      updatedAt: null,
      boardName: SOURCES[key].label,
      sources: 1,
      feedNames: [SOURCES[key].label],
      source: key,
      sourceLabel: SOURCES[key].label,
      kind: SOURCES[key].kind,
      availableSources: AVAILABLE_SOURCES,
      error: `${SOURCES[key].label}暂不可用`,
    };
  }

  res.setHeader("Cache-Control", "private, no-store");
  return res.status(200).json(payload);
}

export default withAuth(handler);
