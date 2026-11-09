import classNames from "classnames";
import { useSyncExternalStore, useState } from "react";
import {
  FiChevronLeft,
  FiChevronRight,
  FiExternalLink,
  FiMusic,
  FiRefreshCw,
  FiSearch,
  FiX,
} from "react-icons/fi";
import useSWR from "swr";

import Container from "../widget/container";
import Raw from "../widget/raw";

// 历史命名：v1.0.2 这里是音乐区排行榜，v1.0.3 起改为「搜索 → 手动选播 → 纯音频播放」。
// 组件路径 / widget key 不变，避免已有部署只换镜像时出现 Missing bilibili_music。
// 音频走同源服务端代理（B站 CDN 强制校验 Referer），页面里只有 <audio>，不显示任何视频画面。
const AUDIO_API = "/api/widgets/bilibili_audio";
const DEFAULT_REFRESH_MS = 10 * 60 * 1000; // 同一关键词搜索结果缓存 10 分钟
const MAX_QUERY_LENGTH = 60;
const MAX_PAGE = 10;
const RECENT_KEY = "homepage.bilibiliRecent";
const VOLUME_KEY = "homepage.bilibiliVolume";
const MUTED_KEY = "homepage.bilibiliMuted";
const EMPTY_RECENT = [];

export function formatCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "0";
  if (number >= 100000000) return `${(number / 100000000).toFixed(1)}亿`;
  if (number >= 10000) return `${(number / 10000).toFixed(1)}万`;
  return String(number);
}

