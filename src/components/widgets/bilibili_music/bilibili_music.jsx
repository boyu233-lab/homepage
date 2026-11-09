import classNames from "classnames";
import { useState } from "react";
import {
  FiArrowLeft,
  FiChevronLeft,
  FiChevronRight,
  FiExternalLink,
  FiMusic,
  FiRefreshCw,
} from "react-icons/fi";
import useSWR from "swr";

import Container from "../widget/container";
import Raw from "../widget/raw";

const RANK_COLORS = ["#f87171", "#fb923c", "#fbbf24"];
const PLAYER_BASE = "https://player.bilibili.com/player.html";
// B站音乐区排行榜按天更新，默认 24 小时刷新一次（widgets.yaml 可覆盖）
const DEFAULT_REFRESH_MS = 24 * 60 * 60 * 1000;

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

// 24 小时周期下只显示 HH:mm 看不出是哪天，带上月/日
function formatUpdateTime(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(parsed.getMonth() + 1)}/${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

function rankStyle(item) {
  const rank = Number(item.rank);
  if (rank >= 1 && rank <= 3) {
    const color = RANK_COLORS[rank - 1];
    return { background: `${color}2e`, color };
  }
  return undefined;
}

function playerUrl(bvid) {
  const params = new URLSearchParams({
    bvid,
    page: "1",
    high_quality: "1",
    danmaku: "0",
    autoplay: "1", // 用户点击后才挂载 iframe，属于用户手势后的播放
  });
  return `${PLAYER_BASE}?${params}`;
}

export default function BilibiliMusic({ options }) {
  const {
    index,
    label = "B站音乐榜",
    limit = 10,
    refreshInterval = DEFAULT_REFRESH_MS,
    target = "_blank",
  } = options;

  const refreshMs = Math.max(60000, Number(refreshInterval) || DEFAULT_REFRESH_MS);
  const key = `/api/widgets/bilibili_music?${new URLSearchParams({
    index: String(index ?? 0),
    refreshInterval: String(refreshMs),
  })}`;

  const { data, error, isValidating, mutate } = useSWR(key, {
    refreshInterval: refreshMs,
    revalidateOnFocus: false,
  });

  const maxItems = Math.min(50, Math.max(1, Number(limit) || 10));
  const items = Array.isArray(data?.items) ? data.items : [];
  const visible = items.slice(0, maxItems);
  const [playing, setPlaying] = useState(null);

  const currentIndex = visible.findIndex((item) => item.bvid === playing);
  const current = currentIndex >= 0 ? visible[currentIndex] : null;

  const shift = (delta) => {
    if (currentIndex < 0 || !visible.length) return;
    const next = (currentIndex + delta + visible.length) % visible.length;
    setPlaying(visible[next].bvid);
  };

  // 24 小时服务端缓存下，普通 mutate 只会拿回缓存；带 force=1 才真正重拉上游
  const refresh = () =>
    mutate(fetch(`${key}&force=1`).then((response) => response.json()), { revalidate: false });

  return (
    <Container options={options} additionalClassNames="information-widget-bilibili_music">
      <Raw>
        <div className="bili-widget w-full">
          <div className="bili-toolbar">
            <FiMusic className="bili-toolbar-icon w-4 h-4" aria-hidden="true" />
            <span className="bili-label">{label}</span>
            {data?.updatedAt && (
              <span className="bili-item-meta">更新于 {formatUpdateTime(data.updatedAt)}</span>
            )}
            <button
              type="button"
              onClick={refresh}
              title="刷新音乐榜"
              aria-label="刷新音乐榜"
              className="bili-refresh"
            >
              <FiRefreshCw className={classNames("w-3.5 h-3.5", isValidating && "animate-spin")} />
            </button>
          </div>

          {current ? (
            <div className="bili-player">
              <div className="bili-player-bar">
                <button
                  type="button"
                  className="bili-back"
                  onClick={() => setPlaying(null)}
                  aria-label="返回音乐榜"
                  title="返回音乐榜"
                >
                  <FiArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>榜单</span>
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

              <iframe
                key={current.bvid}
                className="bili-player-frame"
                src={playerUrl(current.bvid)}
                title={`B站播放器：${current.title}`}
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen
              />

              <div className="bili-player-controls">
                <button type="button" onClick={() => shift(-1)} aria-label="上一首" title="上一首">
                  <FiChevronLeft className="w-4 h-4" aria-hidden="true" />
                </button>
                <span className="bili-item-meta">
                  {currentIndex + 1} / {visible.length} · {current.author}
                </span>
                <button type="button" onClick={() => shift(1)} aria-label="下一首" title="下一首">
                  <FiChevronRight className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : (
            <ul className="bili-list">
              {error && <li className="bili-empty">音乐榜暂不可用，稍后会自动重试</li>}
              {!error && visible.length === 0 && (
                <li className="bili-empty">
                  {isValidating ? "正在获取音乐榜…" : "暂无音乐榜，稍后会自动重试"}
                </li>
              )}
              {visible.map((item, itemIndex) => (
                <li key={item.bvid} className="bili-list-item">
                  <button
                    type="button"
                    className="bili-play-btn"
                    onClick={() => setPlaying(item.bvid)}
                    aria-label={`播放 ${item.title}`}
                    title={`${item.title} · ${item.author} · ${formatCount(item.view)} 播放 · ${formatDuration(item.duration)}`}
                  >
                    <span className="bili-rank" style={rankStyle(item)}>
                      {item.rank || itemIndex + 1}
                    </span>
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
          )}
        </div>
      </Raw>
    </Container>
  );
}
