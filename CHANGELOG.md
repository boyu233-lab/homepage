# 变更日志（Homepage 书签管理版 / boyu233-lab/homepage fork）

版本号规则：`主版本.次版本.修订号`。本文件随 git tag 一起发布，`VERSION` 文件保存当前版本号。
上游 `package.json` 的 `2.6.0` 是 Homepage 上游版本，**不是本 fork 的发布版本**，不要混用。

---

## v1.0.5 — 2026-11-09

**定位**：修正「歌单」的语义 —— 原来把 **B站搜索结果**（不同标题的视频）当成歌单，播放时只取每个视频的第 1 个分P；现在点开一个视频后，歌单是该视频的 **「视频选集」全部分P**（同一个标题下 131 首，每首有独立 cid 与曲名），可逐首点播、切歌、自动连播。组件层 + 配置层同时改动：**必须换镜像，并同步 `custom.css`**。

### 变更

| 模块 | 内容 |
|---|---|
| 选集接口 | 新增 `/api/widgets/bilibili_pages`：`wbi/view` 取 `data.pages`（page / cid / part / duration）与视频标题，服务端缓存 24 小时、`force=1` 可刷新；只接受合法 bvid，链接按 `?p=N` 拼接，分P名剥 HTML 标签，非法 cid 过滤，单P视频用顶层 cid 兜底 |
| 音频代理 | `/api/widgets/bilibili_audio` 新增 `cid` 参数，按指定分P取音轨；cid 必须存在于该 bvid 的选集中（防任意 cid 取流），不传时兼容旧行为播第 1 个分P。共享解析逻辑移到 `src/utils/bilibili-view.js`，选集与音频两处同源 |
| 播放交互 | 搜索结果 → 点开某个视频 → 进入该视频的选集：播放器显示当前分P曲名、`x / 131`、上一个 / 下一个 / 播完自动下一首；歌单常驻、当前分P高亮、每页 20 首可翻页、每首可直达 B站对应分P；「返回搜索结果」回到视频列表，「停止」只停播放不清歌单 |
| 样式 | `custom.css` 新增 `.bili-playlist-bar`（返回 + 合集标题）；`custom.js` 与 `widgets.yaml` 的布局 / 结构不变 |
| 测试 | 新增 / 更新 4 个定向测试文件，**49/49 通过**，定向 ESLint 0 错误；覆盖分P解析、cid 白名单、切P播放、歌单高亮、分页、音量锁定 |

### 升级 / 兼容性

1. **必须换镜像**：`:v1.0.5`（或离线导入 `homepage-image-v1.0.5.tar`）。选集解析与歌单逻辑在镜像代码里，只改配置文件无效。
2. **必须覆盖 `custom.css`**（升级包内已含，LF）。也可备份 `custom.js` 的 `WALLPAPER_*` 后删掉 `custom.css`，重启容器由内置 skeleton 补齐。
3. **不用动**：`custom.js`、`widgets.yaml`、`settings.yaml`、`services.yaml`、**`bookmarks.yaml`**。
4. **Ctrl+F5** 强刷。
5. 自检：搜「纯音乐」→ 点第一条「百听不厌的120首纯音乐」→ 歌单应显示「01.晚星 - 逆时针向 / 02.夏恋 - Otokaze / …」共 131 首；点「02」后播放器标题与 `?cid=` 同步变化。

### 已知限制

沿用 v1.0.4：音频经 NAS 转发占用出网带宽、免登录最高约 184kbps、极少数分P无独立音轨、个别浏览器可能拦截带声音的自动播放。新增：B站 `wbi/view` 若返回风控（`-352`），选集显示「选集读取失败」，稍后点刷新即可；分P很多时歌单分页（每页 20 首）。全量 ESLint + Vitest 按此前取消未重跑，以定向测试 + 容器内链路冒烟为准。

### 发布坐标

> 构建发布后回填（镜像 digest、commit、离线 tar sha256、冒烟结果）。

