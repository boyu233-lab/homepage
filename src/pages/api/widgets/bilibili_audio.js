import { Readable } from "node:stream";

import { withAuth } from "utils/auth";
import { BVID_PATTERN, cidInView, jsonHeaders, loadView, REFERER, USER_AGENT } from "utils/bilibili-view";
import createLogger from "utils/logger";
import { withPublicWidgetGuard } from "utils/rate-limit";

const logger = createLogger("bilibili_audio");

// B站纯音频播放代理（v1.0.3）：浏览器 <audio> 不能直连 B站 CDN——CDN 强制校验
// Referer 必须是 https://www.bilibili.com/，第三方 / 空 Referer 一律 403。
// 因此这里由服务端带正确 Referer 取流并转发给同源浏览器，实现「只播放声音、不显示画面」。
//
// v1.0.5：支持 cid 参数播放「视频选集」里的指定分P；cid 必须存在于该 bvid 的
// pages 中（由 wbi/view 返回），不传 cid 时兼容旧行为、播放第 1 个分P。
// 链路：bvid → view 取全部分P → 校验 cid → playurl(fnval=16) 取 DASH 音轨 → CDN（Range 转发）。
// 上游地址写死、CDN 域名白名单校验，避免上游返回任意 URL 造成 SSRF。
const PLAYURL_BASE = "https://api.bilibili.com/x/player/playurl";
const CDN_HOST_SUFFIXES = [
  "bilivideo.cn",
  "bilivideo.com",
  "bilivideo.net",
  "hdslb.com",
  "akamaized.net",
  "mountaintoys.cn",
];
const URL_TTL_MS = 20 * 60 * 1000; // 音频地址带时效签名，20 分钟后重新获取
const FETCH_TIMEOUT_MS = 10000;
const MAX_CACHE_ENTRIES = 200;

const urlCache = new Map(); // "bvid:cid" -> { at, urls }

function trimCache(map) {
  if (map.size <= MAX_CACHE_ENTRIES) return;
  const oldest = map.keys().next().value;
  map.delete(oldest);
}

/** 只接受 B站自家 CDN 的 HTTPS 地址，防止上游返回恶意 URL 导致 SSRF */
export function safeCdnUrl(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (!CDN_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** 取最高码率音轨，并把标准 443 端口的备用地址排在前面（部分网络会拦 8082/4483） */
export function pickAudioUrls(data) {
  const audios = Array.isArray(data?.dash?.audio) ? data.dash.audio : [];
  if (!audios.length) return [];
  const best = audios
    .slice()
    .sort((a, b) => (Number(b?.bandwidth) || 0) - (Number(a?.bandwidth) || 0))[0];
  const candidates = [best?.baseUrl, ...(Array.isArray(best?.backupUrl) ? best.backupUrl : [])];
  const urls = [];
  for (const candidate of candidates) {
    const safe = safeCdnUrl(candidate);
    if (safe && !urls.includes(safe)) urls.push(safe);
  }
  return urls.sort((a, b) => Number(Boolean(new URL(a).port)) - Number(Boolean(new URL(b).port)));
}

/** 取第 1 个分P的 cid（兼容 v1.0.4 及以前的「只播第一首」行为） */
export async function resolveCid(bvid) {
  const view = await loadView(bvid);
  return view.pages[0].cid;
}

/** cid 参数必须是正整数字符串；不传时返回 undefined */
export function parseCid(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || !/^\d{1,20}$/.test(raw.trim())) return null;
  const cid = Number(raw.trim());
  return Number.isSafeInteger(cid) && cid > 0 ? cid : null;
}

export async function resolveAudioUrls(bvid, cid) {
  const key = `${bvid}:${cid}`;
  const hit = urlCache.get(key);
  if (hit && Date.now() - hit.at < URL_TTL_MS) return hit.urls;

  const params = new URLSearchParams({
    bvid,
    cid: String(cid),
    fnval: "16",
    fnver: "0",
    fourk: "1",
  });
  const response = await fetch(`${PLAYURL_BASE}?${params}`, {
    headers: jsonHeaders(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`playurl HTTP ${response.status}`);
  const json = await response.json();
  const urls = pickAudioUrls(json?.data);
  if (json?.code !== 0 || !urls.length) {
    throw new Error(`playurl 无可用音轨: code=${json?.code ?? "unknown"}`);
  }
  urlCache.set(key, { at: Date.now(), urls });
  trimCache(urlCache);
  return urls;
}

async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const bvid = typeof req.query?.bvid === "string" ? req.query.bvid.trim() : "";
  if (!BVID_PATTERN.test(bvid)) return res.status(400).json({ error: "invalid bvid" });
  const requestedCid = parseCid(req.query?.cid);
  if (requestedCid === null) return res.status(400).json({ error: "invalid cid" });

  let urls;
  try {
    const view = await loadView(bvid);
    // 不传 cid 时播放第 1 个分P；传了则必须属于该视频的选集，防止任意 cid 被拿来取流
    const cid = requestedCid ?? view.pages[0].cid;
    if (!cidInView(view, cid)) return res.status(400).json({ error: "invalid cid" });
    urls = await resolveAudioUrls(bvid, cid);
  } catch (error) {
    logger.error("B站音轨地址获取失败 (%s): %s", bvid, error?.message ?? String(error));
    return res.status(502).json({ error: "音频地址获取失败" });
  }

  const range = typeof req.headers?.range === "string" ? req.headers.range : undefined;
  let upstream = null;
  for (const url of urls) {
    try {
      const candidate = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Referer: REFERER,
          ...(range ? { Range: range } : {}),
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!candidate.ok || !candidate.body) {
        candidate.body?.cancel();
        continue;
      }
      upstream = candidate;
      break;
    } catch (error) {
      logger.error("B站音频 CDN 连接失败: %s", error?.message ?? String(error));
    }
  }
  if (!upstream) return res.status(502).json({ error: "音频流暂不可用" });

  res.statusCode = upstream.status;
  // 上游可能返回 application/octet-stream / video/mp4；统一声明为音频，浏览器仍按 fMP4 解码
  res.setHeader("Content-Type", "audio/mp4");
  for (const header of ["content-range", "accept-ranges", "content-length", "etag", "last-modified"]) {
    const value = upstream.headers.get(header);
    if (value) res.setHeader(header, value);
  }
  res.setHeader("Cache-Control", "private, no-store");

  if (req.method === "HEAD") {
    upstream.body.cancel();
    return res.end();
  }

  const stream = Readable.fromWeb(upstream.body);
  await new Promise((resolve) => {
    stream.on("end", resolve);
    stream.on("error", (error) => {
      logger.error("B站音频转发中断: %s", error?.message ?? String(error));
      resolve();
    });
    res.on("close", () => {
      stream.destroy();
      resolve();
    });
    stream.pipe(res);
  });
  return undefined;
}

export default withAuth(withPublicWidgetGuard(handler, "audio"));
