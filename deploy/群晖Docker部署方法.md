# 群晖 Docker 部署方法（Homepage 书签管理版）

> 配套 YAML：[`synology-compose.yaml`](./synology-compose.yaml)
> 适用：群晖 DSM 7.2+ / Container Manager，**x86_64 机型**（已发布的镜像是 `linux/amd64`）
> 本文与配套 YAML 均同步在 GitHub fork 的 `dev` 分支；镜像地址是已发布的实际地址，鉴权凭据与内网地址仍为占位符，不含真实口令、密钥或私有地址。

---

## 0. 先看这张表：`deploy/` 里几个文件别搞混

| 文件 | 用途 | 什么时候用 |
|---|---|---|
| **`synology-compose.yaml`** | **本次新增**：群晖项目向导直接粘贴，拉现成镜像，**推荐** | 已在 Docker Hub 有镜像时 |
| **`群晖Docker部署方法.md`** | **本次新增**：本文，完整操作步骤 | 照着做即可 |
| `docker-compose.yml` + `.env.example` | 旧模板：需要把仓库放到群晖上 `up -d --build` 本地编译，依赖 `.env` | 想在 NAS 上自己编译镜像 |
| `群晖部署清单.md` | 13 项上线验收矩阵、安全细则、回滚细则 | 上线前逐条核对 |
| `build-and-push.sh` / `.github/workflows/docker-publish-fork.yml` | 构建并推送镜像到 Docker Hub | 获取镜像 |

---

## 1. 四步走

```
① 拿到镜像  →  ② 在 NAS 建好配置目录并给权限  →  ③ Container Manager 新建项目、粘贴 YAML  →  ④ 启动并验收
```

导航页是**公开**的，只有 `/manage` 和写接口需要登录，所以部署完首页直接能看，管理入口登录后才会出现。

---

## 2. 前置条件

- DSM 7.2 及以上，套件中心已安装 **Container Manager**。
- **x86_64 CPU**。ARM 机型（部分 DS 入门款）需要自己把 workflow 的 `platforms` 改成 `linux/arm64` 重新构建，或走「群晖本地构建」。
- 群晖 `3000` 端口未被占用（被占用就改 YAML 左侧端口，如 `3001:3000`，右侧不能改）。
- 一个共享文件夹，例如 `/volume1/docker/homepage/`。
- 开启 SSH：控制面板 → 终端机和 SNMP → 勾选「启用 SSH 服务」（只用来改一次目录权限）。
- **脱敏后的配置文件**：`bookmarks.yaml`、`settings.yaml`、`services.yaml`、`widgets.yaml`、`kubernetes.yaml`、`proxmox.yaml`、`custom.js`、`custom.css`、`background.svg`。
  ⚠️ 不要把 `homepage-config-backup-*` / `homepage-test-config` 这类脱敏前备份传到 NAS 上或打进镜像。

---

## 3. 生成凭据（务必重新生成，不要复用开发期测试值）

在群晖 SSH 或本机 Git Bash 执行：

```bash
openssl rand -base64 32     # -> NEXTAUTH_SECRET，至少 32 位
openssl rand -base64 24     # -> HOMEPAGE_AUTH_PASSWORD
```

四个必需变量的含义：

| 变量 | 填什么 |
|---|---|
| `HOMEPAGE_AUTH_ENABLED` | 固定 `true` |
| `HOMEPAGE_AUTH_PASSWORD` | 上一步生成的强密码（只有密码框，没有用户名） |
| `NEXTAUTH_SECRET` | 上一步生成的随机值 |
| `NEXTAUTH_URL` | **浏览器地址栏里的完整地址**，例如 `http://192.168.1.100:3000` 或 `https://nav.example.com` |

`NEXTAUTH_URL` 必须与实际访问地址一致：`http` 还是 `https`、带不带端口都要对。写成 `https` 时会话 cookie 会启用 Secure 属性，走纯 HTTP 访问会登录不上。若通过反向代理用域名访问，同时把域名和内网 IP 都写进 `HOMEPAGE_ALLOWED_HOSTS`（详见 3.1）。

### 3.1 外网访问：两个 host 变量各管一件事

