# 定制配置模板（镜像已内置，本包为可选参考）

> ⚠️ **状态更新**：自提交 `413f3e8` 起，这套配置已**脱敏后内置进镜像**的 `src/skeleton/`。
> 全新部署会自动获得定制外观；旧部署由入口脚本自动补齐空文件 / 官方默认文件，且不会覆盖用户自己的配置。
> **正常情况下不再需要手动上传本包**。本目录现用于：手动覆盖、自定义壁纸源 / 分组图标、排查时对照。
> 升级做法：删掉 NAS 上的旧镜像 → 重新拉取 → 重建项目 → Ctrl+F5。
>
> 📌 **v1.0.3 起右侧 B站部件改为「搜索 → 手动选播 → 纯音频，不显示画面」**（左侧 9 源热榜与双栏布局不变）。已有部署升级必须**同时换镜像 + 同步 `widgets.yaml` / `custom.js` / `custom.css` 三个文件**（最省事：备份 `custom.js` 的壁纸图源后删掉这三个文件，重启容器由入口脚本自动补齐）。详见部署文档 **6.7 节**；6.6 节为 v1.0.2 历史记录。
>
> 📌 **v1.0.1 起新闻部件已改为百度热搜榜**（只换镜像即可，不需要再传 `widgets.yaml`；如需改标题/条数见部署文档 6.5 节）。以下三部件说明是 v1.0.0 的历史记录。
>
> 📌 **但本次「多引擎搜索 / 时间 / 实时新闻」三个部件例外**：它们依赖新版镜像里的代码 + 新的 `widgets.yaml`。
> 新版镜像已于 **2026-11-07 11:05** 推送 Docker Hub（`:latest` / `:sha-4d61e9b`，digest `sha256:58b2c52c…1ec2`）：删掉 NAS 旧镜像重拉即可，详见部署文档 **5-A**。
> 已有部署的 `widgets.yaml` 是用户自己的非空文件，入口脚本不会覆盖，所以**必须手动上传一次本目录的 `widgets.yaml`**（见部署文档 6.2 节）。
> 只传这一个文件即可，`custom.js` / `custom.css` / `settings.yaml` / `services.yaml` / `bookmarks.yaml` 都不用动。

## 历史背景：为什么以前需要

镜像里只包含**代码**。本 fork 的可见定制（在线壁纸按钮、左侧分组导航、极光瓷砖样式、深色紫色主题）全部由配置目录下的 `custom.js` / `custom.css` / `settings.yaml` 提供，而镜像内 `src/skeleton/` 里这三个文件是**空的或官方默认值**。

如果挂载目录里没有这些文件，Homepage 启动时会从 skeleton 自动拷贝一份，页面就变成官方原版外观：三个 `My First/Second/Third Group` 演示服务、系统信息条、纯色背景，没有在线壁纸按钮。这不是镜像坏了，**不用重新拉镜像**。

「管理书签」按钮属于镜像代码，但设计上**仅登录后可见**；未登录时首页故意不放任何管理入口。

## 手动覆盖清单（可选）

只有想改壁纸源、分组图标等才需要上传。目标目录是 compose `volumes` 冒号**左侧**的宿主机路径，例如 `/volume1/docker/homepage1/config/`：

| 文件 | 作用 |
|---|---|
| `custom.js` | 左侧分组导航 + 右下角「在线壁纸」「换一张」按钮 |
| `custom.css` | 极光背景、瓷砖卡片样式、导航排版 |
| `settings.yaml` | 深色紫色主题、快捷搜索、关闭原生折叠 |
| `widgets.yaml` | 顶部 CPU / 内存 / 磁盘 + **多引擎搜索（百度/Bing/Google/DuckDuckGo/Brave）+ 中文时间 + 百度热搜榜** |
| `services.yaml` | 空列表，清掉官方三个演示服务分组 |

⚠️ **不要上传或覆盖 `bookmarks.yaml`**。那里面是你自己的真实书签，本模板刻意不包含它。

上传后确保目录属主可写：`sudo chown -R 1000:1000 /volume1/docker/homepage1/config`。

## 手动覆盖时的生效步骤

1. 只上传要改的那几个文件（**别覆盖 `bookmarks.yaml`**）。注意入口脚本不会覆盖已修改的非空文件，所以手动改完会一直生效。
2. Container Manager → 项目 → 停止 → **清除缓存并重建**（或 SSH 里 `docker compose down && docker compose up -d`）。custom.js / custom.css 有缓存，只刷新浏览器可能不生效。
3. 浏览器 **Ctrl+F5** 强制刷新。
4. 页面应出现：左侧竖排分组导航、右下角「在线壁纸」/「换一张」、暗紫极光背景；官方演示服务消失。

## 判断镜像是不是本 fork

在 NAS 上执行（或浏览器直接访问）：

```bash
curl -i http://127.0.0.1:3030/manage | head -5
```

