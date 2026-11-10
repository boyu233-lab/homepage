// R1 spike 对拍脚本：比较「现有 Next.js 页面 API」与「独立内容服务（shadow 端口）」的响应契约。
//
// 端点示例：
//   page   = http://127.0.0.1:3306  （v1.1.0 容器 /api/widgets/news）
//   shadow = http://127.0.0.1:3406  （node services/content-service/src/server.mjs）
//
// 用法：
//   node scripts/compare-news.mjs \
//     --page http://127.0.0.1:3306 --shadow http://127.0.0.1:3406 \
//     --out docs/R1-spike-对拍结果.json
//
// 退出码：0 = 全部 9 个源的 JSON 结构契约一致；1 = 有结构漂移或端点不可达。

import { writeFileSync } from "node:fs";

const SOURCES = ["baidu", "weibo", "zhihu", "toutiao", "douyin", "bilibili", "bing", "ithome", "sspai"];

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : fallback;
}

const PAGE = arg("page", "http://127.0.0.1:3306").replace(/\/+$/, "");
const SHADOW = arg("shadow", "http://127.0.0.1:3406").replace(/\/+$/, "");
const OUT = arg("out", "");

function typeSignature(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array<${value.length ? typeSignature(value[0]) : "empty"}>`;
  if (typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${key}:${typeSignature(value[key])}`)
      .join(",")}}`;
  }
  return typeof value;
}

function titles(payload) {
  return new Set((payload?.items || []).map((item) => item.title));
}

function jaccard(a, b) {
  if (!a.size && !b.size) return 1;
  let shared = 0;
  for (const value of a) if (b.has(value)) shared += 1;
  return shared / (a.size + b.size - shared || 1);
}

async function fetchJson(base, source) {
  const url = `${base}/api/widgets/news?index=3&source=${encodeURIComponent(source)}`;
  const started = Date.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const body = await response.json();
    return { status: response.status, body, ms: Date.now() - started, error: null };
  } catch (error) {
    return { status: 0, body: null, ms: Date.now() - started, error: error?.message || String(error) };
  }
}

function compare(source, page, shadow) {
  const issues = [];
  if (page.error || shadow.error) issues.push(`请求失败 page=${page.error} shadow=${shadow.error}`);
  if (page.status !== shadow.status) issues.push(`HTTP 状态不一致 ${page.status} vs ${shadow.status}`);
  if (!page.body || !shadow.body) {
    return {
      source,
      ok: false,
      issues,
      overlap: 0,
      pageItems: 0,
      shadowItems: 0,
      pageError: page.error,
      shadowError: shadow.error,
      pageMs: page.ms,
      shadowMs: shadow.ms,
      topLevelKeys: [],
    };
  }

  const pageKeys = Object.keys(page.body).sort().join(",");
  const shadowKeys = Object.keys(shadow.body).sort().join(",");
  if (pageKeys !== shadowKeys) issues.push(`顶层字段不一致: [${pageKeys}] vs [${shadowKeys}]`);

  const pageSig = typeSignature(page.body);
  const shadowSig = typeSignature(shadow.body);
  if (pageSig !== shadowSig) issues.push("字段类型签名不一致");

  if (JSON.stringify(page.body.availableSources) !== JSON.stringify(shadow.body.availableSources)) {
    issues.push("availableSources 不一致");
  }
  if (page.body.source !== shadow.body.source || page.body.sourceLabel !== shadow.body.sourceLabel) {
    issues.push("source / sourceLabel 不一致");
  }

  const pageItems = page.body.items || [];
  const shadowItems = shadow.body.items || [];
  for (const [label, items] of [["page", pageItems], ["shadow", shadowItems]]) {
    if (!items.length) continue;
    const firstKeys = Object.keys(items[0]).sort().join(",");
    for (const item of items.slice(1)) {
      if (Object.keys(item).sort().join(",") !== firstKeys) {
        issues.push(`${label}.items 条目字段不一致`);
        break;
      }
    }
    if (firstKeys !== Object.keys((label === "page" ? shadowItems : pageItems)[0] || {}).sort().join(",")) {
      if ((label === "page" ? shadowItems : pageItems).length) issues.push("两端 items 条目字段不一致");
    }
  }

  // 上游实时榜单会随时间变化，标题重合度只作为参考指标，不作为结构契约的硬性失败条件。
  const overlap = jaccard(titles(page.body), titles(shadow.body));
  return {
    source,
    ok: issues.length === 0,
    issues,
    overlap: Number(overlap.toFixed(3)),
    pageItems: pageItems.length,
    shadowItems: shadowItems.length,
    pageError: page.body.error || null,
    shadowError: shadow.body.error || null,
    pageMs: page.ms,
    shadowMs: shadow.ms,
    topLevelKeys: pageKeys.split(","),
  };
}

async function main() {
  console.log(`page   = ${PAGE}`);
  console.log(`shadow = ${SHADOW}\n`);
  const rows = [];
  for (const source of SOURCES) {
    const [page, shadow] = await Promise.all([fetchJson(PAGE, source), fetchJson(SHADOW, source)]);
    const row = compare(source, page, shadow);
    rows.push(row);
    console.log(
      `${row.ok ? "OK  " : "FAIL"} ${source.padEnd(9)} items ${String(row.pageItems).padStart(2)}/${String(row.shadowItems).padStart(2)}  overlap=${row.overlap}  ${row.pageMs}ms/${row.shadowMs}ms` +
        (row.issues.length ? `\n      ${row.issues.join("\n      ")}` : ""),
    );
  }

  const okCount = rows.filter((row) => row.ok).length;
  const result = {
    generatedAt: new Date().toISOString(),
    page: PAGE,
    shadow: SHADOW,
    sources: SOURCES.length,
    contractPassed: okCount,
    contractFailed: SOURCES.length - okCount,
    allPassed: okCount === SOURCES.length,
    averageOverlap: Number((rows.reduce((sum, r) => sum + r.overlap, 0) / rows.length).toFixed(3)),
    averagePageMs: Math.round(rows.reduce((sum, r) => sum + r.pageMs, 0) / rows.length),
    averageShadowMs: Math.round(rows.reduce((sum, r) => sum + r.shadowMs, 0) / rows.length),
    rows,
  };
  if (OUT) {
    writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(`\n结果已写入 ${OUT}`);
  }
  console.log(`\n契约一致 ${okCount}/${SOURCES.length}，平均标题重合度 ${result.averageOverlap}，平均耗时 ${result.averagePageMs}ms / ${result.averageShadowMs}ms`);
  if (!result.allPassed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
