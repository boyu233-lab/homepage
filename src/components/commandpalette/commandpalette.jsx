import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiCornerDownLeft, FiSearch, FiX } from "react-icons/fi";
import useSWR from "swr";

const STORAGE_KEY = "homepage.commandpalette.frequency";
const MAX_RESULTS = 8;

function isEditable(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable === true;
}

function readFrequency() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function bumpFrequency(key) {
  if (typeof window === "undefined" || !key) return;
  const frequency = readFrequency();
  frequency[key] = (Number(frequency[key]) || 0) + 1;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(frequency));
  } catch {
    // 隐私模式下 localStorage 不可写时跳过频次记录，不影响打开链接。
  }
}

// 把分组化的书签/服务扁平化为可检索条目，保留分组名用于加权匹配。
function collectItems(bookmarks, services) {
  const items = [];
  const seen = new Set();

  const add = (entry, groupName, type) => {
    if (!entry || !entry.href || entry.href === "#") return;
    const key = `${type}:${groupName}:${entry.name}:${entry.href}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({
      key,
      name: String(entry.name ?? ""),
      href: String(entry.href),
      abbr: String(entry.abbr ?? ""),
      group: String(groupName ?? ""),
      type,
    });
  };

  (Array.isArray(bookmarks) ? bookmarks : []).forEach((group) => {
    (group?.bookmarks ?? []).forEach((entry) => add(entry, group?.name, "bookmark"));
  });

  const walkServices = (groups, parentName) => {
    (Array.isArray(groups) ? groups : []).forEach((group) => {
      const groupName = group?.name ?? parentName;
      (group?.services ?? []).forEach((entry) => add(entry, groupName, "service"));
      if (group?.groups?.length) walkServices(group.groups, groupName);
    });
  };
  walkServices(services, "");

  return items;
}

// 本地加权：名称前缀 > 名称包含 > 缩写 > 分组名 > URL；-1 表示不匹配。
function scoreItem(item, query) {
  const name = item.name.toLowerCase();
  const abbr = item.abbr.toLowerCase();
  const group = item.group.toLowerCase();
  const href = item.href.toLowerCase();
  if (name.startsWith(query)) return 100;
  if (name.includes(query)) return 80;
  if (abbr && abbr.startsWith(query)) return 60;
  if (abbr && abbr.includes(query)) return 55;
  if (group.includes(query)) return 40;
  if (href.includes(query)) return 20;
  return -1;
}

function rankItems(items, query, frequency) {
  const normalized = query.trim().toLowerCase();
  const scored = items
    .map((item) => ({ item, score: normalized ? scoreItem(item, normalized) : 0 }))
    .filter(({ score }) => score >= 0);
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const fa = Number(frequency[a.item.key]) || 0;
    const fb = Number(frequency[b.item.key]) || 0;
    if (fb !== fa) return fb - fa;
    return a.item.name.localeCompare(b.item.name);
  });
  return scored.slice(0, MAX_RESULTS).map(({ item }) => item);
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);

  // 复用首页已有的两个 SWR 数据源，不新增任何 API 请求。
  const { data: bookmarks } = useSWR("/api/bookmarks");
  const { data: services } = useSWR("/api/services");

  const items = useMemo(() => collectItems(bookmarks, services), [bookmarks, services]);
  const frequency = useMemo(() => (open ? readFrequency() : {}), [open]);
  const results = useMemo(() => rankItems(items, query, frequency), [items, query, frequency]);
  // 结果变短时在渲染期收敛选中项，避免在 effect 里同步 setState 造成级联渲染。
  const activeIndex = Math.min(selectedIndex, Math.max(0, results.length - 1));

  const loading = !bookmarks && !services;

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setSelectedIndex(0);
  }, []);

  const activate = useCallback(
    (index) => {
      const item = results[index];
      if (!item) return;
      bumpFrequency(item.key);
      window.open(item.href, "_blank", "noreferrer");
      close();
    },
    [results, close],
  );

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  useEffect(() => {
    function handleKeyDown(event) {
      const toggle = (event.ctrlKey || event.metaKey) && (event.key === "k" || event.key === "K");
      if (toggle) {
        event.preventDefault();
        setOpen(true);
        return;
      }

      if (!open) {
        if (event.key === "/" && !isEditable(event.target) && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          setOpen(true);
        }
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex(Math.min(activeIndex + 1, results.length - 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex(Math.max(activeIndex - 1, 0));
      } else if (event.key === "Enter") {
        event.preventDefault();
        activate(activeIndex);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, results.length, activeIndex, close, activate]);

  // 未打开时不渲染任何可见 UI，首页默认观感保持不变。
  if (!open) return null;

  return (
    <div
      className="command-palette fixed inset-0 z-[80] flex items-start justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-label="全局命令面板"
    >
      <button
        type="button"
        aria-label="点击空白处关闭"
        onClick={close}
        className="absolute inset-0 w-full cursor-default border-0 bg-theme-900/50"
      />
      <div className="relative mt-[12vh] w-full max-w-xl rounded-md shadow-md shadow-theme-900/20 bg-theme-50 dark:bg-theme-800 text-theme-700 dark:text-theme-200">
        <div className="flex items-center gap-2 border-b border-theme-300/40 px-4">
          <FiSearch className="w-4 h-4 shrink-0 text-theme-600 dark:text-theme-300" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            placeholder="搜索书签或服务"
            aria-label="搜索书签或服务"
            autoComplete="off"
            className="w-full bg-transparent p-4 pl-0 text-sm md:text-base outline-none text-theme-700 dark:text-theme-200"
          />
          <button
            type="button"
            onClick={close}
            aria-label="关闭命令面板"
            className="shrink-0 p-1 rounded text-theme-600 dark:text-theme-300 hover:bg-theme-300/40 dark:hover:bg-theme-700/40"
          >
            <FiX className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <ul className="max-h-[55vh] overflow-y-auto p-2">
          {results.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-theme-600 dark:text-theme-300">
              {loading ? "正在读取书签与服务…" : "未找到匹配项"}
            </li>
          )}
          {results.map((item, index) => (
            <li key={item.key}>
              <button
                type="button"
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => activate(index)}
                className={`flex w-full items-center justify-between gap-3 rounded-md px-4 py-2 text-left text-sm ${
                  index === activeIndex ? "bg-theme-300/50 dark:bg-theme-700/50" : ""
                }`}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{item.name}</span>
                  {item.group && (
                    <span className="truncate text-xs text-theme-600 dark:text-theme-300">{item.group}</span>
                  )}
                </span>
                {index === activeIndex && (
                  <FiCornerDownLeft
                    className="w-4 h-4 shrink-0 text-theme-600 dark:text-theme-300"
                    aria-hidden="true"
                  />
                )}
              </button>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap gap-3 border-t border-theme-300/40 px-4 py-2 text-xs text-theme-600 dark:text-theme-300">
          <span>方向键选择</span>
          <span>回车打开</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>
  );
}