export function formatDuration(value) {
  const seconds = Math.floor(Number(value));
  if (!Number.isFinite(seconds) || seconds <= 0) return "--:--";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

function formatUpdateTime(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}`;
}

// 最近搜索词存浏览器本地：用外部存储读取，避免 SSR hydration 不一致，
// 也不需要在 effect 里同步 setState（react-hooks/set-state-in-effect）。
const listeners = new Set();
let cachedRaw;
let cachedRecent = EMPTY_RECENT;

function subscribe(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot() {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (raw === cachedRaw) return cachedRecent;
    cachedRaw = raw;
    const parsed = JSON.parse(raw || "[]");
    cachedRecent = Array.isArray(parsed)
      ? parsed.filter((entry) => typeof entry === "string" && entry.trim()).slice(0, 6)
      : EMPTY_RECENT;
  } catch {
    cachedRaw = undefined;
    cachedRecent = EMPTY_RECENT;
  }
  return cachedRecent;
}

function getServerSnapshot() {
  return EMPTY_RECENT;
}

function saveRecent(query) {
  try {
    const next = [query, ...getSnapshot().filter((entry) => entry !== query)].slice(0, 6);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    cachedRaw = undefined;
    listeners.forEach((callback) => callback());
  } catch {
    // 隐私模式下 localStorage 不可用，搜索本身不受影响
  }
}

function audioSrc(bvid) {
  return `${AUDIO_API}?bvid=${encodeURIComponent(bvid)}`;
}

/* ============ 音量锁定 ============
   原生 <audio> 每首歌都会重新挂载(key=bvid),音量默认是 100%。
   用户手动调整一次后把音量/静音状态记到 localStorage,之后每次挂载与开始播放
   都自动应用该值 —— 调一次即锁定,切歌、自动下一首、刷新页面都不会回弹。 */
function readAudioPrefs() {
  try {
    const raw = window.localStorage.getItem(VOLUME_KEY);
    const parsed = raw === null ? 1 : Number(raw);
    return {
      volume: Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 1,
      muted: window.localStorage.getItem(MUTED_KEY) === "1",
    };
  } catch {
    return { volume: 1, muted: false };
  }
}

function saveAudioPrefs(element) {
  try {
    window.localStorage.setItem(VOLUME_KEY, String(element.volume));
    window.localStorage.setItem(MUTED_KEY, element.muted ? "1" : "0");
  } catch {
    // 隐私模式下不记忆，本次会话内仍可正常调节
  }
}

function lockAudioVolume(element) {
  if (!element) return;
  const prefs = readAudioPrefs();
  element.volume = prefs.volume;
  element.muted = prefs.muted;
}

export default function BilibiliMusic({ options }) {
  const {
    index,
    label = "B站搜索",
    limit = 10,
    refreshInterval = DEFAULT_REFRESH_MS,
    target = "_blank",
  } = options;

  const refreshMs = Math.max(60000, Number(refreshInterval) || DEFAULT_REFRESH_MS);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [playing, setPlaying] = useState(null);
  const [audioError, setAudioError] = useState(false);
  const recent = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // 未搜索时 key 为 null：SWR 不会请求上游，右侧保持干净的搜索起始态
  const key = query
    ? `/api/widgets/bilibili_music?${new URLSearchParams({
        index: String(index ?? 0),
        q: query,
        page: String(page),
        refreshInterval: String(refreshMs),
      })}`
    : null;

  const { data, error, isValidating, mutate } = useSWR(key, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  const maxItems = Math.min(20, Math.max(1, Number(limit) || 10));
  const items = query && Array.isArray(data?.items) ? data.items : [];
  const visible = items.slice(0, maxItems);
  const currentIndex = visible.findIndex((item) => item.bvid === playing);
  const current = currentIndex >= 0 ? visible[currentIndex] : null;

  const runSearch = (text) => {
    const cleaned = String(text ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, MAX_QUERY_LENGTH);
    if (!cleaned) return;
    setDraft(cleaned);
    setQuery(cleaned);
    setPage(1);
    setPlaying(null);
    setAudioError(false);
    saveRecent(cleaned);
  };

  const submit = (event) => {
    event.preventDefault();
    runSearch(draft);
  };

  const play = (bvid) => {
    setAudioError(false);
    setPlaying(bvid);
  };

  const shift = (delta) => {
    if (currentIndex < 0 || !visible.length) return;
    const next = (currentIndex + delta + visible.length) % visible.length;
    play(visible[next].bvid);
  };

  const changePage = (delta) => {
    setPlaying(null);
    setAudioError(false);
    setPage((currentPage) => Math.min(MAX_PAGE, Math.max(1, currentPage + delta)));
  };

  // 手动刷新带 force=1：跳过服务端 10 分钟缓存，立即重拉上游
  const refresh = () => {
    if (!key) return;
    mutate(fetch(`${key}&force=1`).then((response) => response.json()), { revalidate: false });
  };

  let emptyText = "";
  if (!query) emptyText = "输入关键词搜索 B站视频，点击结果即可在此播放";
  else if (error || data?.error) emptyText = "搜索暂不可用，稍后重试";
  else if (isValidating && !visible.length) emptyText = "正在搜索 B站视频…";
  else if (!visible.length) emptyText = "没有找到相关视频，换个关键词试试";

  return (
    <Container options={options} additionalClassNames="information-widget-bilibili_music">
      <Raw>
        <div className="bili-widget w-full">
          <div className="bili-toolbar">
            <FiSearch className="bili-toolbar-icon w-4 h-4" aria-hidden="true" />
            <span className="bili-label">{label}</span>
            {query && data?.updatedAt && (
              <span className="bili-item-meta">
                第 {page} 页 · 更新于 {formatUpdateTime(data.updatedAt)}
              </span>
            )}
            <button
              type="button"
              onClick={refresh}
              disabled={!query}
              title="重新搜索"
              aria-label="重新搜索"
              className="bili-refresh"
            >
              <FiRefreshCw className={classNames("w-3.5 h-3.5", isValidating && "animate-spin")} />
            </button>
          </div>

          <form className="bili-search-form" onSubmit={submit} role="search">
            <input
              className="bili-search-input"
              type="search"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="搜索 B站视频 / 音乐 / UP主…"
              aria-label="搜索关键词"
              maxLength={MAX_QUERY_LENGTH}
            />
            <button type="submit" className="bili-search-btn" aria-label="搜索 B站视频" title="搜索">
              <FiSearch className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </form>

          {!query && recent.length > 0 && (
            <div className="bili-recent">
              <span className="bili-recent-label">最近搜索</span>
              {recent.map((entry) => (
                <button key={entry} type="button" onClick={() => runSearch(entry)} title={`搜索 ${entry}`}>
                  {entry}
                </button>
              ))}
            </div>
          )}

          {!query && (
            <div className="bili-suggest">
              <span>试试：</span>
              {["周杰伦", "纯音乐", "白噪音", "Lo-Fi"].map((entry) => (
                <button key={entry} type="button" onClick={() => runSearch(entry)} title={`搜索 ${entry}`}>
                  {entry}
                </button>
              ))}
            </div>
          )}

          {current && (
            <div className="bili-player bili-audio-player">
              <div className="bili-player-bar">
                <button
                  type="button"
                  className="bili-back"
                  onClick={() => {
                    setPlaying(null);
                    setAudioError(false);
                  }}
                  aria-label="停止播放"
                  title="停止播放"
                >
                  <FiX className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>停止</span>
                </button>
                <span className="bili-now-title" title={current.title}>
                  {current.title}
                </span>
                <a
                  href={current.link}
                  target={target}
                  rel="noreferrer"
                  className="bili-open"
                  aria-label="在 B站打开当前视频"
                  title="在 B站打开当前视频"
                >
                  <FiExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                </a>
              </div>

              {/* 纯音频：没有 iframe / 封面 / 视频画面，只有同源代理出来的音轨 */}
              <div className="bili-audio-body">
                <span className="bili-audio-art" aria-hidden="true">
                  <FiMusic className="w-6 h-6" />
                </span>
                <span className="bili-audio-info">
                  <span className="bili-audio-title">{current.title}</span>
                  <span className="bili-item-meta">
                    {current.author} · {formatDuration(current.duration)} · 仅音频播放
                  </span>
                </span>
              </div>

              <audio
                key={current.bvid}
                ref={lockAudioVolume}
                className="bili-audio-el"
                src={audioSrc(current.bvid)}
                controls
                autoPlay
                preload="metadata"
                onPlay={(event) => lockAudioVolume(event.currentTarget)}
                onVolumeChange={(event) => saveAudioPrefs(event.currentTarget)}
                onEnded={() => shift(1)}
                onError={() => setAudioError(true)}
              >
                <track kind="captions" />
              </audio>

              {audioError && (
                <div className="bili-audio-error">音频加载失败：该视频可能没有音轨，或 B站暂时拒绝了请求</div>
              )}

              <div className="bili-player-controls">
                <button type="button" onClick={() => shift(-1)} aria-label="上一个" title="上一个">
                  <FiChevronLeft className="w-4 h-4" aria-hidden="true" />
                </button>
                <span className="bili-item-meta">
                  {currentIndex + 1} / {visible.length} · {current.author}
                </span>
                <button type="button" onClick={() => shift(1)} aria-label="下一个" title="下一个">
                  <FiChevronRight className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          )}

          {/* 歌单常驻：点选播放后仍完整显示，当前曲目高亮，可直接点其它条目切歌 */}
          <ul className={classNames("bili-list", current && "bili-list-scrollable")}>
            {emptyText && (
              <li className={classNames("bili-empty", !query && "bili-empty-start")}>{emptyText}</li>
            )}
            {visible.map((item) => (
              <li
                key={item.bvid}
                className={classNames("bili-list-item", item.bvid === playing && "bili-list-item-playing")}
              >
                <button
                  type="button"
                  className="bili-play-btn"
                  onClick={() => play(item.bvid)}
                  aria-label={`播放 ${item.title}`}
                  aria-current={item.bvid === playing ? "true" : undefined}
                  title={`${item.title} · ${item.author} · ${formatCount(item.view)} 播放 · ${formatDuration(item.duration)}`}
                >
                  <span className="bili-rank">{item.rank}</span>
                  <span className="bili-item-title">{item.title}</span>
                  <span className="bili-item-meta">
                    {formatCount(item.view)} · {formatDuration(item.duration)}
                  </span>
                </button>
                <a
                  href={item.link}
                  target={target}
                  rel="noreferrer"
                  className="bili-open"
                  aria-label={`在 B站打开 ${item.title}`}
                  title="在 B站打开"
                >
                  <FiExternalLink className="w-3 h-3" aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>

          {query && visible.length > 0 && (
            <div className="bili-pager">
              <button
                type="button"
                onClick={() => changePage(-1)}
                disabled={page <= 1}
                aria-label="上一页"
              >
                <FiChevronLeft className="w-3 h-3" aria-hidden="true" /> 上一页
              </button>
              <span className="bili-item-meta">第 {page} 页</span>
              <button
                type="button"
                onClick={() => changePage(1)}
                disabled={page >= MAX_PAGE}
                aria-label="下一页"
              >
                下一页 <FiChevronRight className="w-3 h-3" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </Raw>
    </Container>
  );
}