---

## v1.0.4 — 2026-11-09

**定位**：按反馈一次性修好首页音乐部件的三处体验问题 —— 窗口错位、播放时歌单消失、切歌音量回弹；并把首页两栏**改成上下堆叠**（热搜在上、音乐在下，各占满整行）。组件层 + 配置层同时改动：**必须换镜像，并同步 `custom.css` / `custom.js` 两个配置文件**。

### 变更

| 模块 | 内容 |
|---|---|
| 布局修复 | 上游 `index.jsx` 的 `rightAlignedWidgets` 不含 `bilibili_music`，该部件其实是 `#widgets-wrap` 的直接子节点，被旧规则绝对定位到左上角（缩小、半透明、压住搜索框）。改法：`#information-widgets-right` 设 `display:contents` 把容器打平，所有部件统一成为 `#widgets-wrap` 的网格项，再用 `order` 固定顺序；B站部件挂在左栏还是右栏，排布结果都一致 |
| 上下堆叠 | `#widgets-wrap` 改为单列网格：搜索框 → 大号时间 → 多源热搜 → B站搜索播放依次向下，每块占满 `min(1240px, 96%)`；窄屏只收窄整体宽度，顺序不变 |
| 歌单常驻 | 点选播放后不再把结果列表替换成播放器：播放器在上、歌单在下同时显示，当前曲目高亮，可直接点其它条目切歌；播放视图的「返回结果」改为「停止」；歌单限高 245px 可滚动 |
| 音量锁定 | 原生 `<audio>` 每首歌重新挂载会回到 100%。现在用户调整一次音量 / 静音后写入 `homepage.bilibiliVolume` / `homepage.bilibiliMuted`，之后每次挂载与开始播放自动应用该值；切歌、自动下一首、刷新页面都不再回弹 |
| 分组对齐 | 上下堆叠后 `custom.js` 只测量热搜窗口作为分组卡片区的对齐基准，音乐面板变高不再把卡片区越拉越长 |
| 测试与验证 | 部件组件定向 **14/14 通过**（新增歌单常驻、点歌切歌、音量锁定 3 例）、定向 ESLint 0 错误；用真实 DOM + 无头浏览器对照验证：修复前音乐窗口 `top:8 / left:4`，修复后热搜 `top:176`、音乐 `top:448`（同宽 1240px） |

### 升级 / 兼容性

1. **必须换镜像**：`:v1.0.4`（或离线导入 `homepage-image-v1.0.4.tar`），先删 NAS 旧镜像再拉。
2. **必须同步两个配置文件**：`custom.css`、`custom.js`。`widgets.yaml`、`settings.yaml`、`services.yaml`、尤其 **`bookmarks.yaml` 不用动**。
   - 最省事：备份 `custom.js` 里自定义的 `WALLPAPER_*` 图源 → 删掉 `custom.css` + `custom.js` → 重启容器由内置 skeleton 自动补齐 → 再把自定义图源填回去。
   - 也可直接从升级包覆盖这两个文件，然后 Ctrl+F5。
3. **Ctrl+F5** 清掉浏览器缓存的旧 CSS / JS。
4. 自检：热搜在上、音乐在下；点任意结果后歌单仍在且当前项高亮；把音量调到 30% 再点「下一个」，音量仍为 30%；DOM 里没有 `iframe`。

### 已知限制

沿用 v1.0.3：音频经 NAS 转发占用出网带宽、免登录最高约 184kbps、少数视频无独立音轨、个别浏览器可能拦截带声音的自动播放。本版未引入新限制。全量 ESLint + Vitest 按此前取消未重跑，以定向测试 + 容器内链路冒烟为准。

### 发布坐标

