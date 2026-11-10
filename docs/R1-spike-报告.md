# R1 spike 报告：`news.js` 独立内容服务 + shadow 端口对拍

> 编制日期：2026-11-10　｜　基线：`v1.1.0`　｜　性质：**架构验证原型，不是生产变更**
> 对应方案《homepage-功能升级方案-v1.1-v2.0.md》第 4 节 v2.0 / R1 Step 1 的前置决策

---

## 1. 要回答的问题

方案建议中长期走 **R1 分层剥离**：把热榜 / B站等几乎自包含的内容 API 从 Homepage 的
81MB 镜像里抽成独立内容服务，主页壳仍可追上游。但「建议」需要证据，本 spike 只验证三个
可证伪的假设：

| # | 假设 | 验证方式 | 结论 |
|---|---|---|:--:|
| H1 | 热榜逻辑**可以脱离 Next.js 运行**，不需要重写 | 从 `news.js` 逐字抽取 391 行到 `news-core.mjs`，裸 Node 进程直接 import | ✅ 成立 |
| H2 | 独立服务对浏览器暴露的**响应契约与页面 API 一致** | shadow 端口与真实容器对拍 9 个源：HTTP 状态 / 顶层字段 / 递归类型签名 / `availableSources` / `items` 条目字段 | ✅ 成立（9/9） |
| H3 | 抽离后改内容功能**不再需要重建 81MB 镜像** | 统计改动面、依赖数、启动方式与产物体积 | ✅ 成立 |

---

## 2. spike 做了什么

```
services/content-service/
  src/news-core.mjs    403 行  ← 由 scripts/sync-news-core.mjs 从 news.js 自动抽取（逐字一致）
  src/server.mjs        86 行  ← Node 原生 http，无框架，暴露 /api/widgets/news 与 /healthz
  README.md                    ← 运行、同步、对拍说明
scripts/sync-news-core.mjs     ← 抽取 + --check 漂移校验（可放进 CI）
scripts/compare-news.mjs       ← 9 源契约对拍，输出 JSON 结果
```

**关键事实**：`src/pages/api/widgets/news.js` 从 `const DEFAULT_SOURCE` 到
`async function handler` 之间是一段纯函数代码，只依赖 `xml-js`、`fetch`、
`AbortSignal`、`URL` —— 没有 `withAuth`、没有 `utils/*` 路径别名、没有配置读取、没有日志。
`withAuth` / `getPrivateWidgetOptions` / `createLogger` / handler 都在这一段之外。
因此**抽离是纯搬运，不是重写**。`sync-news-core.mjs --check` 可随时证明两份逻辑没有漂移。

---

## 3. 量化数据

| 指标 | 页面 API（现状） | 独立内容服务（spike） |
|---|---|---|
| 逻辑代码行数 | `news.js` 432 行 | `news-core.mjs` 403 行（其中抽取段 391 行，与页面 API 逐字一致） |
| 框架依赖数 | 5 个：`xml-js` + `utils/auth` + `utils/config/widget-helpers` + `utils/logger` + `utils/rate-limit` | 1 个：`xml-js`（用 `createRequire` 加载 CJS） |
| 运行载体 | Next.js 16 Pages Router，需 `pnpm build` + 81MB 镜像 | 裸 `node server.mjs`，无需构建 |
| 进程常驻内存（RSS） | 与整个 Homepage 共享（无法单独度量） | 61.2 MB（含 Node 运行时基线） |
| 冷启动到端口可用 | 容器启动 + Next 初始化（秒级） | 735 ms |
| 改一个热榜源要做什么 | 改 `src/` → 重建并推送 81MB 镜像 → 群晖重新拉取 | 改 `news-core.mjs` → 重启单进程（生产还应把源定义移到 YAML） |
| 上游抓取次数（对拍 9 源） | 页面端未埋点，抓取代码与 shadow 逐字相同 | shadow 实测 15 次（含前一轮预热；两端各自 60s / 5min 缓存策略一致） |

### 契约对拍结果

对拍命令：

```bash
node scripts/compare-news.mjs \
  --page http://127.0.0.1:3306 --shadow http://127.0.0.1:3406 \
  --out docs/R1-spike-对拍结果.json
```

| 指标 | 结果 |
|---|---|
| 参与对拍的源 | 9（baidu / weibo / zhihu / toutiao / douyin / bilibili / bing / ithome / sspai） |
| 结构契约通过 | 9 / 9 |
| 平均标题集合 Jaccard 重合度 | 1.000 |
| 平均响应耗时（页面 / shadow） | 424 ms / 188 ms |
| 机器可读结果 | `docs/R1-spike-对拍结果.json` |

