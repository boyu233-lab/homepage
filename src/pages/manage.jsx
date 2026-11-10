import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { signOut, useSession } from "next-auth/react";
import { useCallback, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import ConfigUpdater from "components/manage/config-updater";
import ResolvedIcon from "components/resolvedicon";

import { withPageAuth } from "utils/auth";

const FIELDS = [
  { key: "name", label: "名称", required: true, w: "w-36" },
  { key: "href", label: "链接", required: true, w: "w-64", placeholder: "https://..." },
  { key: "icon", label: "图标", w: "w-40", placeholder: "mdi-xxx / xxx.png" },
  { key: "abbr", label: "缩写", w: "w-16", placeholder: "字母" },
  { key: "description", label: "描述", w: "w-40", placeholder: "留空显示域名" },
  { key: "id", label: "高亮ID", w: "w-28", placeholder: "如 #tile-blue" },
  { key: "target", label: "打开", w: "w-20", placeholder: "_blank" },
];

function moveItem(list, from, to) {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

const btnSmall =
  "px-2 py-1 rounded bg-theme-300/70 dark:bg-white/10 text-xs disabled:opacity-30";

export default function Manage({ initialTab = "visual" }) {
  const router = useRouter();
  const { data: session } = useSession();
  const { data, error, mutate } = useSWR("/api/config/bookmarks");
  const [mode, setMode] = useState(initialTab);
  // null = 未编辑，直接展示服务端数据；非 null = 本地草稿。
  // 用派生值而不是在 useEffect 里把 SWR 数据同步进 state，避免级联渲染。
  const [edits, setEdits] = useState(null);
  const [rawEdits, setRawEdits] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const groups = edits ?? data?.groups ?? [];
  const raw = rawEdits ?? data?.raw ?? "";
  const dirty = edits !== null;
  const rawDirty = rawEdits !== null;

  const update = useCallback((next) => setEdits(next), []);

  const addGroup = () => update([...groups, { name: "新分组", bookmarks: [] }]);
  const removeGroup = (gi) => update(groups.filter((_, i) => i !== gi));
  const renameGroup = (gi, name) => update(groups.map((g, i) => (i === gi ? { ...g, name } : g)));
  const moveGroup = (gi, delta) => update(moveItem(groups, gi, gi + delta));

  const addBookmark = (gi) =>
    update(
      groups.map((g, i) =>
        i === gi
          ? {
              ...g,
              bookmarks: [
                ...g.bookmarks,
                { name: "新标签", href: "https://", icon: "", abbr: "", description: "", id: "", target: "" },
              ],
            }
          : g,
      ),
    );
  const removeBookmark = (gi, bi) =>
    update(
      groups.map((g, i) =>
        i === gi ? { ...g, bookmarks: g.bookmarks.filter((_, j) => j !== bi) } : g,
      ),
    );
  const updateBookmark = (gi, bi, key, value) =>
    update(
      groups.map((g, i) =>
        i === gi
          ? { ...g, bookmarks: g.bookmarks.map((b, j) => (j === bi ? { ...b, [key]: value } : b)) }
          : g,
      ),
    );
  const moveBookmark = (gi, bi, delta) =>
    update(
      groups.map((g, i) =>
        i === gi ? { ...g, bookmarks: moveItem(g.bookmarks, bi, bi + delta) } : g,
      ),
    );

  const changed = mode === "raw" ? rawDirty : dirty;

  const save = async (exit) => {
    // 没有改动时"保存并返回首页"只跳转，不写盘、不覆盖备份
    if (!changed) {
      if (exit) router.push("/");
      else setMsg("没有需要保存的改动");
      return;
    }
    setSaving(true);
    setMsg("");
    try {
      const payload = mode === "raw" ? { raw } : { groups };
      const res = await fetch("/api/config/bookmarks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `保存失败 (HTTP ${res.status})`);
      setEdits(null);
      setRawEdits(null);
      setMsg(`✅ 已保存${json.backup ? `，备份 ${json.backup}` : ""}`);
      // 首页读的是 /api/bookmarks，与管理页的 SWR key 不同，需单独让其失效
      await mutate();
      await globalMutate("/api/bookmarks");
      if (exit) router.push("/");
    } catch (e) {
      setMsg(`❌ ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const loadError = error || (data?.error ? new Error(data.error) : null);
  // 书签 YAML 损坏时仍要能进「配置更新」页上传修复，所以错误屏只在编辑模式下拦截
  if (loadError && mode !== "files") {
    return (
      <div className="min-h-screen bg-theme-100/30 dark:bg-theme-900 text-theme-800 dark:text-theme-200 p-10">
        <h1 className="text-xl font-bold mb-3">书签加载失败</h1>
        <p className="text-sm mb-4">{loadError.message}</p>
        <div className="flex gap-3">
          <button onClick={() => mutate()} className="px-3 py-1.5 rounded-md bg-theme-500 text-white text-sm">
            重试
          </button>
          <Link href="/manage?tab=files" className="px-3 py-1.5 rounded-md bg-theme-200/60 dark:bg-white/10 text-sm">
            前往配置更新
          </Link>
          <Link href="/auth/signin" className="px-3 py-1.5 rounded-md bg-theme-200/60 dark:bg-white/10 text-sm">
            重新登录
          </Link>
        </div>
      </div>
    );
  }

  if (!data && mode !== "files") {
    return <div className="p-10 text-theme-200">加载中…</div>;
  }

  return (
    <>
      <Head>
        <title>{mode === "files" ? "配置更新" : "书签管理"} - Homepage</title>
      </Head>
      <div className="min-h-screen bg-theme-100/30 dark:bg-theme-900 text-theme-800 dark:text-theme-200 p-4 sm:p-8">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">{mode === "files" ? "配置更新" : "书签管理"}</h1>
          <div className="flex gap-2 items-center">
            {session?.user && <span className="text-sm opacity-70">{session.user.name}</span>}
            <button
              onClick={() => signOut({ callbackUrl: "/auth/signin" })}
              className="px-3 py-1 rounded-md bg-theme-500 text-white text-sm"
            >
              退出
            </button>
            <Link href="/" className="px-3 py-1 rounded-md bg-theme-200/60 dark:bg-white/10 text-sm">
              返回首页
            </Link>
          </div>
        </div>

        <div className="flex gap-1 mb-4 p-1 rounded-md bg-theme-200/40 dark:bg-white/5 w-fit">
          {[
            ["visual", "可视化编辑"],
            ["raw", "源码模式"],
            ["files", "配置更新"],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setMode(key)}
              className={`px-3 py-1 rounded text-sm ${
                mode === key ? "bg-theme-500 text-white" : "opacity-70 hover:opacity-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "files" ? (
          <ConfigUpdater />
        ) : (
          <>
            {msg && <div className="mb-4 text-sm">{msg}</div>}

            {mode === "raw" ? (
              <>
                <textarea
                  value={raw}
                  onChange={(e) => setRawEdits(e.target.value)}
                  spellCheck={false}
                  className="w-full h-[60vh] p-3 rounded font-mono text-xs leading-5 bg-theme-50 dark:bg-black/30 focus:outline-none"
                />
                <p className="mt-3 text-xs opacity-60">
                  源码模式把 YAML <strong>原样写回</strong>，文件头注释、分组注释与自定义字段都会完整保留。
                  保存前会校验 YAML 可被 Homepage 解析；写回前自动生成带时间戳的备份。
                </p>
              </>
            ) : (
              <div className="space-y-4">
                {groups.map((g, gi) => (
                  <div key={gi} className="rounded-md bg-theme-200/40 dark:bg-white/5 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <input
                        value={g.name}
                        onChange={(e) => renameGroup(gi, e.target.value)}
                        className="text-lg font-semibold bg-transparent border-b border-theme-400 focus:outline-none"
                      />
                      <span className="text-xs opacity-60">{g.bookmarks.length} 个标签</span>
                      <div className="ml-auto flex gap-1 items-center">
                        <button
                          onClick={() => moveGroup(gi, -1)}
                          disabled={gi === 0}
                          title="上移分组"
                          className={btnSmall}
                        >
                          ↑
                        </button>
                        <button
                          onClick={() => moveGroup(gi, 1)}
                          disabled={gi === groups.length - 1}
                          title="下移分组"
                          className={btnSmall}
                        >
                          ↓
                        </button>
                        <button
                          onClick={() => removeGroup(gi)}
                          className="px-2 py-1 rounded bg-rose-500/80 text-white text-xs"
                        >
                          删除分组
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {g.bookmarks.map((b, bi) => (
                        <div
                          key={bi}
                          className="flex flex-wrap items-center gap-2 rounded bg-theme-100/60 dark:bg-white/5 p-2"
                        >
                          {b.icon ? (
                            <div className="w-6 h-6 shrink-0 grid place-items-center">
                              <ResolvedIcon icon={b.icon} alt={b.abbr} />
                            </div>
                          ) : (
                            <div className="w-6 h-6 shrink-0 grid place-items-center text-xs bg-theme-300 dark:bg-theme-700 rounded">
                              {b.abbr || "?"}
                            </div>
                          )}
                          {FIELDS.map((f) => (
                            <input
                              key={f.key}
                              value={b[f.key] ?? ""}
                              placeholder={f.label + (f.required ? "*" : "")}
                              onChange={(e) => updateBookmark(gi, bi, f.key, e.target.value)}
                              className={`px-2 py-1 rounded bg-theme-50 dark:bg-white/10 text-sm focus:outline-none ${f.w}`}
                            />
                          ))}
                          <button
                            onClick={() => moveBookmark(gi, bi, -1)}
                            disabled={bi === 0}
                            title="上移标签"
                            className={btnSmall}
                          >
                            ↑
                          </button>
                          <button
                            onClick={() => moveBookmark(gi, bi, 1)}
                            disabled={bi === g.bookmarks.length - 1}
                            title="下移标签"
                            className={btnSmall}
                          >
                            ↓
                          </button>
                          <button
                            onClick={() => removeBookmark(gi, bi)}
                            className="px-2 py-1 rounded bg-rose-500/70 text-white text-xs"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => addBookmark(gi)}
                        className="px-2 py-1 rounded bg-theme-500 text-white text-xs"
                      >
                        + 添加标签
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-6 flex gap-3">
              {mode === "visual" && (
                <button
                  onClick={addGroup}
                  className="px-3 py-1.5 rounded-md bg-theme-500 text-white text-sm"
                >
                  + 添加分组
                </button>
              )}
              <button
                onClick={() => save(false)}
                disabled={saving || !changed}
                className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm disabled:opacity-40"
              >
                {saving ? "保存中…" : "保存"}
              </button>
              <button
                onClick={() => save(true)}
                disabled={saving}
                className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm disabled:opacity-40"
              >
                {changed ? "保存并返回首页" : "返回首页（无改动）"}
              </button>
            </div>
            <p className="mt-3 text-xs opacity-60">
              图标填 <code>mdi-xxx</code> / <code>si-xxx</code> 或 <code>xxx.png</code>；高亮ID 对应 custom.css 里的
              <code>#tile-xxx</code> 规则（如 <code>#tile-blue</code>）。可视化保存会保留文件头注释；
              需要保留分组内注释请切到「源码模式」。每次写回生成 <code>bookmarks.yaml.时间戳.bak</code>，自动保留最近
              10 份。
            </p>
          </>
        )}
      </div>
    </>
  );
}

// GHSA-qxcr-4rv3-v23r 纵深防御：Next.js 会为带 x-prerender-revalidate 的内部重验证请求
// 跳过 middleware/proxy，所以 /manage 不能只靠 proxy.js 单点守门。页面层再校验一次会话，
// 即使 proxy 被绕过，未登录请求仍会跳转到登录页；敏感 API 则由 withAuth 在 handler 层把关。
// initialTab 让书签 YAML 损坏时仍可通过 /manage?tab=files 直接进入配置更新页上传修复。
export const getServerSideProps = withPageAuth(async (context) => ({
  props: { initialTab: context.query?.tab === "files" ? "files" : "visual" },
}));