- `307` 跳转到 `/auth/signin?...` → **镜像正确**。若页面仍是官方原版外观，说明拉到的是旧镜像：删掉 NAS 上旧镜像 → 重拉 → 重建，新镜像会自动补齐配置。
- `404` → 拉到的是官方 `gethomepage/homepage` 镜像。检查 compose 的 `image` 是否为
  `docker.1ms.run/boyu233/homepage-bookmark-manager:latest`，并先删掉 NAS 上的旧镜像再重建。

## 打开管理界面

浏览器访问 `http://<NAS-IP>:3030/manage`（未登录会跳登录页），输入 `HOMEPAGE_AUTH_PASSWORD`。
登录成功后回到首页，**左下角**才出现「管理书签」，管理页右上角有「退出」。

注意：全程固定用同一个地址（IP 或域名），`localhost` 与 IP 之间 cookie 不互通，混用会导致「登录了却没有管理按钮」。

## 可选调整

- **分组图标**：`settings.yaml` 末尾有注释掉的 `layout` 示例，取消注释并把「你的分组名」改成 `bookmarks.yaml` 里的真实分组名，图标用 `mdi-xxx` / `si-xxx`。不写也能正常显示。
- **壁纸自托管**：`custom.js` 顶部 `WALLPAPER_TODAY` / `WALLPAPER_RANDOM` 换成自己 NAS/Nginx 上的图片 URL；两组都写成 `[]` 可彻底关闭第三方图片请求，页面保持极光背景。
- **关闭左侧导航**：清空 `custom.js` 即可（壁纸按钮会一起消失）。

## 首页视图布局（v1.0.3 双栏，2026-11-09）

`custom.js` / `custom.css` / `widgets.yaml` 三件套协同。**v1.0.3 的部件代码在镜像里，已有部署必须同时换镜像 + 同步这三个配置文件**（详见部署文档 6.7 节）：

- 左侧导航最上方固定「首页」虚拟分组（小房子图标），首次访问默认进入；选中状态存 localStorage。
- 首页视图（`body.home-view`）下 **搜索框 → 中文时间** 跨整行居中；时间字号 `clamp(2rem, 4.4vw, 3.4rem)`、`font-weight: 800`；书签卡片隐藏。
- **9 源热榜 | B站音乐搜索 左右并排**（两列 grid，总宽 `min(1240px, 96%)`，间距 22px）；屏宽 ≤900px 回落为上下堆叠。
- B站音乐（v1.0.3）：搜索框 + 最近搜索词 + 示例词；搜出结果后显示序号 / 标题 / 播放量 / 时长 + 「在 B站打开」；点击条目把列表**替换**为**纯音频**控制条（无 iframe、无封面、无画面），可上一个 / 下一个、播放结束自动切下一首。音频由服务端 `/api/widgets/bilibili_audio` 代理（B站 CDN 强制校验 Referer）。
- 切到其它书签分组时，时间 / 热搜 / 音乐榜自动隐藏，顶部只留资源信息与搜索框。
- 切换分组后，右侧卡片区与首页**两栏联合外框**（最小 top / 最大 bottom）同起点、同高度；`custom.js` 的 `ResizeObserver` 同时观察两个面板（见部署文档 6.4 / 6.6 节）。
- 左侧导航桌面/平板**任何屏宽都保持竖排**，且**固定在第一版面同一位置**：`.group-nav { position: absolute; top: clamp(180px, 36vh, 380px) }` + `.nav-layout { padding-left: 190px }` 保留占位。手机（≤560px）改为顶部横排标签条。

> ⚠️ 部件（含 `bilibili_music` / `news`）属于**组件代码**，只覆盖配置文件不会出现；只同步配置不换镜像会显示 `Missing bilibili_music`。
> ⚠️ **v1.0.1 起 `HOMEPAGE_NEWS_SOURCES` / `HOMEPAGE_NEWS_FEEDS` / `news.url` 全部失效**，接口地址固定写死在组件里，详见部署文档 6.5 / 6.6 节。
> ⚠️ 播放器 iframe 由浏览器直连 B站，点播时会向 B站暴露访客 IP / Referer；榜单接口由容器代理，不暴露。

调整入口：集中在 `custom.css` 末尾「首页视图」区块（双栏宽度、窄屏断点、字号、配色）；默认视图在 `custom.js` 的 `activate(HOME_GROUP)`；部件顺序、`news.limit`（1-50）/ `bilibili_music.limit`（1-20）与刷新间隔在 `widgets.yaml`：`news.refreshInterval: 60000`（热搜实时）、`bilibili_music.refreshInterval: 86400000`（音乐日榜 24 小时，同时决定服务端缓存）。**v1.0.2 起热榜面板顶部有 9 个来源标签**（百度 / 微博 / 知乎 / 头条 / 抖音 / B站热搜 + Bing / IT之家 / 少数派资讯），来源写死在镜像代码里、标签选择记在浏览器，不需要改 `widgets.yaml`。改完记得 Ctrl+F5，custom.js / custom.css 有浏览器缓存。