- `:v1.0.4` = `:latest` = `:sha-b0d1eaf`，digest `sha256:c95bdefdf032489574532241b8548171e21a0e02cfa2519d0131c50e3a11e163`（Registry API 核验三标签一致，linux/amd64）
- 代码 commit `b0d1eaf`、git tag `v1.0.4`，分支 `dev` / `feat/bookmark-manager`
- 离线镜像 `homepage-image-v1.0.4.tar`（81 MB，sha256 `506492f0cab4dc3a36372da05ae0fccc2aff79aa4aa05266a5c8d0d45094ba70`）
- 容器内冒烟：首页 200、微博热搜 50 条 / 9 源、B站搜索「晴天」18 条、音频代理 `206 + audio/mp4 + Content-Range`、fMP4 `ftyp`
- 镜像内置 `custom.css` / `custom.js` sha256 与仓库三副本一致

---

## v1.0.3 — 2026-11-09

**定位**：按反馈把右侧 B站部件从「音乐区排行榜 + 视频画面」改成 **「输入关键词搜索 → 手动点选 → 只播放声音、不显示画面」**。左侧 9 源热榜、双栏布局、导航位置全部不变。组件层 + 配置层同时改动：**必须换镜像，且必须同步三个配置文件**。

> v1.0.2 条目里「B站没有公开音频流接口、未做音频流代理」的已知限制，本版已通过服务端同源代理解决。

### 变更

| 模块 | 内容 |
|---|---|
| 搜索 | `bilibili_music.js` 从音乐区排行榜改为 B站视频搜索：`api.bilibili.com/x/web-interface/wbi/search/type?search_type=video`（完整浏览器 UA 下**免登录**可用，容器内实测 `code=0` / 每页 20 条）。服务端剥离标题里的 `<em class="keyword">` 高亮标签与 HTML 实体，`bvid` 白名单校验、去重、上限 20 条，链接一律由服务端拼接；按「关键词 + 页码」独立缓存 10 分钟，手动刷新 `force=1` 可跳过（保留 60 秒最小间隔防风控） |
| 纯音频代理 | 新增 `/api/widgets/bilibili_audio`：`wbi/view` 取 `cid` → `playurl(fnval=16)` 取 DASH 音轨（免登录 3 档，自动选最高 184kbps 的 fMP4）→ 带 `Referer: https://www.bilibili.com/` **流式转发**给同源浏览器，透传 Range / 206 / Content-Range 以支持拖动进度。B站 CDN 对第三方 / 空 Referer 一律 403，所以浏览器不能直连，必须走容器代理 |
| 播放交互 | 页面里只有 `<audio controls>` + 音轨信息条 + 上一个 / 下一个 / 返回结果，**没有 iframe、没有封面、没有任何视频画面**；播放结束自动切下一首；音频加载失败给出提示；点击条目后才挂载 `<audio>`，符合浏览器自动播放策略 |
| 搜索体验 | 搜索框、最近搜索词（浏览器本地）、4 个示例关键词、结果分页（最多 10 页）、重新搜索按钮；未搜索时只显示输入提示，不请求上游、不自动出榜单 |
| 安全与隐私 | 关键词收敛（去控制字符 / 压缩空白 / ≤60 字）、页码 clamp 1–10、上游地址写死、`bvid` 白名单、CDN 域名后缀白名单（防 SSRF）、音轨地址只收 HTTPS、接口只放行 GET/HEAD；音频流由容器代理，浏览器不直连 B站 CDN，访客 IP / Referer 不暴露给 B站 |
| 兼容性 | widget key 沿用 `bilibili_music`、组件路径与 CSS 选择器不变，已部署的用户只换镜像也不会出现 `Missing`；`custom.js` 的双栏测量逻辑无需改动 |
| 配置模板 | `widgets.yaml`：`label: B站音乐`、`refreshInterval: 600000`；`custom.css` 新增搜索表单 / 最近搜索 / 分页 / 音频条样式，移除 iframe 播放器样式；三副本 sha256 一致 |
| 测试 | 新增 / 重写：搜索 API 12 例、音频代理 API 9 例、部件组件 12 例，连同 9 源热榜的 API 12 例 + 组件 9 例，本版定向 **54/54 通过**、定向 ESLint 0 错误 |

