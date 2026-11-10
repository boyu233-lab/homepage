# 群晖 Docker 部署方法（Homepage 书签管理版）

> **版本 v1.0.3（2026-11-09）** — 右侧 B站部件改为 **「输入关键词搜索 → 手动点选 → 只播放声音、不显示画面」**，见 **6.7 节**；左侧 **9 源热榜标签切换** 与双栏布局不变（见 6.6 节）。对应 git tag `v1.0.3`、镜像 `:v1.0.3` = `:latest` = `:sha-92da188`、digest `sha256:da152802081424e2583835fab3ff126bb16dac5ece0fed9d698d380d32b4df25`。
> 上一版 v1.0.1（新闻改百度热搜榜）见 **6.5 节**；更早定版坐标见 `CHANGELOG.md`。变更历史见仓库 `CHANGELOG.md`。
>
> ⚠️ **v1.0.3 是组件层 + 配置层双改动**：除了换镜像，还必须同步 `widgets.yaml` / `custom.js` / `custom.css` 三个配置文件（详见 6.7 节）。只换镜像不会得到新版搜索 / 音频布局。

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

> ⚠️ **以下为 v1.0.0 的更新记录**；当前版本是 v1.0.1（新闻部件改为百度热搜榜），见顶部版本块与 **6.5 节**。
>
> ✅ **2026-11-07 12:44 更新完成**：在「多引擎搜索 / 中文时间 / 首页常驻新闻列表 + 来源筛选 + 左侧导航固定位置」基础上，镜像内置的 `custom.js` / `custom.css` 已更新为**分组卡片区与新闻窗口同起点、同高度**（切换分组内容区不跳动，见 6.4 节）。`:latest` 与 `:sha-91876c4` 两个标签已推送 Docker Hub。
> 当前 digest：`sha256:da152802081424e2583835fab3ff126bb16dac5ece0fed9d698d380d32b4df25`（`linux/amd64`）。
> - **升级已有部署**：① 用 `homepage-panel-align.zip` 覆盖配置目录里的 `custom.js` **和 `custom.css`**（**必做**，见 6.3 / 6.4 节；入口脚本不会覆盖你改过的配置文件）；② 需要一并更新镜像时，删掉 NAS 上的旧镜像 → 重拉 `latest` → 重建项目。若还没做 6.2 节的三部件升级，也按 **6.2 节**覆盖 `widgets.yaml`。
> - 容器内实测 `/api/widgets/news?index=3` 返回 `feedNames: ["百度新闻","新浪国内","IT之家"]` 与 24 条新闻；**没有 `feedNames` 或返回 404 = 仍是旧镜像**。
> - 离线兜底：`homepage-image-20261107.tar`（80MB，**已重新导出为 12:44 版**，含导航固定 + 卡片区对齐）按 **C 方案**导入；NAS 上若有同名旧文件，先删再传。`homepage-image-20261106.tar` 是更旧的一版（轮播 + 下拉窗口），不要用。
> - 国内加速源可能仍缓存上一版，拉完请按 **8.1 节**核对 digest；不一致就等同步或改用 tar 导入。

镜像已构建并推送到 Docker Hub，**公开仓库、免登录**，`linux/amd64`，YAML 里已填好地址：

| 标签 | 用途 |
|---|---|
| `boyu233/homepage-bookmark-manager:v1.0.3` | **当前定版标签**（2026-11-09，B站搜索 + 纯音频、9 源热榜 + 双栏首页，见 6.7 节），推荐部署时固定使用，避免 `latest` 漂移 |
| `boyu233/homepage-bookmark-manager:latest` | 当前最新，与 `:v1.0.3` 同 digest；**配套 `synology-compose.yaml` 已固定为 `:v1.0.3`**，避免 Container Manager 吃 `latest` 本地缓存 |
| `boyu233/homepage-bookmark-manager:sha-92da188` | 当前固定版本（B站搜索 + 纯音频 + 9 源热榜 + 双栏布局），回滚 / 复现用 |
| `boyu233/homepage-bookmark-manager:v1.0.2` | 上一版（B站音乐榜 + 16:9 播放器），需要回退旧行为时用 |
| `boyu233/homepage-bookmark-manager:v1.0.1` | 上一版定版（2026-11-09，百度热搜榜，见 6.5 节），需回退单栏布局时用 |
| `boyu233/homepage-bookmark-manager:sha-390aaa3` | v1.0.1 对应的固定版本 |
| `boyu233/homepage-bookmark-manager:v1.0.0` | 更早定版（2026-11-07，RSS 新闻聚合），需要回退旧行为时用 |
| `boyu233/homepage-bookmark-manager:sha-91876c4` | v1.0.0 对应的固定版本 |
| `boyu233/homepage-bookmark-manager:sha-2b2a4c3` | 上一版（导航固定，但卡片区仍会跳到页面顶部），需要回退时用 |
| `boyu233/homepage-bookmark-manager:sha-4d61e9b` | 更早一版（常驻新闻列表，导航会随内容跳动） |
| `boyu233/homepage-bookmark-manager:sha-cfea038` | 最早一版（轮播一条 + 点击展开下拉窗口） |

- 群晖：Container Manager → **映像 → 添加 → 从 URL 添加**，填 `boyu233/homepage-bookmark-manager:latest`；或 SSH `docker pull boyu233/homepage-bookmark-manager:latest`。
- 也可直接跳到第 6 节创建项目，Container Manager 会自动拉取。
- 当前镜像 digest：`sha256:da152802081424e2583835fab3ff126bb16dac5ece0fed9d698d380d32b4df25`（`latest` / `v1.0.3` / `sha-92da188` 指向同一镜像）。
- v1.0.1 镜像 digest：`sha256:678821c624cf4f572cceb7f5ca42c7964b31a993ff9f4299e5613338ee71616d`（`v1.0.1` / `sha-390aaa3`）。
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

> 升级步骤：**删掉 NAS 上的旧镜像 → 重新拉取 → 重建项目 → Ctrl+F5**；**全新部署**不用手动上传配置文件，但**已有部署**因为配置文件已存在，需要按 6.2 / 6.3 / 6.4 节覆盖 `custom.js` / `custom.css` 等文件才能拿到新排版。若重建后仍是官方外观，看容器日志有没有 `Applied bundled default:` —— 没有就说明拉到的还是旧镜像。
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