| 变量 | 管什么 | 填错的表现 |
|---|---|---|
| `HOMEPAGE_ALLOWED_HOSTS` | 进门的 **Host 白名单**（`src/proxy.js` 与 `src/utils/auth.js` 都会校验请求头 `Host`） | `400 {"error":"Host validation failed. See logs for more details."}` |
| `NEXTAUTH_URL` | NextAuth 的**对外基址**：登录后跳回哪里、cookie 是否 Secure 都由它决定（相对 `callbackUrl=/manage` 会被拼成 `NEXTAUTH_URL 的 origin + /manage`） | 登录成功却被送回 `http://192.168.1.100:3000`，或反复跳回登录页 |

`NEXTAUTH_URL` 里的 host 会被**自动信任**，不必再写进白名单；`HOMEPAGE_ALLOWED_HOSTS` 主要用来补「其它入口」和「反向代理改写后的 Host」。白名单的格式是 `域名[:端口]`，**不带 `http://`、不带路径、不带空格**，多个用英文逗号分隔，且必须与请求头里的 host 精确一致（含端口、大小写）。

**场景 A：外网 DDNS 域名 + 群晖反向代理 + HTTPS（推荐）**

```yaml
environment:
  NEXTAUTH_URL: "https://nav.example.com"
  HOMEPAGE_ALLOWED_HOSTS: "nav.example.com,nav.example.com:443,192.168.1.100:3000"
```

群晖 `控制面板 → 应用程序门户 → 反向代理`，目标填 `http://localhost:3000`，并在「自定义标头」里加：

- `X-Forwarded-Proto` = `https`
- `X-Forwarded-Host` = `nav.example.com`

`Host` 头要透传原始域名（nginx 对应 `$http_host`）。若群晖把它改写成了内网 IP，容器日志会打印实际收到值，见下方排查法。

**场景 B：直接把 3000 端口映射到公网 / DDNS + 端口**

```yaml
environment:
  NEXTAUTH_URL: "http://nav.example.com:3000"
  HOMEPAGE_ALLOWED_HOSTS: "nav.example.com:3000,192.168.1.100:3000"
```

**拿到 100% 准确的 Host**：被拒绝时容器日志会打印实际值，把冒号后面那串原样粘进白名单即可。

```bash
docker logs homepage 2>&1 | grep "Host validation failed"
# Host validation failed for: nav.example.com:3000
```

**协议必须唯一**：`secureCookie()` 依据 `NEXTAUTH_URL` 的协议决定 cookie 名（https → `__Secure-next-auth.session-token`，http → `next-auth.session-token`）。因此「外网 https 域名 + 内网 `http://IP:3000`」两边登录态不互通，且登录后一律回 `NEXTAUTH_URL` 那个地址。最省事的做法是**内外网都用同一个域名**（在路由器 / 本地 DNS 上把该域名解析到群晖内网 IP，或开启 NAT 回环），只保留一份地址、一份 cookie。

排错时可把 `HOMEPAGE_ALLOWED_HOSTS` 临时设为 `*` 全放行（源码支持），确认通了再收紧，不要在公网长期使用。

**改完必须重建容器**：Docker 的环境变量在容器创建时固定，`restart` 不会重新读取。Container Manager 里要「停止 → 清除 → 重新构建」，或 SSH 里 `docker compose up -d --force-recreate`；随后清掉浏览器该站点的 cookie（或用无痕窗口）再登录，并全程只用同一个地址。

---

## 4. 准备配置目录（书签能保存的关键）

**File Station**：在 `docker` 共享文件夹下新建 `homepage/config`，把第 2 节列出的脱敏配置文件上传进去。

**SSH 改权限**（容器内以 UID 1000 运行，目录不可写会导致管理页保存 500）：

```bash
sudo mkdir -p /volume1/docker/homepage/config
sudo chown -R 1000:1000 /volume1/docker/homepage/config
sudo chmod -R u+rwX /volume1/docker/homepage/config
```

> 每次在管理页保存，都会在配置目录生成 `bookmarks.yaml.时间戳.bak`（自动保留最近 10 份）。这些备份同样包含配置内容，别外传，定期清理即可。

---

## 5. 获取镜像（三选一）

### A. 直接拉取已发布镜像（推荐，当前可用）

