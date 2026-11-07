import classNames from "classnames";
import { useState } from "react";
import { FiRefreshCw, FiRss } from "react-icons/fi";
import useSWR from "swr";

import Container from "../widget/container";
import Raw from "../widget/raw";

const ALL_SOURCES = "__all__";
const STORAGE_KEY = "homepage.newsSource";

function readSavedSource() {
  try {
    return localStorage.getItem(STORAGE_KEY) || ALL_SOURCES;
  } catch {
    return ALL_SOURCES;
  }
}

function saveSource(value) {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // 隐私模式下忽略
  }
}

function formatDate(date) {
  if (!date) return "";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function News({ options }) {
  const {
    index,
    label = "实时新闻",
    limit = 8,
    refreshInterval = 300000,
    target = "_blank",
    showSourceFilter = true,
  } = options;
  // 惰性初始化：SSR 时 localStorage 不存在，readSavedSource 会回退到「全部」
  const [source, setSource] = useState(readSavedSource);

  const { data, error, isValidating, mutate } = useSWR(
    `/api/widgets/news?${new URLSearchParams({ index: String(index ?? 0) })}`,
    {
      refreshInterval: Math.max(60000, Number(refreshInterval) || 300000),
      revalidateOnFocus: false,
    },
  );

  const maxItems = Math.min(30, Math.max(1, Number(limit) || 8));
  const items = Array.isArray(data?.items) ? data.items : [];
  // 优先用服务端返回的已启用源列表；旧版接口没有该字段时从新闻条目里推断
  const sources =
    Array.isArray(data?.feedNames) && data.feedNames.length
      ? data.feedNames
      : Array.from(new Set(items.map((item) => item.source).filter(Boolean)));
  // 选中的来源如果已被移除，回退到「全部」，避免列表一直空白
  const effectiveSource = source === ALL_SOURCES || sources.includes(source) ? source : ALL_SOURCES;
  const visible = items
    .filter((item) => effectiveSource === ALL_SOURCES || item.source === effectiveSource)
    .slice(0, maxItems);

  function choose(value) {
    setSource(value);
    saveSource(value);
  }

  return (
    <Container options={options} additionalClassNames="information-widget-news">
      <Raw>
        <div className="news-widget w-full">
          <div className="news-toolbar">
            <FiRss className="news-toolbar-icon w-4 h-4" aria-hidden="true" />
            <span className="news-label">{label}</span>

            {showSourceFilter && sources.length > 1 && (
              <div className="news-source-filters" role="group" aria-label="选择新闻来源">
                <button
                  type="button"
                  onClick={() => choose(ALL_SOURCES)}
                  aria-pressed={effectiveSource === ALL_SOURCES}
                  className={classNames("news-source-filter", effectiveSource === ALL_SOURCES && "active")}
                >
                  全部
                </button>
                {sources.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => choose(name)}
                    aria-pressed={effectiveSource === name}
                    className={classNames("news-source-filter", effectiveSource === name && "active")}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => mutate()}
              title="刷新新闻"
              aria-label="刷新新闻"
              className="news-refresh"
            >
              <FiRefreshCw className={classNames("w-3.5 h-3.5", isValidating && "animate-spin")} />
            </button>
          </div>

          <ul className="news-list">
            {error && <li className="news-empty">新闻暂不可用，稍后会自动重试</li>}
            {!error && visible.length === 0 && (
              <li className="news-empty">
                {isValidating
                  ? "正在获取新闻…"
                  : effectiveSource === ALL_SOURCES
                    ? "暂无新闻，稍后会自动重试"
                    : `「${effectiveSource}」暂无新闻`}
              </li>
            )}
            {visible.map((item, itemIndex) => (
              <li key={`${item.link}-${itemIndex}`} className="news-list-item">
                <a href={item.link} target={target} rel="noreferrer" title={item.title}>
                  <span className="news-source-badge">{item.source}</span>
                  <span className="news-item-title">{item.title}</span>
                  <span className="news-item-time">{formatDate(item.date)}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </Raw>
    </Container>
  );
}