### 升级 / 兼容性

1. **必须换镜像**：`:v1.0.3`（或离线导入 `homepage-image-v1.0.3.tar`），先删 NAS 旧镜像再拉。
2. **必须同步三个配置文件**：`widgets.yaml` / `custom.js` / `custom.css`。最省事是备份 `custom.js` 的壁纸图源后删掉这三个文件，重启容器由内置 skeleton 自动补齐；**`bookmarks.yaml` 千万别删**。
3. **Ctrl+F5**。
4. 自检：
   - `/api/widgets/bilibili_music?index=4&q=%E6%99%B4%E5%A4%A9` → `query: "晴天"`、`items` ≤20、条目带 `bvid` / `rank` / `link`；
   - `/api/widgets/bilibili_audio?bvid=BV1BZbSzZEGT` → `206` 或 `200`、`Content-Type: audio/mp4`（非法 bvid 返回 400）；
   - 页面右侧显示搜索框，选中结果后出现音频控制条，DOM 里没有 `iframe`。
5. `settings.yaml` / `services.yaml` / `bookmarks.yaml` 不用动；compose 里的 `HOMEPAGE_NEWS_SOURCES` / `HOMEPAGE_NEWS_FEEDS` 仍建议删掉。

### 已知限制

- 音频流经过容器转发，播放期间会占用 NAS 的出网带宽（184kbps 档约 6 MB / 首 4 分钟曲目）；多人同时播放时按人数倍增。
- 免登录只能拿到 B站提供的 3 档 AAC 音轨（最高约 184kbps）；Hi-Res / 杜比 / 无损需要 `SESSDATA` 登录态，本版未做（也不需要账号）。
- 少数视频没有独立 DASH 音轨或已下架，会显示「音频加载失败」；换一条结果即可。
- 浏览器可能仍拦截带声音的自动播放：`<audio>` 是在用户点击后才挂载的，绝大多数浏览器会放行；万一被拦，手动点一下音频控件里的播放键。
- B站 CDN 强制校验 Referer，这是必须走服务端代理的原因；若上游改版（接口 / CDN 域名 / 签名策略），只需调整镜像里的解析与白名单，配置文件不用动。
- 全量 ESLint + Vitest 按此前取消未重跑；本版以定向测试 + 容器内真实链路冒烟为准。

### 发布坐标

- 镜像：`boyu233/homepage-bookmark-manager:v1.0.3` = `:latest` = `:sha-92da188`
- Digest：`sha256:da152802081424e2583835fab3ff126bb16dac5ece0fed9d698d380d32b4df25`（`linux/amd64`，Registry API 核验）
- 代码：commit `92da188`、git tag `v1.0.3`，分支 `dev` / `feat/bookmark-manager`
- 离线镜像：`homepage-image-v1.0.3.tar`（`docker load` 导入）

---

## v1.0.2 — 2026-11-09

**定位**：首页新增「B站音乐榜」部件（榜单 + 官方播放器内嵌播放），百度热搜与音乐榜改为左右并排；热榜部件升级为 **9 源标签切换**（百度 / 微博 / 知乎 / 头条 / 抖音 / B站热搜 + Bing / IT之家 / 少数派资讯）。组件层 + 配置层同时改动：**必须换镜像，且必须同步三个配置文件**。

### 变更