> ✅ **2026-11-07 11:05 更新完成**：含「多引擎搜索 / 中文时间 / **首页常驻新闻列表 + 来源筛选**」的新版镜像已推送 Docker Hub，`:latest` 与 `:sha-4d61e9b` 两个标签均经 Registry API 核验。
> 当前 digest：`sha256:58b2c52c4498a79c8cc40111f4120a5ba4a9df10f1c827776933587ab00d1ec2`（377MB，`linux/amd64`）。
> - **升级已有部署**：删掉 NAS 上的旧镜像 → 重拉 `latest` → 重建项目，并按 **6.2 节**覆盖 `widgets.yaml` **和 `custom.css`**（入口脚本不会覆盖你已有的配置文件）。
> - 容器内实测 `/api/widgets/news?index=3` 返回 `feedNames: ["百度新闻","新浪国内","IT之家"]` 与 24 条新闻；**没有 `feedNames` 或返回 404 = 仍是旧镜像**。
> - 离线兜底：`homepage-image-20261107.tar`（81MB，含本次改动）按 **C 方案**导入。`homepage-image-20261106.tar` 是上一版（轮播 + 下拉窗口），不要用于本次升级。
> - 国内加速源可能仍缓存上一版，拉完请按 **8.1 节**核对 digest；不一致就等同步或改用 tar 导入。

镜像已构建并推送到 Docker Hub，**公开仓库、免登录**，`linux/amd64`，YAML 里已填好地址：

| 标签 | 用途 |
|---|---|
| `boyu233/homepage-bookmark-manager:latest` | 当前最新，配套 YAML 默认使用 |
| `boyu233/homepage-bookmark-manager:sha-4d61e9b` | 当前固定版本（**常驻新闻列表 + 来源筛选 + 内置脱敏定制配置**，见 6.1 / 6.2 节），回滚 / 复现用 |
| `boyu233/homepage-bookmark-manager:sha-cfea038` | 上一版（轮播一条 + 点击展开下拉窗口），需要回退时用 |

- 群晖：Container Manager → **映像 → 添加 → 从 URL 添加**，填 `boyu233/homepage-bookmark-manager:latest`；或 SSH `docker pull boyu233/homepage-bookmark-manager:latest`。
- 也可直接跳到第 6 节创建项目，Container Manager 会自动拉取。
- 当前镜像 digest：`sha256:58b2c52c4498a79c8cc40111f4120a5ba4a9df10f1c827776933587ab00d1ec2`（`latest` 与 `sha-4d61e9b` 指向同一镜像）。
- ⚠️ **2026-11-06 曾发布过一版有问题的镜像**（digest `sha256:89df5596…341d1b`，tag `:sha-2b5aefa`）：入口脚本带 CRLF，容器会无限重启并报 `exec /usr/local/bin/docker-entrypoint.sh: no such file or directory`。**如果之前拉过镜像，必须先删除 NAS 上的旧镜像再重建项目**，否则 Docker 会直接用本地缓存继续起坏容器。

**以后要更新镜像**：在 fork 的 **Settings → Secrets and variables → Actions** 添加 `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN`（Docker Hub **Access Token**，Read/Write 权限，不是登录密码），再在 **Actions** 手动运行 `Build & Push Docker image (fork)`，或推一个 `v*` tag 自动触发；也可以在本机执行 `deploy/build-and-push.sh`。官方 workflow 带 `if: github.repository == 'gethomepage/homepage'`，在 fork 里不会执行，所以本仓库自带这个 fork 专用 workflow。

> 国内直连 Docker Hub 拉不动时（典型报错 `dial tcp [2a03:2880:...]`），**先看第 8.1 节**：配置镜像加速后再拉，或改用下面的 C 方案导入本地 tar。镜像加速地址不要写进提交到 GitHub 的 YAML，保持 `YAML` 里的标准镜像名不变。

### B. 让群晖自己构建

在群晖 SSH 里 `git clone --branch dev --depth 1 <你的 fork 地址>`，把仓库放到项目目录，改用 `deploy/docker-compose.yml` + `.env` 启动（这份模板自带 `build` 段）。首次 `pnpm install` + `next build` 需要数分钟、建议内存 ≥ 2GB。

### C. 本机构建后导出 tar 上传（完全不依赖 Docker Hub）

```bash
docker build -t homepage-bookmark-manager:local .
docker save homepage-bookmark-manager:local -o homepage.tar
```

Container Manager → **映像 → 导入 → 上传** `homepage.tar`，导入后在「映像」里看实际名称，把 YAML 的 `image` 改成那个名称即可。

---

## 6. Container Manager 新建项目（图形界面步骤）

