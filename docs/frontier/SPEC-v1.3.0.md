# Spec - Homepage fork 前沿能力 S1-S5（v1.3.0 增量）

> 生成：2026-11-12 | 状态：已确认（用户授权「你看着完成」，视为三文档预确认）
> 基线：`feat/v1.3.0-frontier`，from `dev` @ `1f8dfdb`（v1.2.0 文档回填）
> 依据：`homepage-前沿功能方案-2026-11.md` + 2026-07-28 MCP 官方规范实测 + 本仓库代码核查
> 口径：163 个服务集成是外部应用数据窗，不计入功能

---

## 1. 产品定义

- 一句话：在不改变现有首页观感的前提下，让 fork 同时具备 Agent 可操作性、故障时可用、键盘可达、情境可变。
- 目标用户：单人 NAS 自托管，公开首页 + 登录管理页。
- 核心问题：现有首页「出错即空白、状态不可判断、只能鼠标逐层找、无差异化」，且 MCP 协议版本落后一代。

## 2. MVP 范围（锁定，不在此表的功能一律不做）

| 编号 | 功能 | 验收标准摘要 | 默认行为 |
|---|---|---|---|
| S1 | MCP dual-era（2025-11-25 + 2026-07-28） | legacy 请求逐字节等价；modern 请求通过 `_meta` 校验、`server/discover`、头部路由、三个新错误码 | 不变 |
| S5 | 统一数据信封 + 按源降级 + 新鲜度 | 失败返回保留上次成功数据并标 `stale`；健康端点列出各源状态 | 不变 |
| S3 | 全局 Ctrl/Cmd+K 本地模糊检索 | 书签/服务本地加权匹配，Esc 关闭，方向键 + Enter 打开 | 不触发即无 UI |
| S4 | 情境 profiles | `settings.yaml` 无 `profiles` 键时行为完全一致 | 关闭 |
| S2 | 原生交互无损增强 | 只增渐进增强 CSS，不动既有 DOM 注入逻辑 | 不变 |

## 3. 明确不做（Out-of-Scope）

| 不做 | 原因 |
|---|---|
| 163 个服务集成显示窗 | 外部应用数据窗，非导航页功能（用户 11-12 明确口径） |
| H1-H15 扩展钩子 / O2 白名单断言 | 属 v1.3.0 原计划，本轮不擅自扩范围 |
| 多用户 / RBAC / WS-SSE / 同步引擎 / 本地 LLM | 既有结论 |
| 改 `custom.js` 的左侧导航与背景切换逻辑 | 用户日常在用，且核查证明它不是部件错位根因 |
| 更换底座 / 引入数据库 / 新增依赖 | 五项均不需要 |
| 推远端、构建镜像、动线上 9 个配置文件 | 交付边界 |

## 4. 关键设计裁决（ Deviation from 方案原文 ）

**D1 — S5 信封改为「顶层展平 + `_envelope`」，不是方案原文的 `{ data, fetchedAt, stale, error }`。**
理由：16 类部件前端全部按顶层字段读取（`data.current_weather.temperature`、`data.items`、`data.stocks`）。若把 payload 收进 `data`，需同时改 16 个组件，且任一遗漏即白屏，违反「默认不改变现有行为」。裁决：

```json
{
  "...原 payload 全部字段原样保留...": "...",
  "_envelope": {
    "source": "openmeteo",
    "fetchedAt": "2026-11-12T09:00:00.000Z",
    "ageMs": 0,
    "stale": false,
    "state": "fresh | stale | error",
    "error": null
  }
}
```

`error` 非空时为 `{ "kind": "...", "message": "..." }`，`kind` 枚举：
`config_missing` / `upstream_error` / `invalid_params` / `auth_required` / `disabled` / `unknown`。

**D2（已修正，2026-11-12）— 仅「上游失败/超时」返回 HTTP 200 + 信封；参数校验类 4xx 保持原状。**
理由：SWR 把非 2xx 当网络错误，直接走 `widget/error.jsx` 的通用「API error」卡片，这是要修的病；但代码核查发现 `glances.test.js` / `bilibili_pages.test.js` / `customapi.test.js` / `stocks.test.js` 均对 400 有明确断言，全改 200 会造成大批量回归。裁决：
- `upstream_error`（上游 4xx/5xx、超时、网络异常）→ HTTP 200 + 保留上次成功 payload + `_envelope.state="stale"` / `"error"`，这是 S5 的核心收益。
- `config_missing` / `invalid_params`（缺 watchlist / URL / bvid 等）→ **保持原有 4xx 状态码与响应体**，仅追加 `_envelope` 便于机读，不改现有断言。
- 后端必须先跑现有 widget 测试建立基线，再逐一核对改动后的断言，禁止批量替换。
- AC-06 中的「数据源失败」按本裁决解释为「上游失败」，不含参数校验错误。

