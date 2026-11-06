import classNames from "classnames";
import { useEffect, useState } from "react";
import { FiChevronDown, FiRefreshCw, FiRss } from "react-icons/fi";
import useSWR from "swr";

import Container from "../widget/container";
import Raw from "../widget/raw";

const ROTATE_MS = 8000;

export default function News({ options }) {
  const { index, label = "实时新闻", limit = 8, refreshInterval = 300000, target = "_blank" } = options;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const { data, error, isValidating, mutate } = useSWR(
    `/api/widgets/news?${new URLSearchParams({ index: String(index ?? 0) })}`,
    {
      refreshInterval: Math.max(60000, Number(refreshInterval) || 300000),
      revalidateOnFocus: false,
    },
  );

  const maxItems = Math.min(20, Math.max(1, Number(limit) || 8));
  const items = Array.isArray(data?.items) ? data.items.slice(0, maxItems) : [];
  const current = items.length ? items[active % items.length] : null;

  useEffect(() => {
    if (open || items.length < 2) return undefined;
    const timer = setInterval(() => setActive((value) => (value + 1) % items.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [open, items.length]);

  const headline = error
    ? "新闻暂不可用"
    : current?.title || (isValidating ? "正在刷新…" : "正在获取新闻…");

  return (
    <Container options={options} additionalClassNames="information-widget-news">
      <Raw>
        <div className="relative flex flex-row items-center gap-2 min-w-[10rem] max-w-[22rem]">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            title={label}
            aria-label={label}
            className="flex-none text-theme-800 dark:text-theme-200 hover:opacity-70"
          >
            <FiRss className="w-4 h-4" />
          </button>

          <div className="flex flex-col min-w-0 grow">
            <a
              href={current?.link || undefined}
              target={target}
              rel="noreferrer"
              title={current?.title}
              className="truncate text-xs text-theme-800 dark:text-theme-200 hover:underline"
            >
              {headline}
            </a>
            <span className="text-[10px] text-theme-800/60 dark:text-theme-200/60">
              {current?.source ?? label}
            </span>
          </div>

          <button
            type="button"
            onClick={() => mutate()}
            title="刷新新闻"
            aria-label="刷新新闻"
            className="flex-none text-theme-800 dark:text-theme-200 hover:opacity-70"
          >
            <FiRefreshCw className={classNames("w-3.5 h-3.5", isValidating && "animate-spin")} />
          </button>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            title="展开新闻列表"
            aria-label="展开新闻列表"
            className="flex-none text-theme-800 dark:text-theme-200 hover:opacity-70"
          >
            <FiChevronDown className={classNames("w-3.5 h-3.5 transition-transform", open && "rotate-180")} />
          </button>

          {open && (
            <ul className="absolute right-0 top-full z-[90] mt-2 w-80 max-h-80 overflow-y-auto rounded-md border border-theme-300/50 dark:border-white/10 bg-theme-100 dark:bg-theme-800 shadow-lg">
              {items.length === 0 && (
                <li className="px-3 py-3 text-xs text-theme-800/70 dark:text-theme-200/70">暂无新闻，稍后会自动重试</li>
              )}
              {items.map((item, itemIndex) => (
                <li key={`${item.link}-${itemIndex}`}>
                  <a
                    href={item.link}
                    target={target}
                    rel="noreferrer"
                    className="flex flex-col px-3 py-2 text-xs text-theme-800 dark:text-theme-200 hover:bg-theme-600/10"
                  >
                    <span className="truncate">{item.title}</span>
                    <span className="text-[10px] opacity-60">
                      {item.source}
                      {item.date ? ` · ${new Date(item.date).toLocaleString("zh-CN")}` : ""}
                    </span>
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
