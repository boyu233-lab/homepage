import classNames from "classnames";
import { useSyncExternalStore, useState } from "react";
import {
  FiArrowLeft,
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
// v1.0.5 起歌单改为「所选视频的视频选集」：B站一个合集视频里可能有一百多个分P，
// 每个分P有自己的 cid 与曲名，搜索结果只是「视频」而不是「歌」。
// 音频走同源服务端代理（B站 CDN 强制校验 Referer），页面里只有 <audio>，不显示任何视频画面。
const SEARCH_API = "/api/widgets/bilibili_music";
const PAGES_API = "/api/widgets/bilibili_pages";
const AUDIO_API = "/api/widgets/bilibili_audio";
const DEFAULT_REFRESH_MS = 10 * 60 * 1000; // 同一关键词搜索结果缓存 10 分钟
const MAX_QUERY_LENGTH = 60;
const MAX_PAGE = 10;
const PAGE_SIZE = 20; // 选集每页显示 20 首，避免上百个分P一次性铺开
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

function audioSrc(bvid, cid) {
  return `${AUDIO_API}?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}`;
}

/* ============ 音量锁定 ============
   原生 <audio> 每首歌都会重新挂载(key=bvid:cid),音量默认是 100%。
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
  const [selection, setSelection] = useState(null); // 当前打开选集的视频
  const [playlistPage, setPlaylistPage] = useState(1);
  const [playingPage, setPlayingPage] = useState(null); // null = 默认从选集第 1 首开始
  const [stopped, setStopped] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const recent = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const searchKey = query
    ? `${SEARCH_API}?${new URLSearchParams({
        index: String(index ?? 0),
        q: query,
        page: String(page),
        refreshInterval: String(refreshMs),
      })}`
    : null;
  const pagesKey = selection
    ? `${PAGES_API}?${new URLSearchParams({ index: String(index ?? 0), bvid: selection.bvid })}`
    : null;
  const swrOptions = { revalidateOnFocus: false, revalidateOnReconnect: false };
  const search = useSWR(searchKey, swrOptions);
  const playlist = useSWR(pagesKey, swrOptions);

  // 搜索视图：搜索结果只是「视频」，点击后进入该视频的选集
  const maxItems = Math.min(20, Math.max(1, Number(limit) || 10));
  const searchItems = query && Array.isArray(search.data?.items) ? search.data.items : [];
  const searchVisible = searchItems.slice(0, maxItems);

  // 选集视图：一个视频的 N 个分P，每首有独立 cid / 曲名 / 时长
  const playlistReady = selection && playlist.data?.bvid === selection.bvid && Array.isArray(playlist.data?.items);
  const pages = playlistReady ? playlist.data.items : [];
  const playlistTitle = playlistReady ? playlist.data.title || selection.title : selection?.title;
  const totalPlaylistPages = Math.max(1, Math.ceil(pages.length / PAGE_SIZE));
  const activePlaylistPage = Math.min(playlistPage, totalPlaylistPages);
  const visiblePages = pages.slice((activePlaylistPage - 1) * PAGE_SIZE, activePlaylistPage * PAGE_SIZE);

  const activePage = playingPage ?? 1;
  const foundIndex = pages.findIndex((entry) => entry.page === activePage);
  const currentIndex = foundIndex >= 0 ? foundIndex : pages.length ? 0 : -1;
  const current = !stopped && selection && currentIndex >= 0 ? pages[currentIndex] : null;

  const resetPlayback = () => {
    setPlayingPage(null);
    setPlaylistPage(1);
    setStopped(false);
    setAudioError(false);
  };

  const runSearch = (text) => {
    const cleaned = String(text ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, MAX_QUERY_LENGTH);
    if (!cleaned) return;
    setDraft(cleaned);
    setQuery(cleaned);
    setPage(1);
    setSelection(null);
    resetPlayback();
    saveRecent(cleaned);
  };

  const submit = (event) => {
    event.preventDefault();
    runSearch(draft);
  };

  const openSelection = (item) => {
    setSelection({ bvid: item.bvid, title: item.title, author: item.author, link: item.link });
    resetPlayback();
  };

  const backToSearch = () => {
    setSelection(null);
    resetPlayback();
  };

  const playPage = (pageNumber) => {
    setPlayingPage(pageNumber);
    setStopped(false);
    setAudioError(false);
  };

  // 上一个 / 下一个 / 播完自动切下一首，都在同一视频的分P之间移动
  const shift = (delta) => {
    if (!pages.length || currentIndex < 0) return;
    const next = (currentIndex + delta + pages.length) % pages.length;
    setPlayingPage(pages[next].page);
    setPlaylistPage(Math.floor(next / PAGE_SIZE) + 1);
    setStopped(false);
    setAudioError(false);
  };

  const changePage = (delta) => {
    setPage((currentPage) => Math.min(MAX_PAGE, Math.max(1, currentPage + delta)));
  };

  const changePlaylistPage = (delta) => {
    setPlaylistPage((currentPlaylistPage) =>
      Math.min(totalPlaylistPages, Math.max(1, currentPlaylistPage + delta)),
    );
  };

  // 手动刷新带 force=1：搜索跳过服务端 10 分钟缓存；选集跳过 24 小时缓存
  const refresh = () => {
    if (pagesKey) {
      playlist.mutate(fetch(`${pagesKey}&force=1`).then((response) => response.json()), { revalidate: false });
    } else if (searchKey) {
      search.mutate(fetch(`${searchKey}&force=1`).then((response) => response.json()), { revalidate: false });
    }
  };

  let emptyText = "";
  if (selection) {
    if (playlist.error || playlist.data?.error) emptyText = "选集读取失败，稍后重试";
    else if (playlist.isValidating && !pages.length) emptyText = "正在读取视频选集…";
    else if (!pages.length) emptyText = "该视频没有可用选集";
  } else if (!query) emptyText = "输入关键词搜索 B站视频，点开结果即可查看选集并播放";
  else if (search.error || search.data?.error) emptyText = "搜索暂不可用，稍后重试";
  else if (search.isValidating && !searchVisible.length) emptyText = "正在搜索 B站视频…";
  else if (!searchVisible.length) emptyText = "没有找到相关视频，换个关键词试试";

  // 两种视图共用同一套列表样式：搜索结果是「视频」，选集是「分P歌曲」
  const rows = selection
    ? visiblePages.map((entry) => ({
        key: `${selection.bvid}:${entry.cid}`,
        rank: entry.page,
        title: entry.part,
        meta: formatDuration(entry.duration),
        link: entry.link || selection.link,
        active: entry.page === activePage,
        label: `播放 ${entry.part}`,
        hint: `${playlistTitle} · 第 ${entry.page} 首 · ${formatDuration(entry.duration)}`,
        onClick: () => playPage(entry.page),
      }))
    : searchVisible.map((item) => ({
        key: item.bvid,
        rank: item.rank,
        title: item.title,
        meta: `${formatCount(item.view)} · ${formatDuration(item.duration)}`,
        link: item.link,
        active: false,
        label: `打开选集 ${item.title}`,
        hint: `${item.title} · ${item.author} · ${formatCount(item.view)} 播放 · ${formatDuration(item.duration)}`,
        onClick: () => openSelection(item),
      }));

  const isValidating = selection ? playlist.isValidating : search.isValidating;

  return (
    <Container options={options} additionalClassNames="information-widget-bilibili_music">
      <Raw>
        <div className="bili-widget w-full">
          <div className="bili-toolbar">
            <FiSearch className="bili-toolbar-icon w-4 h-4" aria-hidden="true" />
            <span className="bili-label">{label}</span>
            {selection ? (
              <span className="bili-item-meta">
                选集 {pages.length ? `${pages.length} 首` : ""} · 第 {activePlaylistPage} / {totalPlaylistPages} 页
              </span>
            ) : (
              query &&
              search.data?.updatedAt && (
                <span className="bili-item-meta">
                  第 {page} 页 · 更新于 {formatUpdateTime(search.data.updatedAt)}
                </span>
              )
            )}
            <button
              type="button"
              onClick={refresh}
              disabled={!query && !selection}
              title="刷新"
              aria-label="刷新"
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
              placeholder="搜索 B站视频 / 音乐 / 合集…"
              aria-label="搜索关键词"
              maxLength={MAX_QUERY_LENGTH}
            />
            <button type="submit" className="bili-search-btn" aria-label="搜索 B站视频" title="搜索">
              <FiSearch className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </form>

          {!query && !selection && recent.length > 0 && (
            <div className="bili-recent">
              <span className="bili-recent-label">最近搜索</span>
              {recent.map((entry) => (
                <button key={entry} type="button" onClick={() => runSearch(entry)} title={`搜索 ${entry}`}>
                  {entry}
                </button>
              ))}
            </div>
          )}

          {!query && !selection && (
            <div className="bili-suggest">
              <span>试试：</span>
              {["周杰伦", "纯音乐", "白噪音", "Lo-Fi"].map((entry) => (
                <button key={entry} type="button" onClick={() => runSearch(entry)} title={`搜索 ${entry}`}>
                  {entry}
                </button>
              ))}
            </div>
          )}

          {selection && (
            <div className="bili-playlist-bar">
              <button
                type="button"
                className="bili-back"
                onClick={backToSearch}
                aria-label="返回搜索结果"
                title="返回搜索结果"
              >
                <FiArrowLeft className="w-3 h-3" aria-hidden="true" />
                <span>搜索结果</span>
              </button>
              <span className="bili-now-title" title={playlistTitle}>
                {playlistTitle}
              </span>
              <a
                href={selection.link}
                target={target}
                rel="noreferrer"
                className="bili-open"
                aria-label="在 B站打开该视频"
                title="在 B站打开该视频"
              >
                <FiExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              </a>
            </div>
          )}

          {current && (
            <div className="bili-player bili-audio-player">
              <div className="bili-player-bar">
                <button
                  type="button"
                  className="bili-back"
                  onClick={() => setStopped(true)}
                  aria-label="停止播放"
                  title="停止播放"
                >
                  <FiX className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>停止</span>
                </button>
                <span className="bili-now-title" title={current.part}>
                  {current.part}
                </span>
                <a
                  href={current.link || selection.link}
                  target={target}
                  rel="noreferrer"
                  className="bili-open"
                  aria-label="在 B站打开当前分P"
                  title="在 B站打开当前分P"
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
                  <span className="bili-audio-title">{current.part}</span>
                  <span className="bili-item-meta">
                    {playlistTitle} · {formatDuration(current.duration)} · 仅音频播放
                  </span>
                </span>
              </div>

              <audio
                key={`${selection.bvid}:${current.cid}`}
                ref={lockAudioVolume}
                className="bili-audio-el"
                src={audioSrc(selection.bvid, current.cid)}
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
                <div className="bili-audio-error">音频加载失败：该分P可能没有音轨，或 B站暂时拒绝了请求</div>
              )}

              <div className="bili-player-controls">
                <button type="button" onClick={() => shift(-1)} aria-label="上一个" title="上一个">
                  <FiChevronLeft className="w-4 h-4" aria-hidden="true" />
                </button>
                <span className="bili-item-meta">
                  {activePage} / {pages.length} · {selection.author}
                </span>
                <button type="button" onClick={() => shift(1)} aria-label="下一个" title="下一个">
                  <FiChevronRight className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          )}

          {/* 歌单常驻：播放时选集完整显示，当前分P高亮，点任意一首即可切歌 */}
          <ul className={classNames("bili-list", (selection || current) && "bili-list-scrollable")}>
            {emptyText && (
              <li className={classNames("bili-empty", !query && !selection && "bili-empty-start")}>{emptyText}</li>
            )}
            {rows.map((row) => (
              <li key={row.key} className={classNames("bili-list-item", row.active && "bili-list-item-playing")}>
                <button
                  type="button"
                  className="bili-play-btn"
                  onClick={row.onClick}
                  aria-label={row.label}
                  aria-current={row.active ? "true" : undefined}
                  title={row.hint}
                >
                  <span className="bili-rank">{row.rank}</span>
                  <span className="bili-item-title">{row.title}</span>
                  <span className="bili-item-meta">{row.meta}</span>
                </button>
                <a
                  href={row.link}
                  target={target}
                  rel="noreferrer"
                  className="bili-open"
                  aria-label={`在 B站打开 ${row.title}`}
                  title="在 B站打开"
                >
                  <FiExternalLink className="w-3 h-3" aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>

          {selection
            ? pages.length > PAGE_SIZE && (
                <div className="bili-pager">
                  <button
                    type="button"
                    onClick={() => changePlaylistPage(-1)}
                    disabled={activePlaylistPage <= 1}
                    aria-label="上一页"
                  >
                    <FiChevronLeft className="w-3 h-3" aria-hidden="true" /> 上一页
                  </button>
                  <span className="bili-item-meta">
                    第 {activePlaylistPage} / {totalPlaylistPages} 页 · 共 {pages.length} 首
                  </span>
                  <button
                    type="button"
                    onClick={() => changePlaylistPage(1)}
                    disabled={activePlaylistPage >= totalPlaylistPages}
                    aria-label="下一页"
                  >
                    下一页 <FiChevronRight className="w-3 h-3" aria-hidden="true" />
                  </button>
                </div>
              )
            : query &&
              searchVisible.length > 0 && (
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