1. 打开 **Container Manager** → 左侧 **项目** → **新增**。
2. **项目名称**填 `homepage`；**路径**选 `/docker/homepage`（或你自己的目录）；**来源**选「**创建 docker-compose.yml**」。
3. 把 [`synology-compose.yaml`](./synology-compose.yaml) 的**全文粘贴**进编辑框。
   - 这份 YAML **不含 `${}` 变量**，所以不需要、也不要额外上传 `.env`；所有值直接写在 `environment` 里。
4. 改掉 3 类 `CHANGE_ME` 占位符和 `volumes` 左侧的群晖路径；确认 `NEXTAUTH_URL` 就是浏览器要访问的地址（镜像地址已填好，不用改）。
5. **下一步 → 完成**（勾选立即启动）。不同 DSM 版本可能多出「Web Station / 门户设置」一步，直接跳过即可。
6. 到 **容器 → homepage → 日志** 看启动输出；出现 Next.js 的 ready 日志后浏览器访问 `http://群晖IP:3000`。

> 项目创建后，填了真实口令的 YAML 会保存在 NAS 的项目目录里。按共享文件夹权限控制访问，不要把它复制进 Git 或截图外发。

---

## 6.1 定制配置已内置进镜像（自提交 `413f3e8` 起）

早期镜像只包含**代码**：在线壁纸按钮、左侧分组导航、极光瓷砖样式、深色紫色主题全在配置目录的 `custom.js` / `custom.css` / `settings.yaml` 里，而镜像内 `src/skeleton/` 是**空的官方默认**。首次部署时 Homepage 自动从 skeleton 拷贝，页面就变成「官方原版外观」（三个 `My First/Second/Third Group` 演示服务、纯色背景、无在线壁纸），常被误判成「拉错镜像」。

**现在已修好**：镜像内 `src/skeleton/` 换成了**已脱敏**的定制配置（Dockerfile 显式 COPY 覆盖 standalone 自带版本），入口脚本在启动时自动补齐旧部署遗留的默认文件。

| 场景 | 行为 |
|---|---|
| 全新部署（配置目录为空） | 应用自动从镜像内 skeleton 拷贝完整定制配置，开箱即有壁纸 / 导航 / 极光主题 |
| 旧部署（已有 0 字节 `custom.js` / `custom.css`，或官方默认 yaml） | 入口脚本只在「文件不存在 / 为空 / 与官方原版逐字节一致」时替换为内置定制版，日志打印 `Applied bundled default: xxx` |
| 用户自己改过的非空配置 | **一律不动**，包括自己的 `bookmarks.yaml` |

识别「官方原版」用的指纹存放在镜像 `/app/skeleton-official/`（仓库 `deploy/skeleton-official/`，即上游原版 skeleton）。内置书签是**脱敏演示版**（搜索引擎 / 社区与开发，仅百度、Google、GitHub 等公开地址），不含任何私有地址、标签或凭据。

> 升级步骤：**删掉 NAS 上的旧镜像 → 重新拉取 → 重建项目 → Ctrl+F5**，不用再手动上传任何配置文件。若重建后仍是官方外观，看容器日志有没有 `Applied bundled default:` —— 没有就说明拉到的还是旧镜像。
>
> custom.js / custom.css 有浏览器缓存，**Ctrl+F5 必须做**。

[`deploy/config-template/`](./config-template/) 保留作手动覆盖与自定义参考（改壁纸源、分组图标等），不再是必需步骤；模板刻意不含 `bookmarks.yaml`，避免覆盖自己的真实书签。

判断镜像是否为本 fork（在 NAS SSH 里）：

```bash
curl -i http://127.0.0.1:3030/manage | head -5
```

| 结果 | 结论 |
|---|---|
| `307` → `/auth/signin?...` | 镜像正确，只是缺配置，按上表补齐 |
| `404` | 拉到了官方 `gethomepage/homepage` 镜像；检查 compose 的 `image`，删掉 NAS 上旧镜像再重建 |

「管理书签」按钮属于镜像代码，但**仅登录后可见**：访问 `http://<NAS-IP>:3030/manage` 输入 `HOMEPAGE_AUTH_PASSWORD`，回到首页后**左下角**才出现该按钮。未登录时首页不显示任何管理入口，这是设计如此，不是功能缺失。

---

## 6.2 首页三个部件：多引擎搜索 / 时间 / 实时新闻

顶部信息条由 `widgets.yaml` 决定，首页视图的排版由 `custom.css` 接管。新版镜像内置了这两份配置，**全新部署自动生效**；已有部署因为配置文件已经存在（入口脚本刻意不覆盖用户改过的配置），需要按下面 4 步手动覆盖一次。