**D3 — S2 前提修正。** 核查 `src/pages/index.jsx:45` 的 `rightAlignedWidgets` 不含 `bilibili_music`，且 `custom.css` 把新增部件绝对定位到左上角；这才是错位根因，`custom.js` 手写 DOM 不是。故 S2 只做无损 CSS 渐进增强，不改 `custom.js`。

**D4 — S1 是协议形态变更，不是「加几个字段」。** 2026-07-28 移除 `initialize` 握手与 `Mcp-Session-Id`，版本/能力改为每请求 `_meta` 携带。本 fork `/api/mcp` 本已无状态，因此按 dual-era 实现，legacy 路径原封不动。

## 5. S1 契约（锁定）

**分流（per-request，不是 server-wide）**：请求满足任一即 modern —— `params._meta["io.modelcontextprotocol/protocolVersion"]` 存在，或 `MCP-Protocol-Version` 头存在；否则 legacy。

| 项 | modern (2026-07-28) | legacy (2025-11-25) |
|---|---|---|
| 入口 | 任意 RPC 直接调用，无握手 | `initialize` 返回 `protocolVersion: "2025-11-25"` |
| 必填 | 每个非 discover 请求 `params._meta` 必带 `io.modelcontextprotocol/protocolVersion` + `io.modelcontextprotocol/clientCapabilities` | 无 |
| `server/discover` | MUST 实现，允许不带 `_meta`（供探测） | 不要求 |
| HTTP 头 | `MCP-Protocol-Version`、`Mcp-Method` 必带；命名操作加 `Mcp-Name`；头与 body 不一致报错 | 不要求 |
| 结果 | 加 `resultType: "complete"`；`tools/list`/`resources/*` 加 `ttlMs` + `cacheScope`；`_meta` 加 `io.modelcontextprotocol/serverInfo` | 原样 |
| 版本不支持 | `-32022 UnsupportedProtocolVersion`，`data: { supported, requested }` | 不适用 |
| 缺 `_meta` 必填 | `-32602` + HTTP 400 | 不适用 |
| 缺客户端能力 | `-32021` + `data.requiredCapabilities` + HTTP 400 | 不适用 |
| 头体不一致 | `-32020 HeaderMismatch` + HTTP 400 | 不适用 |

`server/discover` 结果：`{ resultType: "complete", supportedVersions: ["2026-07-28","2025-11-25"], capabilities, instructions, ttlMs, cacheScope, _meta: { "io.modelcontextprotocol/serverInfo": ... } }`。
`supportedVersions` 必须同时含两个版本（dual-era 声明），否则 legacy 客户端无法识别。
`capabilities.tools` / `resources` 保持现有结构；不实现 prompts / extensions。

改动文件：`src/utils/mcp/homepage-mcp.js`、`src/pages/api/mcp/index.js`（后者需把 `req.headers` 传入 handler 以做头部校验与状态码映射）。**鉴权链路 `mcpTokenAuthorized` / session 保持不动。**

## 6. S5 契约（锁定）

- 新增 `src/utils/widget/envelope.js`：`withWidgetEnvelope(handler, { source, ttlMs, classify })` 包装器。
  - 成功：缓存 payload 快照，返回顶层展平 + `_envelope.state="fresh"`。
  - 失败：取该源上次成功快照，返回其字段 + `_envelope.state="stale"` / 无快照时 `"error"`，附 `error.kind` / `message`。
  - 缓存为进程内 `Map`，**不引入后台任务、不引入新依赖、不落盘**。
- 接入端点（易失败且高频）：`news.js`、`openmeteo.js`、`stocks.js`、`glances.js`、`bilibili_pages.js`、`resources.js`。其余保持原样，不追求数量。
- `news.js` 现有 try/catch 已能降级，改为走包装器并**保留上次成功 `items`**，不再返回 `items: []`。
- 新增 `GET /api/health/sources`：返回 `{ sources: [ { source, state, fetchedAt, ageMs, error } ], degraded, healthy }`，只读、不触发外部请求。
- 前端：`widget/error.jsx` 增加可选 `envelope` 入参，展示 `kind` 对应中文原因与「数据截至 X 分钟前」；`news.jsx` 读取 `_envelope` 在陈旧态显示角标。不新增常驻大面板（避免堆叠），健康信息并入现有 footer 的可展开区。

## 7. S3 契约（锁定）