| 模块 | 内容 |
|---|---|
| 新增部件 | `bilibili_music`：服务端代理 B站音乐区排行榜（`ranking/v2?rid=3&type=all`），解析排名 / 标题 / UP主 / 时长 / 播放数 / 点赞数 / 分区；点击条目在当前页挂载 B站官方 `player.bilibili.com` iframe 播放 |
| 播放交互 | 播放器视图**替换**榜单（不叠加），带「榜单」返回、上一首 / 下一首循环切歌、在 B站打开；点击后才挂载 iframe，符合浏览器自动播放策略 |
| 多源热榜 | `news` 部件由单一百度热搜升级为 **9 源标签切换**：百度 / 微博 / 知乎 / 头条 / 抖音 / B站热搜（热榜类）+ Bing 资讯 / IT之家 / 少数派（资讯类）。工具栏单行横向滚动标签、不增加面板高度，选择记在浏览器；热榜显示排名 / 热度 / 新沸热角标，资讯显示文章发布时间。上游地址全部写死在服务端白名单，按源独立缓存，单源失败不影响其它源 |
| 首页布局 | `#information-widgets-right` 改为两列 grid：搜索框与中文时间跨整行，热搜 / 音乐各占一列；≤900px 回落单栏上下堆叠 |
| 分组对齐 | `custom.js` 同时观察两个面板，取联合外框（最小 top / 最大 bottom）写入 `--news-panel-top` / `--news-panel-height`，任一边变高都会重新对齐 |
| 安全与隐私 | 上游地址与 `rid` 写死不可配置（防 SSRF），请求只传来源 key、不传 URL；`bvid` 用 `/^BV[0-9A-Za-z]{10}$/` 校验，知乎用 URL 字符串提取 id 避免大整数精度丢失，链接一律服务端拼接或只收 http(s)；标题 / 摘要截断 + React 转义；榜单由容器代理，仅点播时浏览器才直连 B站 |
| 刷新周期 | 热榜 6 源服务端缓存 **60 秒**、资讯 3 源 **5 分钟**（按源独立 TTL）；**B站音乐榜 24 小时**（音乐区日榜按天更新）：`widgets.yaml` 的 `bilibili_music.refreshInterval: 86400000` 同时决定前端轮询与服务端缓存，TTL clamp 到 1 分钟 ~ 7 天，工具栏显示「更新于 MM/DD HH:mm」；手动刷新带 `force=1` 可跳过缓存重拉（保留 60 秒最小间隔防风控） |
| 配置模板 | `src/skeleton/` 与 `deploy/config-template/` 同步：`widgets.yaml` 新增 `bilibili_music` 段，`custom.js` / `custom.css` 更新双栏布局，三副本 sha256 校验一致；**多源标签是组件代码，不需要改 `widgets.yaml`** |
| 测试 | news API 12 例 + news 组件 10 例 + 音乐 API 10 例 + 音乐组件 9 例；本版定向 **40/40** 通过、定向 ESLint 0 错误。另用 9 个源的真实响应做过一次解析冒烟（分别 50 / 50 / 30 / 50 / 50 / 10 / 9 / 50 / 10 条） |

### 升级 / 兼容性

1. **必须换镜像**：重拉 `:v1.0.2` → 重建项目 → Ctrl+F5。只覆盖配置文件会出现 `Missing bilibili_music`。
2. **必须同步三个配置文件**：`widgets.yaml`、`custom.js`、`custom.css`。入口脚本不会覆盖已修改过的非空文件。最省事的做法：把挂载目录里这三个文件**删掉**（先备份 `custom.js` 里自定义过的 `WALLPAPER_*` 图源），重启容器，入口脚本会从镜像内置 skeleton 自动补齐 v1.0.2 版；**`bookmarks.yaml` 千万别删**。
   - 只换镜像不更配置 → 音乐部件不出现（旧 `widgets.yaml` 没有该段），首页仍是单栏热搜。
   - 只更配置不换镜像 → 页面显示 `Missing bilibili_music`。
3. `settings.yaml` / `services.yaml` / `bookmarks.yaml` 不用动；compose 里的 `HOMEPAGE_NEWS_SOURCES` / `HOMEPAGE_NEWS_FEEDS` 仍建议删掉（v1.0.1 起已失效）。
4. 自检 `/api/widgets/bilibili_music?index=4`：应返回 `boardName: "音乐榜"`、`feedNames: ["B站音乐榜"]`、`total >= 50`，条目带 `bvid` / `rank` / `link`（`https://www.bilibili.com/video/BV...`）。
5. 自检 `/api/widgets/news?index=3&source=weibo`：应返回 `sourceLabel: "微博热搜"`、`availableSources` 9 项、条目带 `rank` / `hotScore`；不带 `source` 参数时默认百度热搜。**旧镜像不认 `source` 参数会直接返回百度榜**。