| 部件 | 怎么用 | 配置键 |
|---|---|---|
| 搜索框 | 输入框右侧图标点开，可切换 **百度 / Bing / Google / DuckDuckGo / Brave**；选择记在浏览器 localStorage，下次打开沿用。默认引擎是数组第一项（百度） | `search.provider`（数组） |
| 时间 | 显示「2026年11月7日星期六 10:52:00」，每秒更新 | `datetime` |
| 实时新闻 | **直接在首页铺开 8 条列表**（没有下拉浮层、不再轮播）：每条含来源徽标 + 标题 + 时间，点标题新标签打开原文；顶部「全部 / 百度新闻 / …」标签可切换来源，选择记在浏览器；5 分钟自动刷新，也可点刷新按钮 | `news` |

### 已有部署的升级步骤（必做）

1. 更新镜像（**常驻列表与来源筛选是新增组件代码，不换镜像不会出现**）：删掉 NAS 上的旧镜像 → 重新拉取 `boyu233/homepage-bookmark-manager:latest`（新 digest `sha256:58b2c52c…1ec2`）→ 重建项目。国内直连拉不动见 **8.1 节**换加速源；完全离线时用 `homepage-image-20261107.tar` 按 **5-C** 导入（导入后把 YAML 的 `image` 改成实际名称）。
2. 把新的 `widgets.yaml` **和 `custom.css`** 上传到配置目录（compose `volumes` 冒号**左侧**的宿主机路径），覆盖同名文件。**不要动 `bookmarks.yaml`**。可直接用随本次更新提供的 `homepage-layout-update.zip`（含 3 个定制文件 + 说明）。
3. Container Manager → 项目 → 停止 → 清除并重建（或 SSH `docker compose down && docker compose up -d`）。
4. 浏览器 **Ctrl+F5** 强制刷新。

### 自定义

- **换默认引擎**：把 `search.provider` 里想要的引擎挪到第一位，或删掉不用的。可选值 `baidu` / `bing` / `google` / `duckduckgo` / `brave` / `custom`。
- **输入联想词**：给 `search` 加 `showSearchSuggestions: true`。它会把正在输入的关键词发到对应引擎（由服务端代理），在意隐私就不要开；默认关闭。
- **时间格式**：`datetime.format` 用 `Intl.DateTimeFormat` 选项，例如 `{ dateStyle: "short", timeStyle: "medium" }`；`text_size` 可取 `sm` ~ `4xl`。
- **新闻来源可选**（两层，互不冲突）：
  - **页面点选（访客用）**：列表上方自动出现「全部 + 每个已启用来源」标签，点谁只显示谁，选择记在浏览器 localStorage，下次打开沿用。不想要这排标签就把 `news.showSourceFilter` 设为 `false`。
  - **启用哪些源（部署者用）**：在 compose 的 `environment` 里加一行，从内置源里挑（写 key 或中文名都行），不写则默认 `baidu,sina,ithome`：

    ```yaml
    HOMEPAGE_NEWS_SOURCES: "baidu,ithome,sspai"
    ```

    可用 key：`baidu`（百度新闻）、`sina`（新浪国内）、`ithome`（IT之家）、`sspai`（少数派）、`sina-tech`（新浪科技）。改完**必须重建容器**（env 在创建时固定）。
  - **完全自定义源**：`HOMEPAGE_NEWS_FEEDS` 或 `widgets.yaml` 里私有的 `news.url`，逗号分隔多个，支持「名称=地址」以便筛选标签显示中文名：

    ```yaml
    HOMEPAGE_NEWS_FEEDS: "公司公告=https://example.com/rss.xml,IT之家=https://www.ithome.com/rss/"
    ```

    `url` 字段不会下发到前端。优先级：`HOMEPAGE_NEWS_SOURCES` > `HOMEPAGE_NEWS_FEEDS` > `news.url` > 默认三源。
  - 源由**容器内服务端**并发拉取、每源取前 8 条、合并去重按时间排序、缓存 5 分钟；浏览器不直连第三方，单个源 8 秒超时自动跳过。支持 RSS 2.0 / Atom。⚠️ 第三方源看得到 **NAS 的出口 IP**，但看不到访客 IP；介意就换成自己 NAS 上的 RSS 聚合。
