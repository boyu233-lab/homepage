# 变更日志（Homepage 书签管理版 / boyu233-lab/homepage fork）

版本号规则：`主版本.次版本.修订号`。本文件随 git tag 一起发布，`VERSION` 文件保存当前版本号。
上游 `package.json` 的 `2.6.0` 是 Homepage 上游版本，**不是本 fork 的发布版本**，不要混用。

---

## v1.0.1 — 2026-11-09

**定位**：新闻部件从「RSS 新闻聚合」改为「百度热搜榜」（纯榜单）。改的是组件代码，**必须换镜像**。

### 变更

| 模块 | 内容 |
|---|---|
| 数据源 | 改为百度热搜官方 JSON 接口 `top.baidu.com/api/board?platform=pc&tab=realtime`，服务端代理抓取；移除全部 RSS 源与并发聚合逻辑 |
| 榜单展示 | 置顶条目（↑）+ 排名 1..50；前三名红/橙/黄徽标；右侧热度（如 `780.8万`）；「新 / 沸 / 热」角标；悬停显示摘要；工具栏显示榜单更新时间 |
| 更新频率 | 服务端缓存 60 秒（原 5 分钟），前端默认 60 秒自动刷新，手动刷新按钮保留 |
| 来源筛选 | 移除（只有单一榜单），不再读写 `localStorage["homepage.newsSource"]` |
| 安全 | 接口地址固定不可配置（避免 SSRF）；链接只接受 http(s)；标题/摘要由 React 转义；上游失败返回空列表 + 错误标记，不抛出 |
| 配置模板 | `src/skeleton/widgets.yaml` 与 `deploy/config-template/widgets.yaml` 同步为 `label: 百度热搜` / `limit: 10` / `refreshInterval: 60000` |

### 为什么要改

- 内置 `sina` / `sina-tech` RSS 分别在 **2018-09-23**、**2016-06-06** 之后停更，HTTP 仍返回 200；前端时间格式不带年份，看起来像「今年 9 月 23 日」。
- 百度 RSS（`civilnews` 等）是低频「焦点精选」，实测 40+ 分钟首条不变；且每条 `pubDate` 都是**抓取时刻**，按时间倒序排序时会霸占「全部」前 8 条，把真新闻挤下去，表现为「时间一直很新、内容一直不换」。
- 百度热搜榜分钟级更新，实测 1 小时内榜单顺序与条目已变化，并带真实 `updateTime`。

### 升级 / 兼容性

1. **必须换镜像**：删 NAS 旧镜像 → 重拉 `:v1.0.1`（或 `:latest`）→ 重建项目 → Ctrl+F5。只覆盖配置文件无效。
2. `custom.js` / `custom.css` **不用动**：榜单复用现有 `.news-list` / `.news-source-badge` / `.news-item-time` 样式，排名与角标颜色用内联样式，不新增 CSS 依赖。`limit` 从 8 变 10 会让窗口变高，`ResizeObserver` 会自动重测，分组卡片区对齐仍有效。
3. **旧环境变量失效**：`HOMEPAGE_NEWS_SOURCES`、`HOMEPAGE_NEWS_FEEDS`、`news.url` 不再被读取；留在 compose 里不会报错，建议删掉。
4. 建议把用户配置目录 `widgets.yaml` 的 `news` 段改成 `label: 百度热搜` / `limit: 10` / `refreshInterval: 60000`（不改也能跑，只是标题仍显示「实时新闻」、只铺 8 条、5 分钟刷新）。
5. 自检 `/api/widgets/news?index=3`：应返回 `boardName: "热搜榜"`、`feedNames: ["百度热搜"]`、`items[0].isTop: true`、条目带 `rank` / `hotScore`；若 `feedNames` 仍有「百度新闻 / 新浪国内」，说明还是 v1.0.0 镜像。

### 已知限制

- 依赖容器出网访问 `top.baidu.com`；离线或被拦截时显示「热搜暂不可用，稍后会自动重试」，其余功能正常。
- 条目链接是百度搜索结果页，不是新闻原文（与官方热搜榜行为一致）。
- 接口是百度未公开承诺的 Web 接口，上游改版需同步调整解析。

### 发布坐标

- 镜像：`boyu233/homepage-bookmark-manager:v1.0.1` = `:latest` = `:sha-PENDING`
- Digest：`PENDING`（构建推送后回填）
- 代码：git tag `v1.0.1`，分支 `dev` / `feat/bookmark-manager`

---

## v1.0.0 — 2026-11-07（首个定版）

**定位**：功能冻结、临时定版。可直接用于群晖 NAS 全新部署与已有部署升级。

### 已包含能力

