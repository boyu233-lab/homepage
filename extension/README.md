# Homepage 新标签页（Chrome / Edge 扩展）

把浏览器的「新标签页」和「启动时」都指向你自托管的 Homepage 导航页，效果类似 WeTab，但页面完全来自你自己的服务，不经过任何第三方。

Manifest V3，**只申请 `storage` 一个权限**，不申请 `tabs`、不申请主机权限、无网络请求、无遥测、无预置地址。

## 功能

| 场景 | 行为 |
|---|---|
| 新建标签页 / Ctrl+T | 自动整页跳转到 Homepage |
| 启动浏览器 | 若本次启动没有经过新标签页（例如「继续上次会话」「打开特定网页」），启动后自动补开一个 Homepage 标签；已经由新标签页打开则不重复开 |
| 点击扩展图标 | 一键打开 Homepage、切换「启动时自动打开」、进入完整设置 |
| 想改设置 | 新建标签页后按住 `Shift`，或点「留在此页」，即可停在启动页 |

设置项：Homepage 地址、跳转延迟（0–3000 ms）、启动时自动打开、Shift 暂停。首次安装会自动打开设置页，填完地址立即生效。

## 安装

1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`），右上角开启**开发者模式**。
2. 点「加载已解压的扩展程序」，选择本 `extension/` 目录。
3. 首次安装会弹出设置页，在「Homepage 地址」里填你的导航页地址，例如 `https://nav.example.com` 或 `192.168.1.100:3000`，保存。
4. 按 `Ctrl+T` 验证。

> 扩展用 `chrome_url_overrides.newtab` 接管新标签页，**同类扩展只能生效一个**。若装了 WeTab、Infinity 等，请先停用，否则 Chrome 会让其中一个失效。

## 配合服务端（重要）

项目里的 Homepage 会校验请求头 `Host`，并有独立的登录回调基址，外网访问时请确认：

- 扩展里填的域名（含端口）已写进 `HOMEPAGE_ALLOWED_HOSTS`；
- `NEXTAUTH_URL` 就是浏览器地址栏里的完整对外地址，否则登录后会被送回局域网地址；
- 走反向代理时透传 `Host`，并补 `X-Forwarded-Proto=https`、`X-Forwarded-Host=域名`。

详见 [`deploy/群晖Docker部署方法.md`](../deploy/群晖Docker部署方法.md) 第 3.1 节。

### 浏览器启动方式

- 推荐：Chrome「设置 → 启动时 → 打开新标签页」。此时新标签页接管天然生效，一个标签、不重复。
- 若选「继续上次会话」或「打开特定网页」：扩展的 `onStartup` 会在启动约 1.5 秒后自动打开 Homepage；可在弹窗或设置页关掉这个行为。
- 设置页里有「Chrome 启动设置」按钮可直接跳到 `chrome://settings/onStartup`。

## 为什么是「整页跳转」而不是 iframe 内嵌

自托管站点普遍带 `X-Frame-Options` / CSP `frame-ancestors` 限制（群晖反向代理还可能额外加头），iframe 会被直接拦掉；跨域 iframe 里登录 Cookie 也容易因 SameSite 失效，管理页还会被困在框里。整页跳转没有这些问题：地址栏是真实地址、登录态正常、书签管理可直接使用，视觉上仍是「打开新标签页就是导航页」。

## 隐私与权限

- 配置存在 `chrome.storage.local`（仅本机），**不使用 `storage.sync`**，你的内网域名 / 域名不会同步到 Google 账号。
- 只申请 `storage`：读取标签 URL 需要 `tabs` 权限（会显示「读取浏览记录」警告），这里改用 `chrome.storage.session` 里的会话标记来避免重复开标签，因此完全不需要它。
- 代码里没有任何真实地址、密钥或远端接口；`homepage_url` 指向公开仓库主页。
- 跳转目标由你自己填写，扩展不会向任何第三方发起请求。

## 目录结构

```
extension/
├── manifest.json          # MV3 清单：接管 newtab、service worker、popup、options
├── common.js              # 配置读写 / URL 白名单校验（http/https）
├── background.js          # onInstalled 首次引导、onStartup 启动兜底、消息标记
├── newtab.html/js/css     # 新标签页启动画面与跳转逻辑
├── popup.html/js         # 点击图标的快捷面板
├── options.html/js       # 完整设置页
├── settings.css          # popup / options 共用样式（跟随系统深浅色）
└── icons/                # 16 / 48 / 128 PNG
```

## 打包分发

- 自用：直接把整个 `extension/` 目录复制给别人「加载已解压的扩展程序」。
- 打包成 `.crx`：`chrome.exe --pack-extension=<extension 目录>`（会生成私钥，请自行保管）。
- 上架 Chrome Web Store 需要开发者账号与审核；本扩展不含外部依赖，可原样提交。

## 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| Ctrl+T 还是原来的新标签页 | 有其它新标签页扩展占用了 override，停用它们；或在 `chrome://extensions` 里确认本扩展已启用 |
| 页面报 `Host validation failed` | 把域名（含端口）加进服务端 `HOMEPAGE_ALLOWED_HOSTS`，重建容器 |
| 登录后跳回局域网地址 | 服务端 `NEXTAUTH_URL` 没改成外网地址，见部署文档 3.1 |
| 启动浏览器开了两个 Homepage | 一般不会；若出现，关掉设置页里的「启动时自动打开」，只靠新标签页接管 |
| 想换地址 | 新建标签页后按住 Shift 停留 → 设置；或点扩展图标 → 完整设置 |
| 跳转太快 / 太慢 | 设置页调「跳转延迟」，默认 700 ms，0 为立即 |