> ⚠️ **本节中「实时新闻 / 新闻来源」的描述是 v1.0.0 及更早镜像的行为。v1.0.1 起该部件已改为百度热搜榜，请以 [6.5 节](#65-v101新闻部件改为百度热搜榜2026-11-09) 为准**；搜索框、时间部件与升级步骤仍然有效。

## 6.2 首页三个部件：多引擎搜索 / 时间 / 实时新闻（v1.0.0）

顶部信息条由 `widgets.yaml` 决定，首页视图的排版由 `custom.css` 接管。新版镜像内置了这两份配置，**全新部署自动生效**；已有部署因为配置文件已经存在（入口脚本刻意不覆盖用户改过的配置），需要按下面 4 步手动覆盖一次。

| 部件 | 怎么用 | 配置键 |
|---|---|---|
| 搜索框 | 输入框右侧图标点开，可切换 **百度 / Bing / Google / DuckDuckGo / Brave**；选择记在浏览器 localStorage，下次打开沿用。默认引擎是数组第一项（百度） | `search.provider`（数组） |
| 时间 | 显示「2026年11月7日星期六 10:52:00」，每秒更新 | `datetime` |
| 实时新闻 | **直接在首页铺开 8 条列表**（没有下拉浮层、不再轮播）：每条含来源徽标 + 标题 + 时间，点标题新标签打开原文；顶部「全部 / 百度新闻 / …」标签可切换来源，选择记在浏览器；5 分钟自动刷新，也可点刷新按钮 | `news` |

### 已有部署的升级步骤（必做）

1. 更新镜像（**常驻列表与来源筛选是新增组件代码，不换镜像不会出现**）：删掉 NAS 上的旧镜像 → 重新拉取 `boyu233/homepage-bookmark-manager:latest`（v1.0.0 历史 digest `sha256:a47d668b…6cfe16`）→ 重建项目。国内直连拉不动见 **8.1 节**换加速源；完全离线时用 `homepage-image-20261107.tar` 按 **5-C** 导入（导入后把 YAML 的 `image` 改成实际名称）。
2. 把新的 `widgets.yaml`、`custom.js` **和 `custom.css`** 上传到配置目录（compose `volumes` 冒号**左侧**的宿主机路径），覆盖同名文件。**不要动 `bookmarks.yaml`**。可用 `homepage-layout-update.zip`（三件套）后，再用 `homepage-panel-align.zip` 覆盖一次 `custom.js` + `custom.css`（导航固定 + 卡片区对齐，最新版）。
3. Container Manager → 项目 → 停止 → 清除并重建（或 SSH `docker compose down && docker compose up -d`）。
4. 浏览器 **Ctrl+F5** 强制刷新。

### 自定义

- **换默认引擎**：把 `search.provider` 里想要的引擎挪到第一位，或删掉不用的。可选值 `baidu` / `bing` / `google` / `duckduckgo` / `brave` / `custom`。
- **输入联想词**：给 `search` 加 `showSearchSuggestions: true`。它会把正在输入的关键词发到对应引擎（由服务端代理），在意隐私就不要开；默认关闭。
- **时间格式**：`datetime.format` 用 `Intl.DateTimeFormat` 选项，例如 `{ dateStyle: "short", timeStyle: "medium" }`；`text_size` 可取 `sm` ~ `4xl`。
- **新闻来源可选（v1.0.0 已废弃，v1.0.1 不再读取以下任何环境变量）**（两层，互不冲突）：
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

## 6.3 左侧导航固定位置（2026-11-07）

**问题**：旧版 `custom.css` 用 `margin: auto 0` 让导航在 flex 容器里自动居中。首页视图被「大字时间 + 8 条新闻」撑高后，导航会沉到页面左下角；点其他分组又跳回上方，位置随内容和当前分组变。

**现在**：`.group-nav` 改为绝对定位（`top: clamp(180px, 36vh, 380px)`、`left: 32px`，相对页面主容器），`.nav-layout` 用 `padding-left` 保留原来的占位。导航距顶部的距离只与视口高度有关，与新闻条数、分组高度、当前选中项都无关：

- 点「首页」/「搜索引擎」/「社区与开发」、刷新页面，导航都在同一高度，不会上下跳动；
- 滚动页面时它随内容一起走，不是一直贴在屏幕上的悬浮层；
- 窄屏（≤860px）列宽收窄到 140px，手机（≤560px）改为顶部横排标签条。

**已有部署升级**：这一节本身只改 `custom.css`；若还要 6.4 的卡片区对齐，直接用 6.4 节的 `homepage-panel-align.zip`（含 `custom.js` + `custom.css` 两个文件）一次覆盖即可。镜像内 `src/skeleton/` 也已同步，全新部署开箱即带新位置。

1. 把升级包里的 `custom.css`（必要时含 `custom.js`）上传到配置目录（compose `volumes` 冒号**左侧**的宿主机路径），覆盖同名文件。**不要动 `bookmarks.yaml` / `widgets.yaml`**。
2. 浏览器 **Ctrl+F5** 强制刷新（`custom.css` 有浏览器缓存）；容器不用重启。
3. 自检：停在「首页」（大字时间 + 新闻）记住左侧导航高度 → 点「搜索引擎」→ 高度完全一致即成功。
4. 微调：改 `custom.css` 里 `.group-nav` 的 `top`（数值越大越靠下）和 `left`；窄屏在文件末尾两个 `@media` 里改。

> 若同时要升级镜像：先删旧镜像重拉 `latest`（见 5-A），再执行上面 1-2 步。入口脚本**不会覆盖你改过的配置文件**，只换镜像、不覆盖配置文件的话，导航仍是旧位置。

---

## 6.4 分组卡片区与首页新闻窗口对齐（2026-11-07）

**问题**：点左侧导航切到「搜索引擎」等分组时，时间 / 新闻隐藏让顶部信息条变矮，右侧卡片区跟着跳回页面顶部，与首页新闻窗口的位置、高度都不一致，切换前后视觉跳动。

**现在**：`custom.js` 在首页视图测量 `.information-widget-news` 相对页面主容器的 `top` 与高度，写入 `:root` 的 `--news-panel-top` / `--news-panel-height`，并缓存到 `localStorage["homepage.newsPanel"]`；`custom.css` 用这两个变量把非首页视图的激活分组卡片区定位到**同一起点、同一高度**：

- 切换分组前后，右侧内容区上下位置不变、高度不变；
- 新闻条数变化、来源筛选标签换行等导致窗口变高时，`ResizeObserver` 自动重测，卡片区跟着变；
- 卡片多到超出窗口时在该区域内滚动；手机（≤560px）改为等高下限、自然撑开，不做内部滚动；
- 首次访问就停在某个分组（localStorage 记住了上次选择）也能立刻对齐，因为测量值已缓存；极端情况没测到时用兜底 `230px / 300px`。

**已有部署升级**：本次改的是 `custom.js` + `custom.css` 两个**配置文件**，覆盖这两个文件 + Ctrl+F5 即可，不用重启容器；镜像内 skeleton 也已同步，全新部署开箱即带。

1. 用 `homepage-panel-align.zip` 覆盖配置目录里的 `custom.js` 与 `custom.css`（**两个都要**），不要动 `bookmarks.yaml` / `widgets.yaml`。
2. 浏览器 **Ctrl+F5**。
3. 自检：首页新闻窗口顶边与切到「搜索引擎」后卡片区顶边在同一水平线，两块高度一致。

> 微调：水平位置改 `custom.css` 末尾 `body:not(.home-view) ... .nav-active` 的 `left` / `width`；垂直位置与高度由 `custom.js` 自动测量，不建议写死，兜底值在 CSS 的 `var()` 第二个参数里。


## 6.5 v1.0.1：新闻部件改为百度热搜榜（2026-11-09）

> ⚠️ **本节覆盖 6.2 节里关于「新闻来源」的全部内容。** v1.0.1 起该部件只显示百度热搜榜，不再聚合 RSS；6.2 节的来源筛选与多源配置仅适用于 v1.0.0 及更早镜像。

**为什么要换**：v1.0.0 默认三个源都有硬伤——新浪系 RSS 停在 **2018-09-23**（新浪滚动更早到 2016-06），HTTP 仍是 200；百度 RSS 是低频「焦点精选」，实测 40+ 分钟首条不变，且每条 `pubDate` 都是**抓取时刻**，按时间倒序排会一直霸占「全部」前 8 条，表现为「时间很新、内容不换」。前端时间格式不带年份，把 2018 年的新闻显示成「09/23」。

**现在**：服务端固定请求百度热搜官方接口 `https://top.baidu.com/api/board?platform=pc&tab=realtime`（裸请求 200，容器直连即可），解析出置顶 1 条 + 榜单前 49 名（服务端上限 50 条，首屏按 `limit` 显示前 10 条）：

| 首屏元素 | 内容 |
|---|---|
| 徽标 | 置顶显示 `↑`；第 1/2/3 名红 / 橙 / 黄数字；其余沿用原有紫色徽标 |
| 标题 | 热搜词，悬停显示摘要；点击新标签打开百度搜索结果页 |
| 角标 | 「新 / 沸 / 热」（`hotTag` 1 / 2 / 3） |
| 右侧 | 热度值，如 `780.8万` |
| 工具栏 | 榜单名 + 「更新于 HH:mm」+ 手动刷新按钮 |

服务端缓存 **60 秒**，前端默认 60 秒自动刷新；接口地址写死在代码里不可配置（避免 SSRF），链接只接受 http(s)，上游失败返回空列表 + `error` 标记并显示「热搜暂不可用，稍后会自动重试」。

### 升级步骤（必须换镜像）

1. 删掉 NAS 上的旧镜像 → 重拉 `boyu233/homepage-bookmark-manager:v1.0.1`（或 `:latest`）→ 重建项目 → 浏览器 **Ctrl+F5**。**只覆盖配置文件无效**，这是组件代码改动。
2. `custom.js` / `custom.css` **不用动**：榜单复用原有 `.news-list` / `.news-source-badge` / `.news-item-time` 样式，排名与角标颜色走内联样式。`limit` 从 8 提到 10 会让窗口变高，`custom.js` 的 `ResizeObserver` 会自动重测，6.4 节的分组卡片区对齐仍有效。
3. 建议把用户配置目录 `widgets.yaml` 的 `news` 段改成：

    ```yaml
    - news:
        label: 百度热搜
        limit: 10               # 1-50，含置顶 + 排名
        refreshInterval: 60000
        target: _blank
    ```

    不改也能跑，只是标题仍显示「实时新闻」、只铺 8 条、5 分钟才刷新一次。
4. **删掉 compose 里的旧环境变量**：`HOMEPAGE_NEWS_SOURCES`、`HOMEPAGE_NEWS_FEEDS`（以及 `widgets.yaml` 里的 `news.url` / `news.showSourceFilter`）在 v1.0.1 里已完全失效。留着不会报错，但会让人误以为还在生效。改环境变量需要**重建容器**（停止 → 清除 → 构建），只重启不生效。

### 自检

- 页面：首行是 `↑` 置顶，其后是 1 / 2 / 3… 排名，右侧热度形如 `xxx.x万`，工具栏有「更新于」。
- API：`http://<群晖地址>:<端口>/api/widgets/news?index=3` 应返回 `boardName: "热搜榜"`、`feedNames: ["百度热搜"]`、`sources: 1`，且 `items[0].isTop === true`、条目带 `rank` / `hotScore`。若 `feedNames` 仍是 `["百度新闻","新浪国内","IT之家"]`，说明**还是 v1.0.0 镜像**（删干净旧镜像重拉）。
- 容器出网：`docker exec homepage wget -qO- 'https://top.baidu.com/api/board?platform=pc&tab=realtime' | head -c 120`，能看到 `{"success":true` 即正常。

### 排错

| 现象 | 原因 / 处理 |
|---|---|
| 仍是「09/23 新浪国内」 | 旧镜像，删镜像重拉 |
| 仍是「实时新闻 + 来源标签」 | 旧镜像，或浏览器缓存 → Ctrl+F5 / 无痕窗口 |
| 一直「正在获取热搜…」 | 容器不能出网 `top.baidu.com`（见上方 wget 自检）；检查代理 / DNS |
| 「热搜暂不可用」 | 上游非 200 或结构改版，`docker logs homepage` 会有 `百度热搜获取失败: ...` |
| 榜单不刷新 | 确认 `refreshInterval: 60000`；服务端缓存固定 60 秒，点刷新按钮可立即重拉 |

---

## 6.6 v1.0.2：B站音乐榜 + 首页双栏（2026-11-09，历史）

> ⚠️ **本节关于 B站「音乐榜 / 16:9 播放器 / 24 小时刷新」的内容已被 6.7 节的 v1.0.3 覆盖**；其中关于 9 源热榜标签与双栏布局的说明仍然有效。
> 本节同时覆盖 6.2 / 6.4 节里「首页单栏堆叠、只测新闻窗口」的描述：v1.0.2 起首页为双栏，卡片区对齐改为测量两个面板的联合外框。

**做了什么**：新增 `bilibili_music` 部件。服务端固定代理 B站音乐区排行榜 `https://api.bilibili.com/x/web-interface/ranking/v2?rid=3&type=all`（裸请求 `code: 0`，返回约 97 条），解析排名 / 标题 / UP主 / 时长 / 播放数 / 点赞数 / 分区，服务端缓存默认 **24 小时**、上限 50 条。点击榜单条目，在当前页挂载 B站官方播放器 iframe：

| 首屏元素 | 内容 |
|---|---|
| 徽标 | 1 / 2 / 3 名红 / 橙 / 黄，其余沿用紫色 |
| 标题 | 视频标题，悬停显示 UP主 / 播放量 / 时长 |
| 右侧 | 播放量（如 `1788.2万`）+ 时长（`3:35`） |
| 外链图标 | 新标签打开 `bilibili.com/video/BV...` |
| 工具栏 | 榜单名 + 「更新于 MM/DD HH:mm」+ 手动刷新 |
| 播放器 | 点击条目后**替换**榜单显示：官方 16:9 iframe、上一首 / 下一首循环切歌、「榜单」返回、在 B站打开 |

**刷新周期**：B站音乐区排行榜按天更新，默认 **24 小时**刷新一次（`widgets.yaml` → `bilibili_music.refreshInterval: 86400000`，单位毫秒）。这个值同时作用于前端轮询与服务端缓存（服务端 clamp 到 1 分钟 ~ 7 天），工具栏显示抓取日期+时间。想立刻拿最新榜单，点工具栏刷新按钮：请求带 `force=1` 跳过缓存重拉上游（保留 60 秒最小间隔，避免被刷触发 B站风控）。上游失败不写入缓存，下次请求会重试。**百度热搜是实时榜，仍为 60 秒刷新**，两个榜周期各自独立。容器重启会清空内存缓存，首次访问会立即重拉一次。

**多源热榜标签**：热榜面板顶部新增一行来源标签（单行横向滚动，**不增加面板高度**），共 9 个来源，选择记在浏览器 `localStorage["homepage.newsSource"]`，刷新页面仍停在上次看的榜：

| 类型 | 来源 | 服务端缓存 | 列表右侧 |
|---|---|---|---|
| 热榜 | 百度热搜、微博热搜、知乎热榜、头条热榜、抖音热榜、B站热搜 | 60 秒 | 热度（如 `780.8万`）+ 新 / 沸 / 热角标 |
| 资讯 | Bing 资讯、IT之家、少数派 | 5 分钟 | 文章发布时间 `MM/DD HH:mm` |

切换标签时前端只改 `/api/widgets/news?index=3&source=<key>`，服务端按源独立缓存，**单源失败不影响其它源**，且**不需要改 `widgets.yaml`**（来源列表写死在镜像代码里）。链接一律服务端按白名单拼接或只收 http(s)，请求不传 URL，防 SSRF。实测放弃的源：知乎网页版热榜 API（401）、36氪网关（500）、Bing 新闻 `format=rss`（已改版返回 HTML）；Bing 改用必应搜索 RSS，条目是**相关网页结果**而非新闻稿件列表。新浪系 / 百度新闻 RSS 仍是死源，未接回。

**布局**：`#information-widgets-right` 改为两列 grid —— 搜索框、中文时间跨整行，百度热搜与 B站音乐各占一列（总宽 `min(1240px, 96%)`，间距 22px）；屏宽 ≤900px 回落单栏上下堆叠。播放器视图替换榜单而非叠加，两栏高度保持稳定。`custom.js` 的 `ResizeObserver` 同时观察两个面板，取最小 top / 最大 bottom 作为联合外框，6.4 节的卡片区对齐自动跟随。

**隐私 / 安全**：榜单由容器代理，访客 IP 不外泄；播放器 iframe 由浏览器直连 B站，**仅在点播时**才会向 B站暴露访客 IP / Referer。上游地址与 `rid` 写死不可配置（防 SSRF），`bvid` 走 `/^BV[0-9A-Za-z]{10}$/` 白名单，链接由服务端拼接、不透传上游 URL。B站没有公开音频流接口，未做音频流代理。

### 升级步骤（换镜像 + 同步三个配置文件）

1. **换镜像**：删 NAS 旧镜像 → 重拉 `boyu233/homepage-bookmark-manager:v1.0.2`（或 `:latest`）→ 重建项目 → Ctrl+F5。
2. **同步配置**（关键：入口脚本不会覆盖你改过的非空文件）。推荐做法：
   - 先备份 `custom.js` 里自定义过的 `WALLPAPER_TODAY` / `WALLPAPER_RANDOM` 图源；
   - 删除挂载目录（compose `volumes` 冒号**左侧**）里的 `widgets.yaml`、`custom.js`、`custom.css` **三个文件**；
   - 重启容器 → 容器日志会打印 `Applied bundled default: widgets.yaml` / `custom.js` / `custom.css`，从镜像内置 skeleton 自动补齐 v1.0.2 版。
   - ⚠️ **不要删 `bookmarks.yaml`**，那是你的真实书签；`settings.yaml` / `services.yaml` 可不动。
   - 不想删文件的话，就手动把升级包里的 `widgets-v1.0.2.yaml`、`custom.js`、`custom.css` 覆盖过去（sha256 与镜像内置一致）。
3. compose 里的 `HOMEPAGE_NEWS_SOURCES` / `HOMEPAGE_NEWS_FEEDS` 仍建议删掉（v1.0.1 起已失效）；改环境变量同样要「清除并重建」。
4. **Ctrl+F5** 强刷（custom.js / custom.css 有浏览器缓存）。

| 只做了一半 | 现象 |
|---|---|
| 只换镜像，配置没同步 | 音乐部件不出现（旧 `widgets.yaml` 无该段），首页仍是单栏热搜 |
| 只同步配置，镜像没换 | 页面显示 `Missing bilibili_music` |
| 只同步 `widgets.yaml`，没动 `custom.css` | 音乐部件与热搜上下堆叠，且非首页分组不会隐藏音乐榜 |

### 自检

- 页面：搜索 → 时间 → 左右两栏（左热搜、右音乐）；点音乐条目出现 B站播放器，可切歌 / 返回榜单；窄屏 ≤900px 自动上下堆叠。
- API：`http://<群晖地址>:<端口>/api/widgets/bilibili_music?index=4` 返回 `boardName: "音乐榜"`、`feedNames: ["B站音乐榜"]`、`total >= 50`，条目带 `bvid` / `rank` / `link`；首页显示 `Missing bilibili_music` 说明镜像还是 v1.0.1。
- 多源：`http://<群晖地址>:<端口>/api/widgets/news?index=3&source=weibo` 返回 `sourceLabel: "微博热搜"`、`availableSources` 9 项；页面顶部能看到 9 个标签，点「IT之家」后右侧列显示发布时间。**不带 `source` 参数仍返回百度热搜**（兼容旧调用）。
- 容器出网：`docker exec homepage wget -qO- 'https://api.bilibili.com/x/web-interface/ranking/v2?rid=3&type=all' | head -c 80` 应看到 `{"code":0`。
- 配置生效：容器日志出现 `Applied bundled default: widgets.yaml`；或直接看配置目录 `widgets.yaml` 里是否有 `- bilibili_music:`。

### 排错

| 现象 | 原因 / 处理 |
|---|---|
| `Missing bilibili_music` | 旧镜像，删镜像重拉 `:v1.0.2` |
| 一直转圈 / 「音乐榜暂不可用」 | 容器不能出网 `api.bilibili.com` 或被风控（`code != 0`），看 `docker logs homepage` 的 `B站音乐榜获取失败`。**v1.0.2 已修复最常见的 `code=-352`**：B站会把简写 / 自定义 UA 判为爬虫，现已统一改用完整 Chrome UA + 浏览器头，容器内实测恢复 97 条 |
| 只有百度热搜、没有来源标签 | 镜像还是 v1.0.1（旧版不认 `source` 参数），删镜像重拉 `:v1.0.2` 后 Ctrl+F5 |
| 某个标签显示「XX暂不可用」 | 该平台接口临时改版 / 反爬 / 容器出网被拦；点其它标签正常即说明是单源问题，稍后自动重试 |
| 音乐榜一整天没变化 | 24 小时刷新是设定行为；点工具栏刷新按钮（`force=1`）可立即重拉。点了仍不变，确认距上次抓取已超过 60 秒且容器能出网 |
| 想改刷新周期 | 改 `widgets.yaml` 的 `bilibili_music.refreshInterval`（毫秒），前端轮询与服务端缓存同时生效；Ctrl+F5 即可，**不用换镜像** |
| 点击条目没声音 | 浏览器自动播放策略：再点一次播放器内的播放键；或检查广告拦截插件是否挡了 `player.bilibili.com` |
| 桌面端两栏却上下堆叠 | `custom.css` 还是旧版，按上方第 2 步同步 |
| 切到书签分组后卡片区高度不对 | `custom.js` 还是旧版（只测新闻窗口），更新后 Ctrl+F5 |

---

## 6.7 v1.0.3：B站搜索 + 纯音频播放（2026-11-09）

> ⚠️ **本节覆盖 6.6 节里「B站音乐榜 / 16:9 播放器 / 24 小时刷新」的全部描述**。v1.0.3 起右侧部件不再自动出榜单、也不显示任何视频画面。

**做了什么**：右侧 `bilibili_music` 部件（key 沿用历史命名）改成三步：

| 步骤 | 行为 |
|---|---|
| ① 搜索 | 输入关键词回车或点搜索按钮，服务端固定代理 `api.bilibili.com/x/web-interface/wbi/search/type?search_type=video`（完整 Chrome UA 下免登录可用，每页 20 条）。标题里的 `<em class="keyword">` 高亮标签与 HTML 实体会被剥成纯文本；`bvid` 走白名单，链接由服务端拼接 |
| ② 手动选 | 结果列表显示序号 / 标题 / UP主 / 播放量 / 时长 / 「在 B站打开」；支持最近搜索词、示例词、分页（最多 10 页）、重新搜索。**不搜索就不请求上游**，面板只显示输入提示 |
| ③ 纯音频播放 | 点击条目后，列表**替换**为音轨信息条 + 原生 `<audio controls>`：可播放 / 暂停 / 拖进度 / 调音量，播放结束自动切下一首，另有上一个 / 下一个 / 返回结果。**页面里没有 iframe、没有封面、没有视频画面** |

**音频为什么要代理**：B站 DASH 音轨 CDN 强制校验 `Referer: https://www.bilibili.com/`，第三方站点或空 Referer 一律返回 403，浏览器 `<audio>` 无法直连。因此新增同源接口 `/api/widgets/bilibili_audio?bvid=<BV号>`：

```
浏览器 <audio>  ──同源──>  容器 /api/widgets/bilibili_audio
                              ├─ wbi/view       取 cid（缓存 24 小时）
                              ├─ playurl fnval=16  取 DASH 音轨，自动选最高码率（免登录 3 档，最高约 184kbps 的 fMP4）
                              └─ 带 Referer + Range 请求 CDN，流式转发 200/206 与 Content-Range 回浏览器
```

音轨地址带时效签名，缓存 20 分钟后会重新获取；CDN 域名走后缀白名单（防 SSRF），备用地址优先选标准 443 端口，避免部分网络拦截 8082 / 4483。浏览器只连自己的 NAS，访客 IP / Referer 不暴露给 B站。

**刷新周期**：同一「关键词 + 页码」的搜索结果服务端缓存 **10 分钟**（`widgets.yaml` → `bilibili_music.refreshInterval: 600000`）；工具栏刷新按钮带 `force=1` 可立即重搜（保留 60 秒最小间隔防风控）。左侧 9 源热榜仍是热榜 60 秒 / 资讯 5 分钟，互不影响。

**安全**：关键词去控制字符 / 压缩空白 / ≤60 字，页码 clamp 1–10，上游地址写死，`bvid` 与 CDN 域名双重白名单，音频接口只放行 GET / HEAD。

### 升级步骤（换镜像 + 同步三个配置文件）

1. 删 NAS 旧镜像 → 重拉 `boyu233/homepage-bookmark-manager:v1.0.3`（或离线 `docker load -i homepage-image-v1.0.3.tar`）→ 重建项目。
2. 同步配置：先备份 `custom.js` 里自定义过的 `WALLPAPER_*` 图源，然后删除挂载目录（compose `volumes` 冒号**左侧**）里的 `widgets.yaml`、`custom.js`、`custom.css` 三个文件，重启容器，日志出现 `Applied bundled default: ...` 即自动补齐 v1.0.3 版。**不要删 `bookmarks.yaml`**。也可用升级包里的同名文件直接覆盖。
3. **Ctrl+F5** 强刷。

| 只做了一半 | 现象 |
|---|---|
| 只换镜像，配置没同步 | 右侧仍是 v1.0.2 的「B站音乐榜」标题 / 旧样式，搜索框不出现（旧 `widgets.yaml` 没有新配置） |
| 只同步配置，镜像没换 | 页面显示 `Missing bilibili_music` 或旧榜单行为 |

### 自检

- 页面：右侧为搜索框 + 提示；搜「晴天」后出结果列表；点一条后出现音频控制条，**按 F12 检查 DOM 里没有 `iframe`**；音频控件能出声、可拖进度。
- 搜索 API：`/api/widgets/bilibili_music?index=4&q=%E6%99%B4%E5%A4%A9` → `query: "晴天"`、`items` ≤20、条目带 `bvid` / `rank` / `link`。
- 音频 API：`/api/widgets/bilibili_audio?bvid=BV1BZbSzZEGT` → `200` 或 `206`、`Content-Type: audio/mp4`；带非法 bvid 返回 `400`。
- 9 源热榜：`/api/widgets/news?index=3&source=weibo` → `sourceLabel: "微博热搜"`、`availableSources` 9 项。

### 排错

| 现象 | 原因 / 处理 |
|---|---|
| 搜索一直「暂不可用」 | 容器不能出网 `api.bilibili.com` 或被风控；看 `docker logs homepage` 的 `B站搜索失败`。简写 UA 会被判爬虫返回 `code=-352`，本版已统一完整 Chrome UA |
| 结果出来了，点条目没声音 | ① 浏览器拦了自动播放 → 手动点音频控件里的播放键；② 视频无独立音轨 → 面板显示「音频加载失败」，换一条；③ 容器不能出网 B站 CDN（`*.bilivideo.com` / `*.mcdn.bilivideo.cn`） |
| 音频播放卡 / 拖不动进度 | 代理需透传 Range；检查是否有 Nginx 反代缓冲了响应。直连容器 IP:端口 再试一次 |
| 有画面 / 出现 16:9 播放器 | 还是 v1.0.2 镜像或旧 `custom.css`，按上面第 1、2 步重做 |
| 想改每页条数 / 缓存 | 改 `widgets.yaml` 的 `bilibili_music.limit`（1-20）与 `refreshInterval`（毫秒），Ctrl+F5 即可，**不用换镜像** |
| 多人同时播放占带宽 | 音频经容器转发，184kbps 档约 6 MB / 首；属预期行为 |

---

## 6.8 v1.0.4：上下堆叠 + 歌单常驻 + 音量锁定（2026-11-09）

### 这一版改了什么

| 现象 | 原因 / 处理 |
|---|---|
| 音乐窗口被钉在页面左上角、缩小且半透明 | 上游 `index.jsx` 的 `rightAlignedWidgets` 不含 `bilibili_music`，它其实是 `#widgets-wrap` 的直接子节点，被旧 CSS 规则当成资源部件绝对定位。`custom.css` 现用 `display:contents` 打平右栏容器、用 `order` 固定部件顺序，无论 B站部件挂在左栏还是右栏都排在同一位置 |
| 首页左右两栏 | 按反馈改为**上下堆叠**：搜索框 → 大号时间 → 多源热搜 → B站搜索播放，每块占满整行 `min(1240px, 96%)`；窄屏只收窄宽度 |
| 点选歌曲后歌单消失 | 播放器在上、歌单在下同时显示，当前曲目高亮，可直接点其它条目切歌；「返回结果」改为「停止」；歌单限高滚动 |
| 每切一首音量回到 100% | 用户调整一次音量 / 静音后写入浏览器本地，之后每次挂载与开始播放自动应用，切歌、自动下一首、刷新页面都不回弹 |
| 分组卡片区被音乐面板越拉越高 | `custom.js` 上下堆叠后只测量热搜窗口作为对齐基准 |

### 升级步骤（必须换镜像 + 同步两个配置文件）

1. **换镜像**：Container Manager → 映像 → 删除旧的 `boyu233/homepage-bookmark-manager` 镜像 → 项目里把 `image` 改成 `:v1.0.4`（或 `:latest`）→ 清除并重建。离线部署则先导入 `homepage-image-v1.0.4.tar`。
2. **同步 `custom.css` 与 `custom.js`**：这两个是配置文件，入口脚本不会覆盖已存在的文件。二选一：
   - **A（推荐）**：从升级包直接覆盖这两个文件（若改过 `custom.js` 顶部的 `WALLPAPER_*` 图源，覆盖后把那几行填回去）。
   - **B**：先备份 `custom.js` 里自定义的 `WALLPAPER_*` 图源，删掉 `custom.css` + `custom.js`，重启容器由镜像内置 skeleton 自动补齐，再填回自定义图源。
3. `widgets.yaml`、`settings.yaml`、`services.yaml`、`bookmarks.yaml` **都不用动**。
4. 浏览器 **Ctrl+F5** 强制刷新（旧 CSS / JS 会缓存）。
5. 若页面仍是旧布局，按 8 节检查容器实际镜像 digest 是否为 v1.0.4。

### 自检

- 首页自上而下依次是：搜索框、大号时间、热搜榜、B站搜索框；热搜与音乐各占满整行，不再左右分栏。
- 搜一个关键词 → 点任意结果 → 播放器出现，下面歌单仍在且当前项高亮；点歌单里另一条可直接切歌。
- 把 `<audio>` 音量调到约 30%，点「下一个」或等自动切歌，音量仍保持 30%；刷新页面后依然保持。
- DOM 里没有 `iframe` / `<video>`；切换到其它书签分组，卡片区高度与热搜窗口一致，不随歌单变长。

### 排错

| 现象 | 处理 |
|---|---|
| 音乐窗口仍在左上角 | `custom.css` 没覆盖成功；确认文件属主 `1000:1000`，Ctrl+F5，必要时用 B 方案让容器重新生成 |
| 还是左右两栏 | 同上，说明加载的是旧 `custom.css` |
| 音量仍回弹 | 镜像未换成 v1.0.4（音量逻辑在镜像组件代码里，改配置文件无效） |
| 歌单只显示播放器 | 同上，镜像未换；也可用 `/api/widgets/bilibili_music?index=4&q=%E6%99%B4%E5%A4%A9` 确认 API 正常 |

---

## 6.9 v1.0.5：歌单改为「视频选集」（2026-11-09，当前）

### 这一版改了什么

| 现象 | 原因 / 处理 |
|---|---|
| 歌单里是不同标题的搜索结果，点每首只播该视频的第 1 个分P（例如 3:13 的「晚星」） | B站一个合集视频由几十到上百个**分P**组成，搜索结果只是「视频」。新增 `/api/widgets/bilibili_pages` 读 `wbi/view` 的 `data.pages`，把选集作为歌单；音频代理新增 `cid` 参数，按分P取音轨 |
| 选集里的曲名 / 时长对不上 | 每个分P有自己的 `part` / `duration` / `cid`，播放器标题、`x / N`、跳转链接 `?p=N`、自动下一首都按分P走 |
| 131 首一次铺开太长 | 选集每页 20 首可翻页；当前分P高亮，播放器与歌单同时显示 |
| 想回到搜索列表 / 只想停声音 | 「返回搜索结果」回到视频列表；「停止」只停播放、保留选集歌单，点任意一首可继续 |

### 升级步骤（必须换镜像 + 同步一个配置文件）

1. **换镜像**：映像 → 删除旧的 `boyu233/homepage-bookmark-manager` → 项目里把 `image` 改成 `:v1.0.5`（或 `:latest`）→ 清除并重建。离线部署先导入 `homepage-image-v1.0.5.tar`。
2. **同步 `custom.css`**：从升级包覆盖；或删掉 `custom.css` 重启，由镜像内置 skeleton 自动补齐。本次 `custom.js` **不用动**（若改过壁纸图源，别误删）。
3. `widgets.yaml`、`settings.yaml`、`services.yaml`、`bookmarks.yaml` **都不用动**。
4. 浏览器 **Ctrl+F5** 强制刷新。

### 自检

- 搜「纯音乐」→ 点第一条合集 → 顶部出现合集标题与「返回搜索结果」，歌单依次是 `01.晚星 - 逆时针向`、`02.夏恋 - Otokaze`、`03.秋日私语…`，共 131 首。
- 播放器显示当前分P曲名与 `1 / 131`；点「02」后 `<audio>` 地址变成 `...&cid=41105097363`，标题同步变化。
- 上一首 / 下一首 / 播完自动切下一首都在这 131 首之间；音量调到 30% 后切歌仍保持 30%；DOM 里仍没有 `iframe` / `<video>`。

### 排错

| 现象 | 处理 |
|---|---|
| 歌单仍是不同标题的搜索结果 | 镜像没换成 v1.0.5（选集逻辑在镜像组件代码里，改配置文件无效） |
| 点开视频显示「选集读取失败」 | B站 `wbi/view` 风控或网络不通，稍后点右上角刷新；可用 `/api/widgets/bilibili_pages?index=4&bvid=BV1sX8A6bEPr` 直接看返回 |
| 某首加载失败 | 个别分P无独立音轨或 B站临时拒绝，点下一首即可 |
| 返回按钮 / 合集标题错位 | `custom.css` 没覆盖成功，Ctrl+F5 或让容器重新生成 |

---

## 6.10 v1.1.0：安全与发布硬化（2026-11-10）

### 这一版改了什么

首页外观、热榜 9 源、B站选集 131 首、播放器与音量锁定**全部不变**。本版只做三件事：收紧公开读接口、补鉴权兜底、把发版搬到多架构 CI。

| 项 | 说明 |
|---|---|
| 追平上游 | fork 与上游 `main` 只差 3 个 commit / 2 个文件（`package.json` 版本号、Unraid 文档权限），已等价应用 |
| 5 个 GHSA | 逐条核验等效防护，并新增回归测试固化；针对 `GHSA-qxcr-4rv3-v23r`（按需重验证头绕过鉴权）额外加了三道防线 |
| 限流 | 4 个匿名 widget 接口按 IP 限流；音频代理另有并发上限与跨站盗链校验；默认阈值留足余量，不误伤首页 |
| 登录 | 弱 / 占位符 `NEXTAUTH_SECRET` 告警（可设严格模式拒绝启动）；密码连续失败 5 次锁定 5 分钟 |
| CI | GitHub Actions 产出 `amd64 + arm64` 双架构镜像，发版前强制全量 ESLint + Vitest 绿灯，Registry 侧校验 manifest 与三标签 |
| MCP | 代码早已实现 7 个工具，本版只补启用说明（默认仍关闭） |

### 升级步骤（**只换镜像**）

1. **必须换镜像**：`boyu233/homepage-bookmark-manager:v1.1.0`（或导入 `homepage-image-v1.1.0.tar`）。限流、鉴权兜底都在镜像代码里，只改配置文件无效。
2. **不用动任何配置文件**：`custom.css`、`custom.js`、`widgets.yaml`、`settings.yaml`、`services.yaml`、**`bookmarks.yaml`** 全部保持原样。compose 里新增的环境变量都是**可选**的，不配即用默认。
3. 重启项目 → **Ctrl+F5** 强刷。
4. **回滚**：把镜像 tag 改回 `:v1.0.5` 即可，配置层完全兼容，无需还原任何文件。

### 反向代理必须做的一件事

`GHSA-qxcr-4rv3-v23r` 的官方缓解措施是**在反代剥离 `x-prerender-revalidate` 请求头**。本 fork 已在应用层加了三层防护（API 层 `withAuth`、页面层 `withPageAuth`、proxy 拒绝伪造头），但公网部署仍建议照做：

```nginx
# Nginx / 群晖反向代理
proxy_set_header x-prerender-revalidate "";
```

同时让反代**覆盖** `X-Forwarded-For`（不要追加客户端自带值），否则限流可被伪造头绕过：

```nginx
proxy_set_header X-Forwarded-For $remote_addr;
```

### 可选：启用 MCP（让 AI 助手读改配置）

在 compose 的 `environment` 里加（**仅限内网**，token 能读到全部服务凭据）：

```yaml
      HOMEPAGE_MCP_ENABLED: "true"
      HOMEPAGE_MCP_TOKEN: "用 openssl rand -base64 32 生成，至少 32 位"
      # HOMEPAGE_MCP_ALLOW_WRITE: "true"   # 需要让 AI 改 YAML 时才开，默认关闭
```

自检（把地址和 token 换成自己的）：

```bash
# 不带 token 必须 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://<NAS>:3000/api/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# 带 token 返回 7 个工具
curl -s -X POST http://<NAS>:3000/api/mcp \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <TOKEN>' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | python -m json.tool
```

7 个工具：`list_config_files` / `read_config_file` / `validate_config_file` / `write_config_file` / `add_service` / `add_info_widget` / `homepage_docs`。写类工具默认返回「Writing is disabled」，必须显式设 `HOMEPAGE_MCP_ALLOW_WRITE=true`。

### 可选：限流与登录参数

被误伤时先调大阈值，不必关掉整个防护；应急才设 `HOMEPAGE_RATE_LIMIT_ENABLED: "false"`。

| 变量 | 默认 | 何时调整 |
|---|---|---|
| `HOMEPAGE_PUBLIC_WIDGET_LIMIT` | `180`/分钟/IP | 首页刷新报 429 时调大 |
| `HOMEPAGE_AUDIO_LIMIT` | `60`/分钟/IP | 频繁拖进度条触发 429 时调大 |
| `HOMEPAGE_AUDIO_CONCURRENT` | `4` | 多标签页同时播放触发 503 时调大 |
| `HOMEPAGE_TRUST_PROXY` | `true` | 反代没有覆盖 `X-Forwarded-For` 时设 `false`（改用 socket 地址） |
| `HOMEPAGE_PUBLIC_ORIGINS` | 空 | 音频需从额外域名访问时填完整 URL，逗号分隔 |
| `HOMEPAGE_REQUIRE_STRONG_SECRET` | `false` | 设 `true` 后占位符 secret 会直接拒绝启动 |
| `HOMEPAGE_LOGIN_MAX_FAILURES` | `5` | 登录失败锁定阈值 |

### 自检

```bash
# 首页与三个核心链路
curl -s -o /dev/null -w "home=%{http_code}\n" http://<NAS>:3000/
curl -s "http://<NAS>:3000/api/widgets/news?index=3&source=weibo" | python -c "import sys,json;d=json.load(sys.stdin);print('news',len(d['items']),'sources',len(d['availableSources']))"
curl -s "http://<NAS>:3000/api/widgets/bilibili_pages?index=4&bvid=BV1sX8A6bEPr" | python -c "import sys,json;d=json.load(sys.stdin);print('pages',d['total'])"

# 限流生效：连续快速请求音频，后面应出现 429（正常播放不受影响）
for i in $(seq 1 70); do curl -s -o /dev/null -w "%{http_code} " "http://<NAS>:3000/api/widgets/bilibili_audio?bvid=BV1sX8A6bEPr"; done; echo

# 安全响应头
curl -sI "http://<NAS>:3000/api/widgets/news?index=3" | grep -i "x-ratelimit\|x-content-type\|referrer-policy"

# 未登录访问 /manage 应跳登录页（验证重验证头绕过已封堵）
curl -s -o /dev/null -w "%{http_code}\n" -H "x-prerender-revalidate: anything" http://<NAS>:3000/manage
```

### 排错

| 现象 | 原因 / 处理 |
|---|---|
| 首页热搜空白、部件全 429 | 反代没覆盖 `X-Forwarded-For`，所有访客被算成同一个 IP；先调大 `HOMEPAGE_PUBLIC_WIDGET_LIMIT`，再修反代头 |
| 切歌时偶尔 503 | 音频并发到上限，调大 `HOMEPAGE_AUDIO_CONCURRENT` |
| 启动日志出现「NEXTAUTH_SECRET 疑似占位符」 | 用 `openssl rand -base64 32` 重新生成并重启；别把占位符带到公网 |
| 忘记密码被锁 5 分钟 | 等 5 分钟，或重启容器清空内存计数（不影响书签） |
| 从别的域名嵌入播放报 403 | 把该域名填进 `HOMEPAGE_PUBLIC_ORIGINS` |

---

## 6.11 v1.2.0：网页上传配置，不用再拉镜像（2026-11-10，当前）

### 这一版改了什么

管理页多了第三个页签「配置更新」。登录后直接把配置文件拖进网页上传，服务端校验 → 备份 → 原子写 → 清缓存，首页自动刷新。**以后改书签、样式、部件配置都不用拉镜像、不用进群晖文件管理器、不用重启容器。**

| 项 | 说明 |
|---|---|
| 可上传文件 | 9 个：`settings.yaml` / `services.yaml` / `bookmarks.yaml` / `widgets.yaml` / `docker.yaml` / `kubernetes.yaml` / `proxmox.yaml` / `custom.css` / `custom.js`，文件名必须保持原样 |
| 批量上传 | 支持多选 / 拖拽；升级包解压后全选即可一次覆盖多个文件 |
| 上传前校验 | YAML 语法 + 顶层结构（防止把 bookmarks 传成 widgets）、单文件 512KB 上限、拒绝二进制内容；不合法就不写盘 |
| 自动备份 | 写盘前生成 `<文件名>.<时间戳>.bak`，每个文件保留最近 10 份；页面里可下载留档、一键回滚（回滚前再备份当前内容） |
| 立即生效 | 写后清 `dashboard` 内存缓存；首页通过 `/api/hash` 自动刷新；`custom.css` / `custom.js` 加了 `no-cache`（Next.js 自带内容 ETag / 304），不会被浏览器旧缓存挡住 |
| 安全 | 必须登录；显式同源校验防 CSRF；写请求每 IP 限 30 次/分钟；文件名固定白名单，杜绝路径穿越 |

> ⚠️ **本次升级仍要换一次镜像**（新增 API 与页面，属于 `src/` 代码改动）。换完之后，日常配置改动就再也不用拉镜像了。

### 升级步骤（**只换镜像，一个配置文件都不用覆盖**）

1. 把 compose 的 image 改成 `boyu233/homepage-bookmark-manager:v1.2.0`（或导入 `homepage-image-v1.2.0.tar`）。
2. **不要覆盖** `custom.css` / `custom.js` / `widgets.yaml` / `bookmarks.yaml` / `settings.yaml`，保持原样。新增环境变量都是可选的，不配即用默认。
3. 重建项目 → 登录 → 首页右下「管理书签」→ 切到「配置更新」页签，能看到 9 个文件列表即升级成功。
4. **回滚**：镜像 tag 改回 `:v1.1.0`。上传产生的 `.bak` 备份留在配置目录里，不影响回滚。

### 日常用法

1. 在本机准备好要改的文件（或直接解压升级包），**文件名保持 `custom.css` / `widgets.yaml` 等原名**。
2. 浏览器打开 `http://<NAS>:3000/manage`（未登录会跳登录页）→「配置更新」。
3. 拖进去或点「选择文件（可多选）」→ 页面逐文件显示 ✓ / ✕ 校验结果 → 点「上传并应用」。
4. 结果里会显示每个文件的备份名；首页会自动刷新。若样式看起来没变，按一次 **Ctrl+F5**。
5. 改错了：在「备份与回滚」区找到上传前那个 `.bak`，点「回滚」。

> 书签 YAML 损坏导致管理页报「书签加载失败」时，可直接访问 `/manage?tab=files` 进入配置更新页上传修复。

### 可选参数

| 变量 | 默认 | 说明 |
|---|---|---|
| `HOMEPAGE_CONFIG_UPLOAD_MAX_BYTES` | `524288` | 单文件字节上限，硬上限 2MB |
| `HOMEPAGE_CONFIG_WRITE_LIMIT` | `30` | 每 IP 每分钟写请求（上传 / 校验 / 回滚）次数 |

### 自检（把地址换成自己的）

```bash
# 未登录访问上传接口必须 401
curl -s -o /dev/null -w "%{http_code}\n" http://<NAS>:3000/api/config/upload
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://<NAS>:3000/api/config/upload \
  -H 'Content-Type: application/json' -d '{"file":"custom.css","content":"body{}"}'
```

### 排错

| 现象 | 原因 / 处理 |
|---|---|
| 提示「文件名不在允许列表内」 | 上传时改过名（如 `custom (1).css`）；改回 9 个原始文件名之一 |
| 提示「顶层应为数组 / 对象」 | 传错文件了，例如把 `bookmarks.yaml` 的内容传成了 `widgets.yaml` |
| 上传成功但样式没变 | 浏览器缓存，Ctrl+F5 强刷；`kubernetes.yaml` / `proxmox.yaml` 不在 hash 列表，改这两个需手动刷新 |
| 上传后 429 | 触发写限流，调大 `HOMEPAGE_CONFIG_WRITE_LIMIT` 或等一分钟 |
| 想批量上传升级包 | 先解压，再在「选择文件」里全选解压出的配置文件（不支持直接传 zip） |

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

   确认 digest 是 `sha256:678821c624c…ee71616d`（见第 5 节 A）再回第 6 节重建项目。若仍是 `4a78326d…`，说明加速源还在缓存上一版，等同步或改用 5-C 的 tar 导入。

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
- [ ] **（v1.1.0 新增）反向代理剥离 `x-prerender-revalidate` 请求头**（`proxy_set_header x-prerender-revalidate "";`），对应 `GHSA-qxcr-4rv3-v23r`
- [ ] **（v1.1.0 新增）反向代理覆盖 `X-Forwarded-For`**（`proxy_set_header X-Forwarded-For $remote_addr;`），否则公开读限流可被伪造头绕过
- [ ] **（v1.1.0 新增）`NEXTAUTH_SECRET` 不是 `CHANGE_ME` / 测试值 / 重复字符**；生产建议设 `HOMEPAGE_REQUIRE_STRONG_SECRET=true`
- [ ] **（v1.1.0 新增）若启用 MCP**：token ≥32 位、只限内网访问、`HOMEPAGE_MCP_ALLOW_WRITE` 默认保持 `false`；token 能读到 `services.yaml` 里的凭据
- [ ] **（v1.2.0 新增）配置上传接口保持仅登录可用**：`HOMEPAGE_PUBLIC_READ_PATHS` 不要加 `/api/config/upload`（已在代码里列为保留路径），也不要把 `/manage` 无鉴权暴露到公网；上传前先下载一份配置留档

更完整的验收矩阵与安全说明见 [`群晖部署清单.md`](./群晖部署清单.md)。
