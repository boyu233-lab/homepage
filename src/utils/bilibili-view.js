// B站视频详情（分P / 选集）解析，供 /api/widgets/bilibili_pages 与
// /api/widgets/bilibili_audio 共用，保证「歌单里的 cid」与「实际播放的 cid」同源。
//
// 上游地址写死，只接受合法 bvid；上游返回的任何 URL 都不透传给前端。
const VIEW_BASE = "https://api.bilibili.com/x/web-interface/wbi/view";
const FETCH_TIMEOUT_MS = 10000;
const VIEW_TTL_MS = 24 * 60 * 60 * 1000; // 分P列表基本不变，缓存一天
const MAX_CACHE_ENTRIES = 120;
const MAX_PAGES = 1000;
const PART_MAX_LENGTH = 120;

export const BVID_PATTERN = /^BV[0-9A-Za-z]{10}$/;
export const REFERER = "https://www.bilibili.com/";
export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export function jsonHeaders() {
  return {
    "User-Agent": USER_AGENT,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    Referer: REFERER,
  };
}

/** 分P名可能带 HTML 标签 / 实体 / 控制字符，统一收敛成纯文本 */
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
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);
}

/**
 * wbi/view → 统一的分P结构。
 * 兼容只有顶层 cid、没有 pages 的响应（单P视频 / 精简上游），此时退化成一个分P。
 */
export function normalizeView(json, bvid) {
  if (json?.code !== 0 || !json?.data) {
    throw new Error(`view 返回异常: code=${json?.code ?? "unknown"}`);
  }
  const data = json.data;
  const pages = [];
  const raw = Array.isArray(data.pages) ? data.pages : [];
  for (let i = 0; i < Math.min(raw.length, MAX_PAGES); i += 1) {
    const entry = raw[i];
    const cid = Number(entry?.cid);
    if (!Number.isInteger(cid) || cid <= 0) continue;
    const pageNumber = Number(entry?.page);
    const duration = Number(entry?.duration);
    pages.push({
      page: Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : pages.length + 1,
      cid,
      part: cleanText(entry?.part, PART_MAX_LENGTH) || `P${pages.length + 1}`,
      duration: Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : 0,
    });
  }

  const fallbackCid = Number(data.cid);
  if (!pages.length && Number.isInteger(fallbackCid) && fallbackCid > 0) {
    const duration = Number(data.duration);
    pages.push({
      page: 1,
      cid: fallbackCid,
      part: cleanText(data.title, PART_MAX_LENGTH) || "P1",
      duration: Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : 0,
    });
  }
  if (!pages.length) throw new Error("view 没有可用分P");

  return {
    bvid,
    title: cleanText(data.title, PART_MAX_LENGTH),
    author: cleanText(data.owner?.name, 60),
    duration: Number(data.duration) || 0,
    pages,
  };
}

const viewCache = new Map(); // bvid -> { at, payload }

export async function loadView(bvid, { force = false } = {}) {
  if (!BVID_PATTERN.test(bvid)) throw new Error("invalid bvid");
  const hit = viewCache.get(bvid);
  if (!force && hit && Date.now() - hit.at < VIEW_TTL_MS) return hit.payload;

  const response = await fetch(`${VIEW_BASE}?bvid=${encodeURIComponent(bvid)}`, {
    headers: jsonHeaders(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`view HTTP ${response.status}`);
  const payload = normalizeView(await response.json(), bvid);

  viewCache.delete(bvid);
  viewCache.set(bvid, { at: Date.now(), payload });
  if (viewCache.size > MAX_CACHE_ENTRIES) {
    viewCache.delete(viewCache.keys().next().value);
  }
  return payload;
}

/** 只允许播放该视频真实存在的 cid，避免任意 cid 参数被滥用 */
export function cidInView(view, cid) {
  return Number.isInteger(cid) && cid > 0 && view.pages.some((entry) => entry.cid === cid);
}

export function pageLink(bvid, page) {
  return `https://www.bilibili.com/video/${bvid}?p=${page}`;
}
