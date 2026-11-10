# 版本兼容矩阵（升级清单速查）

> 每次发版必须在此追加一行。**「必须换镜像」= 改了 `src/` 下的 React/API 代码；只改配置层 = 覆盖文件 + Ctrl+F5 即可。**
> `bookmarks.yaml` 从 v1.0.0 起**永远不需要覆盖**，入口脚本也不会覆盖用户已修改的配置。

| 版本 | 镜像 tag | 必须换镜像 | 必须覆盖的配置文件 | 可不动 | 新增可选环境变量 | 回滚 |
|---|---|:--:|---|---|---|---|
| v1.0.0 | `:v1.0.0` | 是 | 首次部署全套 skeleton | — | — | tag 回退 |
| v1.0.1 | `:v1.0.1` | 是 | `news` 部件相关（历史） | `custom.js` / `custom.css` | 旧 `HOMEPAGE_NEWS_*` 失效 | tag 回退 |
| v1.0.2 | `:sha-cc55e97` | 是 | `custom.js` / `custom.css` / `widgets.yaml` | `bookmarks.yaml` | — | tag 回退 |
| v1.0.3 | `:v1.0.3` | 是 | `widgets.yaml` / `custom.js` / `custom.css` | `bookmarks.yaml` | — | tag 回退 |
| v1.0.4 | `:v1.0.4` | 是 | `custom.css` / `custom.js` | `widgets.yaml` / `bookmarks.yaml` | — | tag 回退 |
| v1.0.5 | `:v1.0.5` | 是 | `custom.css` | `custom.js` / `widgets.yaml` / `bookmarks.yaml` | — | tag 回退 |
| v1.1.0 | `:v1.1.0` | 是 | 无 | 全部配置文件 | 限流 / 登录锁定 / 弱 secret / MCP（可选） | tag 改回 `:v1.0.5` |
| **v1.2.0** | `:v1.2.0` | **是（最后一次）** | **无** | **全部配置文件** | 上传体积上限 / 写限流（可选） | tag 改回 `:v1.1.0` |

## 判断口径

1. 改了 `src/components/**`、`src/pages/api/**`、`src/utils/**`、`src/proxy.js` → **必须换镜像**。
2. 只改 `src/skeleton/custom.css` / `custom.js` / `widgets.yaml` → 覆盖对应文件 + **Ctrl+F5**，镜像可不动。
3. 升级包里的 `MANIFEST.sha256` 用于核对包内配置与仓库 `src/skeleton/` 是否一致；不一致时以仓库 tag 为准。
4. 入口脚本 `docker-entrypoint.sh` 只在配置文件缺失 / 为空 / 与官方默认逐字节一致时自动补齐，不会覆盖用户编辑过的文件。

## v1.2.0 特别说明

本版是**最后一次因为「改配置」而必须换镜像**：新增了上传 API 与管理页页签，属于 `src/` 代码改动。
装好 `:v1.2.0` 之后，修改 9 个配置文件（YAML / CSS / JS）一律走网页上传，规则 2 的「覆盖文件 + Ctrl+F5」不再是必需步骤
（当然仍可继续用文件管理器手动覆盖，两者等价）。上传接口会自己备份、校验、清缓存，并让首页自动刷新。

## v1.1.0 特别说明

本版没有 UI 改动，**预览页与首页外观和 v1.0.5 完全相同**。升级只需换镜像；
若使用反向代理，请按部署文档 6.10 节补两条 `proxy_set_header`（剥离 `x-prerender-revalidate`、覆盖 `X-Forwarded-For`）。
