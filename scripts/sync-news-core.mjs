// R1 spike 可复现脚本：从 src/pages/api/widgets/news.js 逐字抽取「框架无关」的核心逻辑，
// 生成独立内容服务用的 news-core.mjs。
//
// 抽取范围：从 `const DEFAULT_SOURCE` 到 `async function handler` 之前。
// 这一段只依赖 xml-js 与标准 Web API（fetch / AbortSignal / URL），不依赖 Next.js、
// 不依赖 utils/* 别名、不读写配置文件，因此可以在裸 Node 进程里直接跑。
//
// 用途：证明 Step1「把热榜逻辑搬进独立服务」是纯搬运而非重写；
// 今后 news.js 改了解析逻辑，重跑本脚本即可让内容服务同步，并可用 compare-news.mjs 对拍。
//
// 用法：node scripts/sync-news-core.mjs [--check]
//   --check 只校验已生成文件是否与当前 news.js 一致，不写文件（退出码 1 表示漂移）。

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(root, "src/pages/api/widgets/news.js");
const targetPath = join(root, "services/content-service/src/news-core.mjs");

const START = 'const DEFAULT_SOURCE = "baidu";';
const END = "async function handler(req, res) {";

const source = readFileSync(sourcePath, "utf8");
const start = source.indexOf(START);
const end = source.indexOf(END);
if (start < 0 || end < 0 || end <= start) {
  throw new Error("news.js 结构已变化，无法自动抽取；请人工核对抽取边界");
}

const body = source.slice(start, end).trimEnd();
const header = `// 由 scripts/sync-news-core.mjs 从 src/pages/api/widgets/news.js 自动抽取，请勿手改。
// R1 spike：验证「热榜逻辑可以脱离 Next.js 独立运行」，本文件与页面 API 的解析逻辑逐字一致。
// 唯一改造是把 ESM 别名依赖换成 createRequire 加载 xml-js（CJS），并补一个 loadSource 导出。
//
import { createRequire } from "node:module";

const { xml2js } = createRequire(import.meta.url)("xml-js");

`;
const footer = `
// 页面 API 只在模块内部使用 loadSource；独立服务需要显式导出。
export { loadSource };
`;
const generated = `${header}${body}\n${footer}`;

if (process.argv.includes("--check")) {
  const current = readFileSync(targetPath, "utf8");
  if (current !== generated) {
    console.error("news-core.mjs 与 news.js 已漂移，请重跑 node scripts/sync-news-core.mjs");
    process.exit(1);
  }
  console.log("news-core.mjs 与 news.js 抽取段完全一致");
  process.exit(0);
}

writeFileSync(targetPath, generated, "utf8");
console.log(`已生成 ${targetPath}（${generated.split("\n").length} 行，抽取段 ${body.split("\n").length} 行）`);