- **条数与刷新**：`news.limit`（默认 8，最多 30，直接决定首页铺开几行）、`news.refreshInterval`（毫秒，默认 300000）。

> 排错：新闻一直停在「正在获取新闻…」→ 先在 NAS 上 `docker exec homepage wget -qO- 'https://news.baidu.com/n?cmd=1&class=civilnews&tn=rss' | head -c 200` 确认容器能出网；再确认拉的是新版镜像、`widgets.yaml` 里有 `- news:`。若页面仍是「轮播一条 + 点击展开的小窗口」，说明**还是旧镜像或浏览器缓存**：先 Ctrl+F5 / 无痕窗口，再核对镜像 digest。

---

## 7. 启动后验收（逐条实测）

| # | 场景 | 期望结果 |
|---|---|---|
| 1 | 匿名访问 `http://群晖IP:3000/` | 200，书签与壁纸正常显示 |
| 2 | 匿名访问 `/api/bookmarks`、`/api/hash`、`/api/validate`、`/api/widgets` | 200（白名单内只读数据） |
| 3 | 匿名访问 `/api/config/custom.js`、`/api/config/custom.css` | 200（样式与壁纸脚本加载正常） |
| 4 | 匿名访问 `/api/config/bookmarks` GET / POST | **401**（管理接口受保护） |
| 5 | 匿名访问 `/manage` | **307 → `/auth/signin`** |
| 6 | 打开 `/auth/signin` 或 `/manage` 输入密码 | 登录成功，进入管理页；首页**左下角**出现「管理书签」 |
| 7 | 管理页可视化保存一个书签后回首页 | 数据一致，配置目录生成时间戳 `.bak` |
| 8 | 源码模式保存 | 文件头注释、分组注释、自定义字段完整保留 |
| 9 | 另开无痕窗口 | 看不到「管理书签」按钮；右下角只有壁纸工具条，两者不重叠 |
| 10 | 重启容器 | 配置仍在（挂载目录持久化） |

快速验证 4/5：

```bash
curl -i http://群晖IP:3000/api/config/bookmarks
curl -i http://群晖IP:3000/manage
```

登录入口说明：**首页故意不放登录按钮**（管理入口仅登录可见），直接访问 `/auth/signin`，或访问 `/manage` 自动跳转登录页。登录与管理页右上角「退出」都可用。

---

## 8. 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| `homepage Pulling / homepage Error`、`Get "https://registry-1.docker.io/v2/": dial tcp [2a03:2880:...]` | **国内 DNS 污染**，见 8.1 节 | 配置镜像加速（首选）或走 C 方案导入 tar |
| 容器反复重启，日志 `exec /usr/local/bin/docker-entrypoint.sh: no such file or directory` | **旧镜像**的入口脚本是 CRLF（`#!/bin/sh\r`，Linux 找不到解释器），多见于 Windows 上 `core.autocrlf=true` 时构建 | **重新拉取已修复的镜像**（删掉本地旧镜像后重建项目）；仓库已加 `.gitattributes` + Dockerfile 内 `tr -d '\r'` 双重防护。若必须用旧镜像，见下方覆盖写法 |
| `manifest unknown` / 拉镜像超时 | Docker Hub 上还没有该镜像，或国内网络不通 | 先跑一次 Actions workflow；或改走 C 方案导入 tar |
| 打开页面 `400 Host validation failed` | 访问用的 host 不在白名单 | 把域名 / IP（含端口）补进 `HOMEPAGE_ALLOWED_HOSTS`，改完重建容器；**反代 + 外网配置见 3.1** |
| 登录 `/manage` 成功后被送到 `http://192.168.1.100:3000`（局域网地址） | `NEXTAUTH_URL` 还写着内网地址；它是 NextAuth 的回调基址，相对 `callbackUrl` 会被拼回这个 origin | 把 `NEXTAUTH_URL` 改成外网**完整**地址（含协议 / 域名 / 端口），重建容器、清 cookie；内外网尽量统一用同一域名，见 3.1 |
| 登录页 `Authentication error / Auth is disabled or misconfigured` | 四个必需 env 缺失或 `NEXTAUTH_SECRET` 不足 32 位 | 对照第 3 节补齐，重建容器 |
| 登录成功但首页没有「管理书签」 | 浏览器里混用了 `localhost` / IP / 域名，会话 cookie 不互通 | 全程固定用同一个地址；清掉该站点的 cookie 重新登录 |
| 反代后反复跳回登录页 | `NEXTAUTH_URL` 写成 `http`，实际访问是 `https`（或反之） | 改成与实际协议一致，并在反代里正确传 `X-Forwarded-Proto` |
| 管理页保存报 500 | 配置目录 UID 1000 不可写 | 重做第 4 节 `chown`；看容器日志确认 |
| 匿名访问 `/api/config/bookmarks` 返回 401 | **这是预期行为**，不是故障 | 登录后才有权限 |
| 首页出现 `My First Group` / `My Second Group` / `My Third Group` 三个示例服务 | 挂载目录里没有 `services.yaml`，应用启动时按官方逻辑从 `src/skeleton/` 自动拷贝了示例配置（同理还有 `settings.yaml` / `docker.yaml` / `kubernetes.yaml` / `proxmox.yaml` / `custom.js` / `custom.css`） | 在 NAS 配置目录新建 `services.yaml`，内容为 `---` 换行 `[]` 两行即可清空服务区；或填自己的真实服务。改完重建项目。注意 `settings.yaml` 的 skeleton 版含假的天气 API key，不用天气组件可忽略 |
| ARM 机型启动失败 `exec format error` | 镜像是 amd64 | 自行构建 arm64 镜像 |

