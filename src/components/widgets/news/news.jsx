import classNames from "classnames";
import { useSyncExternalStore } from "react";
import { FiClock, FiRefreshCw, FiTrendingUp } from "react-icons/fi";
import useSWR from "swr";

import Container from "../widget/container";
import Raw from "../widget/raw";

// 前三名用红/橙/黄，置顶用箭头，其余沿用 custom.css 的紫色徽标底
const RANK_COLORS = ["#f87171", "#fb923c", "#fbbf24"];
const DEFAULT_SOURCE = "baidu";
const STORAGE_KEY = "homepage.newsSource";

// 与服务端 SOURCES 保持一致；API 返回 availableSources 后以其为准。
const FALLBACK_SOURCES = [
  { key: "baidu", label: "百度热搜", kind: "board" },
  { key: "weibo", label: "微博热搜", kind: "board" },
  { key: "zhihu", label: "知乎热榜", kind: "board" },
  { key: "toutiao", label: "头条热榜", kind: "board" },
  { key: "douyin", label: "抖音热榜", kind: "board" },
  { key: "bilibili", label: "B站热搜", kind: "board" },
  { key: "bing", label: "Bing 资讯", kind: "news" },
  { key: "ithome", label: "IT之家", kind: "news" },
  { key: "sspai", label: "少数派", kind: "news" },
];
const SOURCE_KEYS = new Set(FALLBACK_SOURCES.map((source) => source.key));

// 用外部存储读取选择：服务端固定返回默认源，hydrate 后再读 localStorage，
// 既避免 SSR 不一致，也不需要在 effect 里同步 setState。
const listeners = new Set();

function subscribe(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return SOURCE_KEYS.has(saved) ? saved : DEFAULT_SOURCE;
  } catch {
    return DEFAULT_SOURCE;
  }
}

function getServerSnapshot() {
  return DEFAULT_SOURCE;
}

function notify() {
  listeners.forEach((callback) => callback());
}

const TABS_STYLE = {
  display: "flex",
  alignItems: "center",
  gap: 5,
  flex: "1 1 auto",
  minWidth: 0,
  flexWrap: "nowrap",
  overflowX: "auto",
  scrollbarWidth: "none",
};

function tabStyle(active) {
  return {
    flex: "none",
    padding: "2px 8px",
    borderRadius: 999,
    border: `1px solid ${active ? "rgba(196,181,253,.7)" : "rgba(167,139,250,.22)"}`,
    background: active ? "rgba(124,58,237,.55)" : "rgba(28,22,55,.35)",
    color: active ? "#fff" : "rgba(214,204,255,.72)",
    fontSize: "0.68rem",
    lineHeight: 1.5,
    whiteSpace: "nowrap",
    cursor: "pointer",
  };
}

function formatHot(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  return number >= 10000 ? `${(number / 10000).toFixed(1)}万` : String(number);
}

