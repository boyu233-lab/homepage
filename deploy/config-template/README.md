# 定制配置模板（镜像已内置，本包为可选参考）

> ⚠️ **状态更新**：自提交 `413f3e8` 起，这套配置已**脱敏后内置进镜像**的 `src/skeleton/`。
> 全新部署会自动获得定制外观；旧部署由入口脚本自动补齐空文件 / 官方默认文件，且不会覆盖用户自己的配置。
> **正常情况下不再需要手动上传本包**。本目录现用于：手动覆盖、自定义壁纸源 / 分组图标、排查时对照。
> 升级做法：删掉 NAS 上的旧镜像 → 重新拉取 → 重建项目 → Ctrl+F5。

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
| `widgets.yaml` | 顶部 CPU / 内存 / 磁盘 / 搜索组件 |
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