> **旧镜像临时绕过**（只在无法重新拉取时用）：在 compose 的 `homepage` 服务下加下面两行，启动时先把 `\r` 去掉再执行入口脚本，CMD 保持原样。
>
> ```yaml
> entrypoint: ["/bin/sh", "-c", "tr -d '\\r' < /usr/local/bin/docker-entrypoint.sh > /tmp/e.sh && chmod 755 /tmp/e.sh && exec /tmp/e.sh \"$@\"", "--"]
> command: ["node", "server.js"]
> ```
>
> 根本办法还是换镜像：删掉 NAS 上的旧镜像 → 项目「清除并重建」，拉到新 digest。

### 8.1 拉取镜像报 `dial tcp [2a03:2880:...]`（国内 DNS 污染，最常见）

**现象**：Container Manager 项目日志里 `homepage Pulling` → `homepage Error`，报错

```
Error response from daemon: Get "https://registry-1.docker.io/v2/": dial tcp [2a03:2880:f126:8...]: connect: network is unreachable
```

**原因**：`registry-1.docker.io` 被 DNS 污染。`2a03:2880::/32` 是 Facebook 的地址段，IPv4 也常被解析成 Twitter 段 `104.244.46.x`。群晖优先走 IPv6，而家宽通常没有 IPv6 出口，于是卡在 `dial tcp [IPv6]`。关掉 IPv6 后同一个问题会换一种报错：`net/http: request canceled`（IPv4 连接超时）——**只要报错里还写着 `registry-1.docker.io`，就说明镜像加速没生效，问题没解决**。**注意**：群晖官方知识库建议把 DNS 改成 `114.114.114.114 / 223.5.5.5`，但实测这两个 DNS 返回的仍是污染地址；仅关 IPv6 也只是换成被污染的 IPv4，通常仍拉不动。所以要换的是「解析目标」，不是 DNS 本身。

> **只想最快跑起来**：直接跳到方案 2，把项目 YAML 的 `image` 换成带加速域名的完整地址即可，不用 SSH、不用改 daemon 配置。

#### 方案 1（长期最干净）：给 Container Manager 配镜像加速，YAML 不用改

2026-11-06 实测 **`https://docker.1ms.run` 可用**：`docker pull` 成功，拉下来的镜像入口脚本是 LF、能正常启动，且内置定制配置齐全；`https://hub.rat.dev` 同样可用。推送新镜像后加速源会及时同步（当前 digest 以第 5 节 A 为准）。

⚠️ **不要用 `docker.1panel.live` 配 `registry-mirrors` 或加镜像前缀**：它用 `curl` 查 manifest 正常，但 Docker 实际拉取会对 HEAD 请求返回 `403 Forbidden`。`docker.m.daocloud.io` 有镜像白名单，会直接拒绝 `boyu233/homepage-bookmark-manager`（`this image is not in the allowlist`）。**判断加速源能否用，必须以 `docker pull` 实测为准，不能只看 curl 状态码。**