| 模块 | 内容 |
|---|---|
| 书签管理 | 可视化编辑 + YAML 源码双模式，`/manage` 保存后即时刷新首页；写接口需登录，首页与读接口公开 |
| 鉴权 | NextAuth 4 凭据登录；`HOMEPAGE_AUTH_ENABLED` / `HOMEPAGE_AUTH_PASSWORD` / `NEXTAUTH_SECRET` / `NEXTAUTH_URL`；`HOMEPAGE_ALLOWED_HOSTS` 控制 Host 校验白名单，`HOMEPAGE_EXTERNAL_URL` / `NEXTAUTH_URL` 的 host 自动信任 |
| 搜索 | 百度 / Bing / Google / DuckDuckGo / Brave 多引擎切换，新标签打开 |
| 时间与新闻 | 中文大号加粗时间；首页常驻新闻列表（非下拉窗口），来源标签筛选、手动刷新、选择记忆 |
| 新闻来源 | 内置 `baidu` / `sina` / `ithome` / `sspai` / `sina-tech`；`HOMEPAGE_NEWS_SOURCES` 挑选内置源，`HOMEPAGE_NEWS_FEEDS` / `news.url` 自定义 RSS；服务端并发拉取、缓存、去重、排序 |
| 首页布局 | 左侧「首页」虚拟组；搜索 → 时间 → 新闻上下居中堆叠；左侧导航竖排、距顶部固定（`top: clamp(180px, 36vh, 380px)`），切换分组不跳动 |
| 分组对齐 | 非首页视图的卡片区与首页新闻窗口同起点、同高度（`--news-panel-top` / `--news-panel-height`，`ResizeObserver` 自动重测） |
| 群晖部署 | `deploy/synology-compose.yaml` 一行镜像部署；内置脱敏 `src/skeleton` 配置；入口脚本不覆盖用户已有配置；离线 tar 导入方案 |
| 浏览器扩展 | Chrome / Edge MV3，接管新标签页与启动页，仅申请 `storage` 权限，无预置地址、无遥测 |
| 脱敏 | 仓库、镜像、YAML、文档中的私有地址、标签、口令、密钥均已清除，仅保留公开演示地址与 `CHANGE_ME` 占位符 |

### 发布坐标

- 镜像：`boyu233/homepage-bookmark-manager:v1.0.0` = `:latest` = `:sha-91876c4`
- Digest：`sha256:a47d668b463b1cfc6d73056d26dd6bf27bd1bbc11f20121501ae2538116cfe16`（`linux/amd64`）
- 代码：git tag `v1.0.0`，分支 `dev` / `feat/bookmark-manager`
- 离线归档：`homepage-release-v1.0.0/`（含源码快照、定版配置、部署 YAML、离线镜像 tar、扩展、升级包、预览页、校验清单）

### 已知限制 / 注意事项

1. **配置层改动不会随镜像自动生效**：`docker-entrypoint.sh` 只在配置文件缺失/为空/与官方 baseline 一致时复制 `src/skeleton`。已有部署升级布局，必须覆盖 `custom.js` + `custom.css` 再 Ctrl+F5；组件代码改动则必须换镜像。
2. 组件代码改动（`src/pages/api/widgets/news.js`、`src/components/widgets/news/news.jsx` 等）**必须重建并更换镜像**，只覆盖配置无效。
3. 镜像仅构建 `linux/amd64`，ARM 机型需自行构建。
4. 新闻依赖容器出网拉 RSS；离线环境新闻区会停留在加载态，其余功能正常。
5. 本机无头浏览器截图不可用，布局预览以 `homepage-layout-preview.html` 与真机 Ctrl+F5 为准。
6. 上游 Homepage 的 `package.json` 版本为 `2.6.0`，与本 fork 版本号独立。

### 升级 / 回滚

- 已有部署：`homepage-panel-align.zip` 覆盖 `custom.js` + `custom.css` → Ctrl+F5；若需新版组件代码，删 NAS 旧镜像重拉 `:v1.0.0` 后重建项目。
- 回滚：YAML 的 `image` 改成 `:sha-2b2a4c3`（导航固定但未做卡片区对齐）或更早的 `:sha-4d61e9b`，重建项目。

---

## 开发阶段记录（v1.0.0 之前，未单独发版）

### 2026-11-03 — 项目起步
- fork `gethomepage/homepage`，本地部署调试；整理书签/服务/组件配置，产出第一版可视化布局。
- 发现右下角「管理书签」与「在线壁纸」按钮重叠，形成《项目完善升级方案》。

### 2026-11-04 — 鉴权、脱敏、可视化管理
- 实现书签可视化编辑与 YAML 源码双模式、原子写入与时间戳备份；`/manage` 加登录保护。
- Host 校验白名单、fail-closed 的 NextAuth 配置；修复局域网 IP 被 400 Host validation 拒绝。
- 全面脱敏：清除私有书签地址、内网 NAS 地址、标签、明文口令；GitHub 与镜像内仅保留公开演示地址。

### 2026-11-05 — 部署文档与镜像
- 生成群晖 Compose YAML 与部署方法、上线验收清单；修复 GitHub 推送历史中的残留敏感信息。
- 排查 CRLF 导致 `docker-entrypoint.sh` 启动失败、代理与 Docker Hub 推送、corepack / pnpm 下载等问题。

### 2026-11-06 — 扩展、多引擎搜索、时间、新闻
- 实现 Chrome / Edge MV3 新标签页扩展。
- 首页新增多引擎搜索、中文时间、实时新闻部件（首版为轮播 + 下拉窗口），新增 RSS 服务端代理与 `HOMEPAGE_ALLOWED_HOSTS` / `NEXTAUTH_URL` 外网访问说明。
- 镜像内置脱敏 `src/skeleton` 配置，入口脚本改为不覆盖用户自定义配置；离线 tar 与加速源方案落地。

### 2026-11-07 — 布局定版
- 新闻改为首页常驻列表 + 来源筛选，来源可通过环境变量选择（提交 `4d61e9b` / `6fb82a8`）。
- 左侧导航改为固定位置，切换分组不再上下跳动（提交 `2b2a4c3` / `463bd85`）。
- 分组卡片区与首页新闻窗口同起点同高度（提交 `91876c4` / `2b3006f`）。
- 完成全量 ESLint / 1982 用例 / 容器内构建 / 镜像 digest 核验，打 `v1.0.0` 定版并归档。