function formatUpdateTime(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(parsed.getMonth() + 1)}/${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

// S5 陈旧角标用：把 fetchedAt 转成「X 分钟前 / X 小时前」的相对时间。
function formatRelativeTime(value) {
  if (!value) return "";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "";
  const minutes = Math.max(0, Math.round((Date.now() - parsed) / 60000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  return `${Math.round(minutes / 60)} 小时前`;
}

function rightText(item, kind) {
  return kind === "news" ? formatDateTime(item.date) : formatHot(item.hotScore);
}

function rankStyle(item) {
  if (item.isTop) return { background: "rgba(248, 113, 113, 0.3)", color: "#fecaca" };
  const rank = Number(item.rank);
  if (rank >= 1 && rank <= 3) {
    const color = RANK_COLORS[rank - 1];
    return { background: `${color}2e`, color };
  }
  return undefined;
}

function tagStyle(tag) {
  const isNew = tag === "新";
  return {
    marginLeft: 6,
    padding: "1px 5px",
    borderRadius: 4,
    fontSize: "0.62rem",
    background: isNew ? "rgba(248, 113, 113, 0.32)" : "rgba(251, 146, 60, 0.32)",
    color: isNew ? "#fecaca" : "#fed7aa",
  };
}

export default function News({ options }) {
  const {
    index,
    label = "实时热搜",
    limit = 10,
    refreshInterval = 60000,
    target = "_blank",
  } = options;

  const activeSource = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const selectSource = (key) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, key);
    } catch {
      // 隐私模式下 localStorage 不可用，切换仍然生效（刷新后回默认源）
    }
    notify();
  };

  const { data, error, isValidating, mutate } = useSWR(
    `/api/widgets/news?${new URLSearchParams({
      index: String(index ?? 0),
      source: activeSource,
    })}`,
    {
      refreshInterval: Math.max(60000, Number(refreshInterval) || 60000),
      revalidateOnFocus: false,
    },
  );

  const sources = Array.isArray(data?.availableSources) ? data.availableSources : FALLBACK_SOURCES;
  const current = sources.find((source) => source.key === activeSource);
  const sourceLabel = current?.label || data?.sourceLabel || label;
  const kind = current?.kind || data?.kind || "board";

  const maxItems = Math.min(50, Math.max(1, Number(limit) || 10));
  const items = Array.isArray(data?.items) ? data.items : [];
  const visible = items.slice(0, maxItems);

  // S5 数据契约：stale 态只显示一个轻量角标，不新增常驻大面板。
  const envelope = data?._envelope;
  const isStale = envelope?.state === "stale" || envelope?.stale === true;
  const staleAge = formatRelativeTime(envelope?.fetchedAt);

  return (
    <Container options={options} additionalClassNames="information-widget-news">
      <Raw>
        <div className="news-widget w-full">
          <div className="news-toolbar" style={{ flexWrap: "nowrap", justifyContent: "flex-start" }}>
            <FiTrendingUp className="news-toolbar-icon w-4 h-4" aria-hidden="true" />
            <div className="news-source-tabs" style={TABS_STYLE} role="tablist" aria-label="热榜来源">
              {sources.map((source) => (
                <button
                  key={source.key}
                  type="button"
                  role="tab"
                  aria-selected={source.key === activeSource}
                  onClick={() => selectSource(source.key)}
                  title={`切换到${source.label}`}
                  style={tabStyle(source.key === activeSource)}
                >
                  {source.label}
                </button>
              ))}
            </div>
            {data?.updatedAt && (
              <span className="news-item-time" style={{ flex: "none" }}>
                更新于 {formatUpdateTime(data.updatedAt)}
              </span>
            )}
            {isStale && (
              <span
                className="inline-flex flex-none items-center gap-1 rounded px-2 py-0.5 text-xs bg-theme-300/30 text-theme-600 dark:text-theme-300"
                title={staleAge ? `数据获取于 ${staleAge}` : "数据为上次成功快照"}
              >
                <FiClock className="w-3 h-3" aria-hidden="true" />
                陈旧{staleAge ? ` · ${staleAge}` : ""}
              </span>
            )}
            <button
              type="button"
              onClick={() => mutate()}
              title={`刷新${sourceLabel}`}
              aria-label={`刷新${sourceLabel}`}
              className="news-refresh"
              style={{ flex: "none" }}
            >
              <FiRefreshCw className={classNames("w-3.5 h-3.5", isValidating && "animate-spin")} />
            </button>
          </div>

          <ul className="news-list">
            {error && <li className="news-empty">{sourceLabel}暂不可用，稍后会自动重试</li>}
            {!error && visible.length === 0 && (
              <li className="news-empty">
                {isValidating ? `正在获取${sourceLabel}…` : `${sourceLabel}暂无内容，稍后会自动重试`}
              </li>
            )}
            {visible.map((item, itemIndex) => (
              <li key={`${item.link}-${itemIndex}`} className="news-list-item">
                <a href={item.link} target={target} rel="noreferrer" title={item.desc || item.title}>
                  <span className="news-source-badge" style={rankStyle(item)}>
                    {item.isTop ? "↑" : item.rank || itemIndex + 1}
                  </span>
                  <span className="news-item-title">
                    {item.title}
                    {item.hotTag && <span style={tagStyle(item.hotTag)}>{item.hotTag}</span>}
                  </span>
                  <span className="news-item-time">{rightText(item, kind)}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </Raw>
    </Container>
  );
}