1. 开启群晖 SSH，登录后 `sudo -i` 切 root。
2. **先看原文件，不要覆盖**（DSM 7.2+ 路径；DSM 7.1 及更早的 Docker 套件是 `/var/packages/Docker/etc/dockerd.json`）：

   ```bash
   cat /var/packages/ContainerManager/etc/dockerd.json
   ```

   文件里通常已有 `data-root`、`log-driver`、`storage-driver` 等键，**全部保留**，只在其中追加一个 `registry-mirrors` 键（注意 JSON 逗号）：

   ```json
   {
     "data-root": "/var/packages/ContainerManager/var/docker",
     "log-driver": "db",
     "storage-driver": "btrfs",
     "registry-mirrors": ["https://docker.1ms.run"]
   }
   ```

3. **套件中心 → Container Manager → 停止 → 启动**（不要重启整台 NAS）。图形界面重启最稳妥，也可用 `synosystemctl restart pkgctl-ContainerManager`。
4. 验证并重新拉：

   ```bash
   docker info | grep -A 3 "Registry Mirrors"
   docker pull boyu233/homepage-bookmark-manager:latest
   docker images --digests | grep homepage-bookmark-manager
   ```

   确认 digest 是 `sha256:58b2c52c4498…1ec2`（见第 5 节 A）再回第 6 节重建项目。若仍是 `4a78326d…`，说明加速源还在缓存上一版，等同步或改用 5-C 的 tar 导入。

> 加速站是第三方服务，随时可能失效。备用源 `https://hub.rat.dev`（同样实测 `docker pull` 成功）。`/v2/` 返回 401 是正常的鉴权挑战，不代表不可用；**换源前用 `docker pull <源域名>/boyu233/homepage-bookmark-manager:latest` 实测一次**再改配置。

#### 方案 2（不开 SSH）：直接在图形界面拉加速源地址

Container Manager → **映像 → 添加 → 从 URL 添加**，填：

```
docker.1ms.run/boyu233/homepage-bookmark-manager:latest
```

拉下来后本地镜像名带前缀，因此要把 `synology-compose.yaml` 的 `image` 改成同一串（或 SSH 里 `docker tag` 成不带前缀的名字）。**这份改动只留在 NAS 上，不要提交回 GitHub**，避免公开仓库硬依赖某个第三方加速站。

#### 方案 3（完全断网也能用）

按第 5 节 C 方案，在能联网的机器上 `docker save` 导出 tar → 上传到 NAS → Container Manager → 映像 → 导入。导入后在「映像」页看实际名称，把 YAML 的 `image` 改成它。

#### 顺带一提

群晖官方知识库还建议：控制面板 → 网络 → 网络介面 → 编辑 → **IPv6 设为关闭**、IPv4 页签**关闭自定义 MTU**、控制面板 → 区域选项 → 时间**与 NTP 同步**。这些能排除 IPv6 路由、MTU、证书时间三类干扰，但**不能解决 DNS 污染**，可作为方案 1 的补充一起做。

---

## 9. 升级与回滚

- **升级**：推送新代码 → 重新跑 Actions → 群晖 Container Manager 项目里执行 `docker compose pull && docker compose up -d`（或在项目界面「清除并重建」）。配置在挂载目录，不会丢。
- **回滚镜像**：把 YAML 的 `image` 标签换成上一个 `sha-<commit>` 或具体版本 tag，再重建项目。
- **回滚配置**：用 `bookmarks.yaml.时间戳.bak` 覆盖回去。
- **备份**：定期打包整个 `/volume1/docker/homepage/config` 目录存到别处。

---

## 10. 上线安全清单

- [ ] 密码与 `NEXTAUTH_SECRET` 都是新生成的，没有复用开发期测试值
- [ ] `.env`、真实口令、`*.bak`、脱敏前备份目录都没有提交到 GitHub，也没打进镜像
- [ ] `HOMEPAGE_PUBLIC_READ_PATHS` 没有加入 `/api/config/bookmarks`、`/api/services/proxy`、`/api/revalidate`、`/api/mcp`
- [ ] 若以后在 `services.yaml` 里加 NAS / Docker / K8s 组件，先评估服务代理接口的暴露面
- [ ] `custom.js` 顶部的 `WALLPAPER_TODAY` / `WALLPAPER_RANDOM` 默认为第三方图源，会暴露访客 IP；可换自托管地址，或两组都设为空数组彻底关闭在线请求
- [ ] 只对内网开放，或经反向代理 + HTTPS 暴露；不要直接把 3000 端口映射到公网

更完整的验收矩阵与安全说明见 [`群晖部署清单.md`](./群晖部署清单.md)。