- `src/components/commandpalette/commandpalette.jsx`（单文件，≤300 行），`src/pages/index.jsx` 挂载。
- 快捷键 `Ctrl/Cmd+K` 打开，`Esc` 关闭，`↑/↓` 选择，`Enter` 打开链接；`/` 在 QuickLaunch 未聚焦时也可打开。
- 数据源复用现有 `useSWR("/api/bookmarks")` 与 `useSWR("/api/services")`，**不新增 API**。
- 匹配：本地加权（名称前缀 > 名称包含 > 缩写 > 分组名 > URL），不引第三方库；最近使用频次存 `localStorage` 参与排序。
- 无匹配时显示明确空态，不使用占位假数据。
- 样式全部走现有 Tailwind 主题类或设计 Token，**不写硬编码色值**。

## 8. S4 契约（锁定）

- 新增 `src/utils/profiles/resolve.js` + `GET /api/profiles`。
- `settings.yaml` 可选 `profiles` 键；**缺省 / 解析失败 → 返回 `{ active: null, profiles: [] }`，首页行为与现在逐字节一致**。
- 规则维度：`time`（必须显式 `timezone`，容器默认 UTC 会让「今天」在傍晚错位）、`network`（内外网来源，基于请求 host，不解析真实内网地址）、`device`（UA 粗分类）。
- 前端只消费 `active`，写 `data-profile` 到根容器，由 CSS 决定是否隐藏分组；不新增后台进程。
- 配置示例一律用 `CHANGE_ME_*` 占位，禁止真实地址。

## 9. S2 契约（锁定）

- 仅改 `src/skeleton/custom.css` 与 `deploy/config-template/custom.css`、`src/skeleton` 三副本中的 CSS（如存在），追加渐进增强块：
  `color-scheme`、`prefers-reduced-motion`、`@supports` 包裹的 `:has()` 与 `@container` 规则。
- 不删除、不重排任何现有规则；不引入新色值；不动 `custom.js`。
- 不改 `rightAlignedWidgets`（避免改变现有布局顺序），仅修新增部件被绝对定位的兜底：`@supports selector(:has(*))` 下给未登记部件一个安全的静态定位。

## 10. 文件分区（并发写安全，严格遵守）

| 角色 | 允许写入 | 禁止写入 |
|---|---|---|
| 后端 | `src/utils/mcp/**`、`src/pages/api/mcp/**`、`src/utils/widget/**`、`src/pages/api/widgets/**`、`src/pages/api/health/**`、`src/utils/profiles/**`、`src/pages/api/profiles.js` | `src/components/**`、`src/pages/index.jsx`、`src/skeleton/**` |
| 前端 | `src/components/**`、`src/pages/index.jsx`、`src/skeleton/custom.css`、`deploy/config-template/custom.css` | `src/pages/api/**`、`src/utils/**` |
| QA | `src/__tests__/**` | 其余全部 |
| 项目总监 | `docs/frontier/**`、升级说明、集成修复 | 不代写成员产物 |

## 11. 验收标准（EARS）

| 编号 | 验收标准 | 优先级 |
|---|---|---|
| AC-01 | If 请求为 legacy `initialize`，系统必须返回与 v1.2.0 逐字节一致的 `protocolVersion` / `capabilities` / `serverInfo` | P0 |
| AC-02 | While 请求为 modern，若缺 `io.modelcontextprotocol/clientCapabilities`，系统必须返回 `-32602` + HTTP 400 | P0 |
| AC-03 | When `server/discover` 被调用，结果必须含两个 supportedVersions、`resultType`、`ttlMs`、`cacheScope` | P0 |
| AC-04 | If `Mcp-Method` 头与 body `method` 不一致，系统必须返回 `-32020` + HTTP 400 | P0 |
| AC-05 | If 数据源失败且有上次成功快照，响应必须保留原 payload 字段并置 `_envelope.stale=true` | P0 |
| AC-06 | If 数据源失败且无快照，响应必须为 HTTP 200 + `_envelope.state="error"` + 明确 `error.kind` | P0 |
| AC-07 | While `settings.yaml` 无 `profiles` 键，`/api/profiles` 必须返回 `{active:null,profiles:[]}` 且首页渲染不变 | P0 |
| AC-08 | When 用户按 Ctrl/Cmd+K，命令面板必须出现且能对书签做本地加权匹配 | P0 |
| AC-09 | 所有产出必须零 emoji 功能图标、零紫粉渐变、零硬编码色值、零真实内网地址 | P0 |
| AC-10 | 定向 Vitest 全绿；全量 Vitest 无回归；ESLint 0 error | P0 |

