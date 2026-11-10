# 独立内容服务（R1 spike / shadow 端口）

> ⚠️ **这是架构验证用的最小原型，不是生产组件，也不参与 v1.1.0 镜像构建。**
> 目的：用实测数据回答「把热榜 / B站逻辑从 Homepage 的 81MB 镜像里剥出来是否划算」。

## 它是什么

一个只用 **Node 原生 `http` + `xml-js`** 的最小服务，把 `src/pages/api/widgets/news.js`
里的解析与缓存逻辑**逐字搬运**到 `src/news-core.mjs`，在 shadow 端口暴露同一个响应契约：

```
GET /api/widgets/news?index=3&source=weibo   → 与页面 API 同结构的 JSON
GET /healthz                                 → 运行状态、请求数、上游抓取次数、RSS 内存
```

没有 Next.js、没有 `utils/*` 路径别名、没有配置文件读取、没有数据库、没有新依赖。

## 为什么逻辑能"逐字"搬运

`news.js` 从 `const DEFAULT_SOURCE` 到 `async function handler` 之间是一段纯函数代码：
只依赖 `xml-js`、`fetch`、`AbortSignal`、`URL`。`withAuth` / 配置读取 / 日志 / handler
都在这一段之外。`scripts/sync-news-core.mjs` 按这个边界自动抽取并生成 `news-core.mjs`：

```bash
# 重新生成（改了 news.js 的解析逻辑后运行）
node scripts/sync-news-core.mjs

# 只校验是否漂移（可放进 CI）
node scripts/sync-news-core.mjs --check
```

`--check` 退出码 1 表示两份逻辑已漂移，可用于防止"独立服务和主页各改各的"。

## 运行

spike 阶段直接复用仓库根的 `node_modules`（`xml-js`），不单独安装依赖：

```bash
node services/content-service/src/server.mjs
# 默认 127.0.0.1:3406
CONTENT_SERVICE_PORT=3406 node services/content-service/src/server.mjs
```

## 对拍

```bash
# 另一端是 v1.1.0 容器（需挂载配置目录）
docker run -d --name hp-v110-smoke -p 3306:3000 -v <config-dir>:/app/config \
  -e NEXTAUTH_URL=http://127.0.0.1:3306 \
  -e NEXTAUTH_SECRET=... \
  -e HOMEPAGE_ALLOWED_HOSTS=127.0.0.1:3306,localhost:3306 \
  boyu233/homepage-bookmark-manager:v1.1.0

node scripts/compare-news.mjs \
  --page http://127.0.0.1:3306 --shadow http://127.0.0.1:3406 \
  --out docs/R1-spike-对拍结果.json
```

比较维度：HTTP 状态、顶层字段集合、递归字段类型签名、`availableSources` 深度相等、
`items` 条目字段集合、标题集合 Jaccard 重合度、两端耗时。契约不一致时退出码 1。

## 明确没做的事（留给 v2.0 决策）

- 没有把 `bilibili_music` / `bilibili_pages` / `bilibili_audio` / `utils/bilibili-view.js` 也搬进来（Step1 的全部范围）
- 没有同源反代配置（生产需在 Nginx 把 `/api/widgets/*` rewrite 到本服务）
- 没有鉴权、限流、持久化、健康检查告警 —— spike 只验证"能不能独立跑、契约是否一致"
- 没有独立 Dockerfile / 镜像，避免把结论建立在未经验证的打包方案上

结论与量化数据见 [`docs/R1-spike-报告.md`](../../docs/R1-spike-报告.md)。
