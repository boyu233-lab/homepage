import classNames from "classnames";
import { FiRefreshCw, FiTrendingUp } from "react-icons/fi";
import useSWR from "swr";

import Container from "../widget/container";
import Raw from "../widget/raw";

// 前三名用红/橙/黄，置顶用箭头，其余沿用 custom.css 的紫色徽标底
const RANK_COLORS = ["#f87171", "#fb923c", "#fbbf24"];

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

  const { data, error, isValidating, mutate } = useSWR(
    `/api/widgets/news?${new URLSearchParams({ index: String(index ?? 0) })}`,
    {
      refreshInterval: Math.max(60000, Number(refreshInterval) || 60000),
      revalidateOnFocus: false,
    },
  );

  const maxItems = Math.min(50, Math.max(1, Number(limit) || 10));
  const items = Array.isArray(data?.items) ? data.items : [];
  const visible = items.slice(0, maxItems);

  return (
    <Container options={options} additionalClassNames="information-widget-news">
      <Raw>
        <div className="news-widget w-full">
          <div className="news-toolbar">
            <FiTrendingUp className="news-toolbar-icon w-4 h-4" aria-hidden="true" />
            <span className="news-label">{label}</span>
            {data?.updatedAt && (
              <span className="news-item-time">更新于 {formatUpdateTime(data.updatedAt)}</span>
            )}
            <button
              type="button"
              onClick={() => mutate()}
              title="刷新热搜"
              aria-label="刷新热搜"
              className="news-refresh"
            >
              <FiRefreshCw className={classNames("w-3.5 h-3.5", isValidating && "animate-spin")} />
            </button>
          </div>

          <ul className="news-list">
            {error && <li className="news-empty">热搜暂不可用，稍后会自动重试</li>}
            {!error && visible.length === 0 && (
              <li className="news-empty">{isValidating ? "正在获取热搜…" : "暂无热搜，稍后会自动重试"}</li>
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
                  <span className="news-item-time">{formatHot(item.hotScore)}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </Raw>
    </Container>
  );
}