### 已知限制

- 榜单依赖容器出网 `api.bilibili.com`。B站会把简写 / 自定义 UA 判为爬虫并返回 `code=-352`，因此统一使用完整 Chrome UA + 浏览器请求头（容器内实测从 `-352` 恢复为 `code: 0`、97 条）。若仍被风控或离线，显示「音乐榜暂不可用」，其余功能正常；上游失败不写缓存，下次请求会重试。
- 音乐榜默认 **24 小时**才更新一次是设计行为（日榜）；容器重启会清空内存缓存并立即重拉，工具栏刷新按钮也能提前重拉。
- 9 个来源都是各平台**未公开承诺的 Web / RSS 接口**，上游改版或加反爬会导致单个源不可用（其它源不受影响）。实测知乎网页版热榜 API 返回 401，因此改用其移动端官方 `api.zhihu.com/topstory/hot-list`；Bing 新闻 `format=rss` 已返回 HTML，因此改用必应搜索 RSS，其条目是**相关网页结果**而非新闻稿件列表。新浪系 / 百度新闻 RSS 仍是死源，未接回。
- 播放器是 B站官方 iframe，由**浏览器直连** B站，点播时会向 B站暴露访客 IP / Referer；榜单接口由容器代理，不暴露访客 IP。
- 浏览器禁止无手势自动播放，必须点一下榜单条目；部分浏览器还会拦 iframe 内自动播，此时再点播放器里的播放键即可。
- 「在 B站打开」跳视频页，不是纯音频；B站没有公开音频流接口，未做音频流代理（WBI 签名 + 防盗链 + CORS，易失效）。
- 接口是 B站未公开承诺的 Web 接口，上游改版需同步调整解析。

### 发布坐标

- 镜像：`boyu233/homepage-bookmark-manager:v1.0.2` = `:latest` = `:sha-cc55e97`
- Digest：`sha256:72395260b658a0beb17d8f58c164aa723ad6bd794c86f731acb38391dce59ceb`（`linux/amd64`，Registry API 核验）
- 代码：commit `cc55e97`、git tag `v1.0.2`，分支 `dev` / `feat/bookmark-manager`
- 离线镜像：`homepage-image-v1.0.2.tar`（`docker load` 导入）

---

## v1.0.1 — 2026-11-09

**定位**：新闻部件从「RSS 新闻聚合」改为「百度热搜榜」（纯榜单）。改的是组件代码，**必须换镜像**。

### 变更

| 模块 | 内容 |
|---|---|
| 数据源 | 改为百度热搜官方 JSON 接口 `top.baidu.com/api/board?platform=pc&tab=realtime`，服务端代理抓取；移除全部 RSS 源与并发聚合逻辑 |
| 榜单展示 | 置顶条目（↑）+ 排名 1..49（服务端上限 50 条，`limit` 默认只显示前 10 条）；前三名红/橙/黄徽标；右侧热度（如 `780.8万`）；「新 / 沸 / 热」角标；悬停显示摘要；工具栏显示榜单更新时间 |
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

- 镜像：`boyu233/homepage-bookmark-manager:v1.0.1` = `:latest` = `:sha-390aaa3`
- Digest：`sha256:678821c624cf4f572cceb7f5ca42c7964b31a993ff9f4299e5613338ee71616d`（`linux/amd64`，Registry API 核验三个标签一致）
- 代码：commit `390aaa3`、git tag `v1.0.1`，分支 `dev` / `feat/bookmark-manager`
- 离线镜像：`homepage-image-v1.0.1.tar`（`docker load` 导入）

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