## 12. 工程规范（必须遵守）

1. 测试放 `src/__tests__/pages/api/...`，用 `pages/...` 别名导入；**`src/pages` 下禁放测试**。
2. 本机 Git Bash 跑 `pnpm build` / `eslint .` 会被 SIGTERM 拦，改用 PowerShell 执行 `node node_modules/eslint/bin/eslint.js .`；Vitest 可用 Bash。
3. 所有新文件 LF；`docker-entrypoint.sh` 不得改成 CRLF。
4. 脱敏：地址/密钥只允许 `CHANGE_ME_*` 占位，禁止真实内网地址、口令、token。
5. 不推远端、不构建镜像、不改线上 9 个配置文件、`dev` 保持干净。
6. 提交信息用中文，格式 `feat: ...`。

## 13. 端到端验证步骤

```bash
# 1. 定向测试
node node_modules/vitest/vitest.mjs run src/__tests__/pages/api/mcp/index.test.js src/__tests__/pages/api/widgets/

# 2. 全量回归
node node_modules/vitest/vitest.mjs run

# 3. ESLint（PowerShell）
node node_modules/eslint/bin/eslint.js .

# 4. 脱敏与 P0 扫描
grep -rEn "192\.168\.|10\.[0-9]+\.[0-9]+|172\.(1[6-9]|2[0-9]|3[01])\." src docs/frontier || true

# 5. MCP 双时代手工断言（Node 直调，无需起容器）
node -e "import('./src/utils/mcp/homepage-mcp.js').then(m => { console.log(JSON.stringify(m.handleMcpRequest({jsonrpc:'2.0',id:1,method:'server/discover'}))); })"
```

## 13.5 实现偏差登记与裁决（2026-11-12，项目总监）

> 本节为 Phase 3 集成期裁决，**优先级高于前文表格**。原则：零回归 > 契约完美度；规范正确性 > Spec 初稿措辞。

| 编号 | 偏差 | 裁决 | 依据 / 后续 |
|---|---|---|---|
| B1 | `_envelope` 只在降级 200 响应中出现；成功体与参数校验 4xx 逐字节保持原样 | **接受** | 现有 `openmeteo` / `glances` / `bilibili_pages` / `stocks` 测试对成功体与 4xx 使用精确 `toEqual`，注入字段即批量回归。AC-05 / AC-06 只约束失败态；全局新鲜度由 `/api/health/sources` 提供，链路未断。 |
| B2 | `glances` 上游 401 / 500 保持原 400，不走降级 | **接受（部分覆盖）** | 已接入包装器并缓存快照供健康端点使用，但上游错误态仍走通用错误卡。S5 实际完整降级覆盖 news / openmeteo / stocks / bilibili_pages / resources 五源。 |
| B3 | 缺 `io.modelcontextprotocol/clientCapabilities` 回 `-32602`，而非 §5 表格写的 `-32021 + data.requiredCapabilities` | **后端正确，本 Spec 表格口径更正** | 2026-07-28 规范原文：请求缺任何必填 `_meta` 字段属 malformed，MUST 回 `-32602` + HTTP 400；`-32021 MissingRequiredClientCapability` 仅用于「处理某请求需要某具体能力、而客户端未在 `clientCapabilities` 中声明」的场景，须带 `data.requiredCapabilities`。两者不是同一条件，后端实现无误。 |
| B4 | `Mcp-Method` 头只校验「与 body 不一致」，未强制「必须存在」 | **判为合规缺口，已下发补正** | 规范 SEP-2243 要求 Streamable HTTP 的 modern 请求必须带 `Mcp-Method`，命名操作另带 `Mcp-Name`。`server/discover` 裸探测与 legacy 路径豁免。 |
| B5 | §13 的 `node -e` 端到端命令在纯 Node 下无法解析 `utils/*` 别名 | **更正验证命令** | 改为 `pnpm exec vitest run src/__tests__/pages/api/mcp/dual-era.test.js`；MCP 双时代断言以该测试文件为准。 |

**OPEN（不阻塞本版，列入 v1.4 观察）**
1. 成功态是否注入 `state:"fresh"` 信封 —— 需同步更新现有精确断言测试后才有条件做。
2. `glances` 上游错误态完整降级 —— 同上。
3. `/api/health/sources` 的前端健康面板 —— 本轮明确不做 UI，避免粗暴堆叠。

## 14. 变更记录

| 日期 | 变更 | 原因 | 影响 |
|---|---|---|---|
| 2026-11-12 | 初版 | 规范实测 + 代码核查后锁定 | 全员 |