> **对拍环境**：page 端为本地 `:v1.0.5` 容器（其 `news.js` 与 v1.1.0 逐字一致，v1.1.0 仅在外层增加
> `withPublicWidgetGuard`，不改变 JSON 响应契约）；shadow 端为裸 `node services/content-service/src/server.mjs`。
> 机器可读结果中的 `generatedAt` 为实际对拍时间。

> 说明：上游榜单是实时数据，两次抓取之间可能变化，因此**标题集合重合度只作参考**；
> 判定通过与否的是「HTTP 状态 + 顶层字段集合 + 递归字段类型签名 +
> `availableSources` 深度相等 + `items` 条目字段集合」这些结构契约。

---

## 4. 结论与决策建议

**H1 / H2 / H3 全部成立 → 建议把 R1 Step 1 列入 v2.0，但不要现在就合并进 v1.1。**

理由：

1. **技术上没有障碍**：逻辑逐字可搬、契约可对拍、裸 Node 可跑、不需要新框架或数据库。
2. **收益是结构性的**：Step 1 之后 B站与热榜的所有改动都不再触发 81MB 镜像重建，
   也不再受上游 DOM / class 变化影响（v1.0.4 的音乐窗口错位正是这类问题）。
   方案里 B1（热榜源配置化）、B2（历史热榜）、B3（续播收藏）、D5（模块可配）成本都会明显下降。
3. **但现在合并会破坏 v1.1 的发布边界**：v1.1 是安全硬化版，已明确「配置层完全兼容、
   tag 可一键回滚」。引入第二个容器会改变部署形态与回滚方式，应作为独立大版本。

### 建议的落地顺序（v2.0）

1. 把剩余 4 个自包含文件（`bilibili_music.js` / `bilibili_pages.js` / `bilibili_audio.js` /
   `utils/bilibili-view.js`）按同样方式抽进内容服务，逐字搬运 + 契约对拍。
2. `news.js` 改为薄壳：`import { loadSource } from "utils/news-core"`，
   保留 `withAuth` / 限流 / 日志在页面侧；用 `sync-news-core.mjs --check` 防止双份逻辑漂移。
3. 反代把 `/api/widgets/*` rewrite 到内容服务，保留 `/api/config/*` 等在主页壳。
4. 双容器 compose + 一键回退脚本：停掉内容服务时首页书签与卡片仍可显示（优雅降级）。
5. 内容服务单独发版（约几十 KB 应用层），主页镜像 tag 保持不变 —— 这就是验收指标。

### 风险（如实记录）

- **双份逻辑漂移**：spike 用 `--check` 脚本约束，但生产阶段应彻底删掉 `news.js` 里的副本，
  改为薄壳引用同一模块，而不是长期维护两份。
- **鉴权边界**：内容服务若直接暴露，会绕过 `withAuth` / 限流；生产必须只对同源反代开放，
  或在服务内复用同一套 guard。
- **缓存不共享**：两个进程各有自己的 60s / 5min 缓存，切换瞬间可能多打一次上游。
- **运维复杂度 +1**：多一个进程、多一套日志与回滚；单人 NAS 场景是否值得，取决于后续
  是否真的要持续加内容功能。若 v1.2 之后功能收敛，停在 R0 继续 fork 也完全合理。

---

## 5. 复现

```bash
# 1) 校验抽取逻辑与 news.js 一致
node scripts/sync-news-core.mjs --check

# 2) 启动 shadow 服务
CONTENT_SERVICE_PORT=3406 node services/content-service/src/server.mjs

# 3) 单独验证 shadow（应返回 50 条、9 个可用源）
curl -s "http://127.0.0.1:3406/api/widgets/news?index=3&source=baidu" | python -m json.tool | head

# 4) 启动含本版 news.js 的容器（务必挂载配置目录）后对拍；本次用 :v1.0.5，其新闻逻辑与 v1.1.0 逐字一致
node scripts/compare-news.mjs --page http://127.0.0.1:3306 --shadow http://127.0.0.1:3406
```

**本次 spike 未改动 `src/` 下任何生产代码、未改动镜像、未改动任何配置文件**；
新增文件全部位于 `services/`、`scripts/`、`docs/`，不参与 Next.js 构建与镜像组装。
