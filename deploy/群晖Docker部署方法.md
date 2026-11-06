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

`NEXTAUTH_URL` 必须与实际访问地址一致：`http` 还是 `https`、带不带端口都要对。写成 `https` 时会话 cookie 会启用 Secure 属性，走纯 HTTP 访问会登录不上。若通过反向代理用域名访问，同时把域名和内网 IP 都写进 `HOMEPAGE_ALLOWED_HOSTS`。

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

镜像已构建并推送到 Docker Hub，**公开仓库、免登录**，`linux/amd64`，YAML 里已填好地址：

| 标签 | 用途 |
|---|---|
| `boyu233/homepage-bookmark-manager:latest` | 当前最新，配套 YAML 默认使用 |
| `boyu233/homepage-bookmark-manager:sha-2b5aefa` | 固定版本，回滚 / 复现用 |

- 群晖：Container Manager → **映像 → 添加 → 从 URL 添加**，填 `boyu233/homepage-bookmark-manager:latest`；或 SSH `docker pull boyu233/homepage-bookmark-manager:latest`。
- 也可直接跳到第 6 节创建项目，Container Manager 会自动拉取。
- 镜像 digest：`sha256:89df55969cee5ef9fdc5acc7f7cdf23acc94657acda9419d2222f68229e34d1b`（两个标签指向同一镜像）。

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
| 打开页面 `400 Host validation failed` | 访问用的 host 不在白名单 | 把域名 / IP（含端口）补进 `HOMEPAGE_ALLOWED_HOSTS`，改完重建项目 |
| 登录页 `Authentication error / Auth is disabled or misconfigured` | 四个必需 env 缺失或 `NEXTAUTH_SECRET` 不足 32 位 | 对照第 3 节补齐，重建容器 |
| 登录成功但首页没有「管理书签」 | 浏览器里混用了 `localhost` / IP / 域名，会话 cookie 不互通 | 全程固定用同一个地址；清掉该站点的 cookie 重新登录 |
| 反代后反复跳回登录页 | `NEXTAUTH_URL` 写成 `http`，实际访问是 `https`（或反之） | 改成与实际协议一致，并在反代里正确传 `X-Forwarded-Proto` |
| 管理页保存报 500 | 配置目录 UID 1000 不可写 | 重做第 4 节 `chown`；看容器日志确认 |
| 匿名访问 `/api/config/bookmarks` 返回 401 | **这是预期行为**，不是故障 | 登录后才有权限 |
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

2026-11-06 实测 `https://docker.1panel.live` 可用：返回的目标镜像 digest 与 Docker Hub 上的 `sha256:89df5596…341d1b` 完全一致，manifest 与镜像层 blob 均可正常下载。

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
     "registry-mirrors": ["https://docker.1panel.live"]
   }
   ```

3. **套件中心 → Container Manager → 停止 → 启动**（不要重启整台 NAS）。图形界面重启最稳妥，也可用 `synosystemctl restart pkgctl-ContainerManager`。
4. 验证并重新拉：

   ```bash
   docker info | grep -A 3 "Registry Mirrors"
   docker pull boyu233/homepage-bookmark-manager:latest
   docker images --digests | grep homepage-bookmark-manager
   ```

   确认 digest 是 `sha256:89df55969cee…341d1b` 再回第 6 节重建项目。

> 加速站是第三方服务，随时可能失效。备用源可换成 `https://docker.m.daocloud.io`、`https://docker.1ms.run`（实测 `/v2/` 返回 401 属正常，表示服务在线）；换之前先 `curl -I https://<域名>/v2/` 探一下。

#### 方案 2（不开 SSH）：直接在图形界面拉加速源地址

Container Manager → **映像 → 添加 → 从 URL 添加**，填：

```
docker.1panel.live/boyu233/homepage-bookmark-manager:latest
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
