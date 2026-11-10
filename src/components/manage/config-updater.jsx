import { useCallback, useMemo, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";

const API = "/api/config/upload";

async function post(payload) {
  const response = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let body = {};
  try {
    body = await response.json();
  } catch {
    // 被网关拦截时可能不是 JSON，交给下面的统一错误提示
  }
  return { ok: response.ok, status: response.status, ...body };
}

function formatBytes(size) {
  if (!size) return "0 B";
  if (size < 1024) return `${size} B`;
  return `${(size / 1024).toFixed(1)} KB`;
}

function formatTime(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function ConfigUpdater() {
  const { data, error, mutate } = useSWR(API);
  const [pending, setPending] = useState([]);
  const [results, setResults] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const known = useMemo(() => new Set((data?.files || []).map((entry) => entry.name)), [data]);
  const backups = data?.backups || {};

  const pick = useCallback(
    async (fileList) => {
      const files = Array.from(fileList || []);
      if (!files.length) return;
      setBusy(true);
      setMessage("");
      setResults([]);
      const checked = [];
      for (const file of files) {
        let content = "";
        try {
          content = await file.text();
        } catch {
          checked.push({ file: file.name, size: file.size, valid: false, error: "读取文件失败" });
          continue;
        }
        if (!known.has(file.name)) {
          checked.push({
            file: file.name,
            size: file.size,
            content,
            valid: false,
            error: "文件名不在允许列表内，请保持原始文件名",
          });
          continue;
        }
        const check = await post({ action: "validate", file: file.name, content });
        checked.push({
          file: file.name,
          size: file.size,
          content,
          valid: check.ok && check.valid !== false,
          error: check.ok ? "" : check.error || `校验失败 (HTTP ${check.status})`,
        });
      }
      setPending(checked);
      setBusy(false);
    },
    [known],
  );

  const upload = async () => {
    const targets = pending.filter((item) => item.valid);
    if (!targets.length) {
      setMessage("没有通过校验的文件，无法上传");
      return;
    }
    setBusy(true);
    const uploaded = [];
    for (const item of targets) {
      const response = await post({ action: "upload", file: item.file, content: item.content });
      uploaded.push({
        file: item.file,
        ok: response.ok,
        error: response.error,
        backup: response.backup,
      });
    }
    setResults(uploaded);
    setPending([]);
    setBusy(false);
    await mutate();
    await globalMutate("/api/hash");
    const succeeded = uploaded.filter((entry) => entry.ok).length;
    setMessage(succeeded ? `✅ ${succeeded} 个配置已写入并生效，首页会自动刷新` : "❌ 全部上传失败");
  };

  const download = async (file) => {
    const response = await fetch(`${API}?download=${encodeURIComponent(file)}`);
    if (!response.ok) {
      setMessage(`❌ 下载 ${file} 失败`);
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const restore = async (file, backup) => {
    if (!window.confirm(`用 ${backup} 覆盖当前的 ${file}？当前内容会先自动备份。`)) return;
    setBusy(true);
    const response = await post({ action: "restore", file, backup });
    setBusy(false);
    setMessage(
      response.ok
        ? `✅ 已回滚 ${file}${response.backup ? `，原内容备份为 ${response.backup}` : ""}`
        : `❌ ${response.error || "回滚失败"}`,
    );
    await mutate();
    await globalMutate("/api/hash");
  };

  const clearPending = () => {
    setPending([]);
    setResults([]);
    setMessage("");
  };

  if (error) {
    return (
      <div className="rounded-md bg-theme-200/40 dark:bg-white/5 p-6 text-sm">
        <p className="mb-3">配置列表加载失败：{error.message}</p>
        <button onClick={() => mutate()} className="px-3 py-1.5 rounded-md bg-theme-500 text-white text-sm">
          重试
        </button>
      </div>
    );
  }
  if (!data) return <div className="p-6 text-sm opacity-70">加载中…</div>;

  const backupEntries = Object.entries(backups).filter(([, list]) => list.length > 0);

  return (
    <div className="space-y-5">
      <div className="rounded-md bg-theme-200/40 dark:bg-white/5 p-4 text-sm leading-6">
        <p className="font-semibold mb-1">上传配置文件 → 立即生效，不用重新拉取镜像</p>
        <ul className="list-disc pl-5 opacity-80 space-y-1">
          <li>
            支持 9 个文件：settings / services / bookmarks / widgets / docker / kubernetes / proxmox.yaml、
            custom.css、custom.js，<strong>文件名必须保持原样</strong>。
          </li>
          <li>
            可一次选多个（升级包解压后全选即可）。上传前自动做 YAML 语法与顶层结构校验，写盘前自动生成备份。
          </li>
          <li>
            写完后清除服务端缓存，首页通过 /api/hash 自动刷新；若浏览器缓存了旧样式，按 Ctrl+F5。
          </li>
          <li>
            只有升级程序代码（src/ 下的页面与 API）才需要换镜像；改书签、样式、部件配置都不需要。
          </li>
        </ul>
      </div>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          pick(event.dataTransfer.files);
        }}
        className={`rounded-md border-2 border-dashed p-6 text-center transition-colors ${
          dragging ? "border-theme-500 bg-theme-300/30" : "border-theme-400/60"
        }`}
      >
        <p className="mb-3 text-sm">把配置文件拖到这里，或</p>
        <label className="inline-block cursor-pointer px-3 py-1.5 rounded-md bg-theme-500 text-white text-sm">
          选择文件（可多选）
          <input
            type="file"
            multiple
            accept=".yaml,.yml,.css,.js"
            disabled={busy}
            className="hidden"
            onChange={(event) => {
              const selected = Array.from(event.target.files || []);
              event.target.value = "";
              pick(selected);
            }}
          />
        </label>
        <p className="mt-3 text-xs opacity-60">单文件上限 {formatBytes(data.maxBytes)}</p>
      </div>

      {pending.length > 0 && (
        <div className="rounded-md bg-theme-200/40 dark:bg-white/5 p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold text-sm">待上传（{pending.length}）</h2>
            <button onClick={clearPending} className="text-xs opacity-70 hover:opacity-100">
              清空
            </button>
          </div>
          <ul className="space-y-1 text-sm">
            {pending.map((item, index) => (
              <li key={`${item.file}-${index}`} className="flex flex-wrap gap-2 items-center">
                <span className={item.valid ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500"}>
                  {item.valid ? "✓" : "✕"}
                </span>
                <code>{item.file}</code>
                <span className="opacity-60 text-xs">{formatBytes(item.size)}</span>
                {!item.valid && <span className="text-xs text-rose-500">{item.error}</span>}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-3 items-center">
            <button
              onClick={upload}
              disabled={busy || !pending.some((item) => item.valid)}
              className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm disabled:opacity-40"
            >
              {busy ? "处理中…" : "上传并应用"}
            </button>
            <span className="text-xs opacity-60">{pending.filter((item) => item.valid).length} 个通过校验</span>
          </div>
        </div>
      )}

      {results.length > 0 && (
        <ul className="text-sm space-y-1">
          {results.map((entry, index) => (
            <li
              key={`${entry.file}-${index}`}
              className={entry.ok ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500"}
            >
              {entry.ok ? "✓" : "✕"} {entry.file}
              {entry.ok ? ` · 已生效${entry.backup ? `，备份 ${entry.backup}` : ""}` : ` · ${entry.error}`}
            </li>
          ))}
        </ul>
      )}
      {message && <div className="text-sm">{message}</div>}

      <div>
        <h2 className="font-semibold mb-2 text-sm">当前配置（{data.files.length}）</h2>
        <div className="overflow-x-auto rounded-md border border-theme-300/50 dark:border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-theme-200/50 dark:bg-white/5 text-xs">
              <tr>
                <th className="text-left p-2">文件</th>
                <th className="text-left p-2">用途</th>
                <th className="text-right p-2">大小</th>
                <th className="text-left p-2">更新时间</th>
                <th className="text-right p-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {data.files.map((entry) => (
                <tr key={entry.name} className="border-t border-theme-300/40 dark:border-white/10">
                  <td className="p-2 font-mono text-xs whitespace-nowrap">
                    {entry.name}
                    {!entry.exists && <span className="ml-1 text-xs opacity-60">（缺失）</span>}
                  </td>
                  <td className="p-2 text-xs opacity-80">{entry.desc}</td>
                  <td className="p-2 text-right text-xs">{formatBytes(entry.bytes)}</td>
                  <td className="p-2 text-xs whitespace-nowrap">{formatTime(entry.modified)}</td>
                  <td className="p-2 text-right whitespace-nowrap">
                    <button
                      onClick={() => download(entry.name)}
                      disabled={!entry.exists || busy}
                      className="px-2 py-1 rounded bg-theme-300/70 dark:bg-white/10 text-xs disabled:opacity-30"
                    >
                      下载
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="font-semibold mb-2 text-sm">备份与回滚（每个文件自动保留最近 {data.backupKeep} 份）</h2>
        {backupEntries.length === 0 ? (
          <p className="text-xs opacity-60">暂无备份。上传文件后会自动生成带时间戳的 .bak。</p>
        ) : (
          <div className="space-y-3">
            {backupEntries.map(([file, list]) => (
              <div key={file} className="rounded-md bg-theme-200/30 dark:bg-white/5 p-3">
                <div className="font-mono text-xs mb-2">{file}</div>
                <ul className="space-y-1">
                  {list.map((entry) => (
                    <li key={entry.name} className="flex flex-wrap items-center gap-2 text-xs">
                      <code className="break-all">{entry.name}</code>
                      <span className="opacity-60">
                        {formatBytes(entry.bytes)} · {formatTime(entry.modified)}
                      </span>
                      <button
                        onClick={() => restore(file, entry.name)}
                        disabled={busy}
                        className="ml-auto px-2 py-1 rounded bg-indigo-600 text-white text-xs disabled:opacity-40"
                      >
                        回滚
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs opacity-60">
        配置文件位于容器 /app/config（群晖挂载卷）。建议升级前先「下载」留档；回滚会先把当前内容再备份一次。
      </p>
    </div>
  );
}
