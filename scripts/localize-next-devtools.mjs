/**
 * 把 Next.js 16 开发工具栏（Dev Tools）的「Preferences」面板汉化。
 *
 * 该面板的文案硬编码在 `next/dist/compiled/next-devtools/index.js` 中，
 * Next.js 既没有 locale 配置，也没有可注入的翻译钩子，因此本脚本在依赖安装
 * 完成后对这份编译产物做一次精确字符串替换（由 package.json 的 postinstall 调用）。
 *
 * 约束：
 * - 只替换带上下文的完整字面量，避免误伤同名变量、枚举键和配置值；
 * - 幂等：已经是中文时直接跳过，不重复写文件；
 * - 容错：Next.js 升级导致文案变化时只提示，绝不阻断安装 / Docker 构建；
 * - 仅影响 `next dev` 下的调试浮层；生产构建（`next start` / Docker）不加载它。
 *
 * 手动执行：node scripts/localize-next-devtools.mjs
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const RELATIVE_TARGET = ["dist", "compiled", "next-devtools", "index.js"];

/** @type {Array<[string, string]>} 每项为 [原始片段, 中文片段] */
const REPLACEMENTS = [
  // 菜单入口与面板标题
  ['label:"Preferences"', 'label:"偏好设置"'],
  ['title:"Preferences"', 'title:"偏好设置"'],

  // 主题
  ['children:"Theme"', 'children:"主题"'],
  ['"Select your theme preference."', '"选择主题偏好。"'],
  ['children:"System"', 'children:"跟随系统"'],
  ['children:"Light"', 'children:"浅色"'],
  ['children:"Dark"', 'children:"深色"'],

  // 位置
  ['children:"Position"', 'children:"位置"'],
  ['"Adjust the placement of your dev tools."', '"调整开发工具在页面上的位置。"'],
  ['children:"Bottom Left"', 'children:"左下"'],
  ['children:"Bottom Right"', 'children:"右下"'],
  ['children:"Top Left"', 'children:"左上"'],
  ['children:"Top Right"', 'children:"右上"'],

  // 大小（下拉项由枚举键渲染，见下方 eR 函数替换）
  ['children:"Size"', 'children:"大小"'],
  ['"Adjust the size of your dev tools."', '"调整开发工具的显示大小。"'],

  // 本次会话隐藏
  ['"Hide Dev Tools for this session"', '"本次会话隐藏开发工具"'],
  ['"Hide Dev Tools until you restart your dev server, or 1 day."', '"隐藏开发工具，直到重启开发服务器或 1 天后才再次显示。"'],
  ['children:"Hide"', 'children:"隐藏"'],

  // 快捷键
  ['"Hide Dev Tools shortcut"', '"隐藏开发工具的快捷键"'],
  ['"Set a custom keyboard shortcut to toggle visibility."', '"设置自定义快捷键来切换显示状态。"'],
  ['"Record Shortcut"', '"录制快捷键"'],
  ['"Clear shortcut"', '"清除快捷键"'],

  // 关闭开发工具（这段是混合 JSX 数组，需整段替换以调整语序）
  [
    'children:["To disable this UI completely, set"," ",N," in your ",(0,z.jsx)("code",{className:"dev-tools-info-code",children:"next.config"})," file."]',
    'children:["要彻底关闭此界面，请在 ",(0,z.jsx)("code",{className:"dev-tools-info-code",children:"next.config"})," 文件中设置 ",N,"。"]',
  ],
  ['"Disable Dev Tools for this project"', '"为本项目关闭开发工具"'],

  // 重启开发服务器 / 重置打包器缓存
  ['"Restart Dev Server"', '"重启开发服务器"'],
  ['"Restarts the development server without needing to leave the browser."', '"无需离开浏览器即可重启开发服务器。"'],
  ['children:"Restart"', 'children:"重启"'],
  ['"Reset Bundler Cache"', '"重置打包器缓存"'],
  [
    '"Clears the bundler cache and restarts the dev server. Helpful if you are seeing stale errors or changes are not appearing."',
    '"清空打包器缓存并重启开发服务器，适用于看到过期报错或改动不生效的情况。"',
  ],
  ['children:"Reset Cache"', 'children:"重置缓存"'],

  // 尺寸下拉项的显示文本来自枚举键，改渲染函数而不是改枚举（枚举值参与布局计算）
  [
    'function eR(e){let[t,r]=e;return(0,z.jsx)("option",{value:r,children:t},t)}',
    'function eR(e){let[t,r]=e,n={Small:"小",Medium:"中",Large:"大"};return(0,z.jsx)("option",{value:r,children:n[t]??t},t)}',
  ],
];

function log(message) {
  process.stdout.write(`[devtools-i18n] ${message}\n`);
}

function findTarget() {
  let dir = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(dir, "node_modules", "next", ...RELATIVE_TARGET);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const target = findTarget();
if (!target) {
  log("未找到 next-devtools 编译产物，跳过（不影响安装）。");
  process.exit(0);
}

let source;
try {
  source = fs.readFileSync(target, "utf8");
} catch (error) {
  log(`读取失败，跳过：${error.message}`);
  process.exit(0);
}

let applied = 0;
let alreadyLocalized = 0;
const missing = [];

for (const [from, to] of REPLACEMENTS) {
  if (source.includes(from)) {
    source = source.split(from).join(to);
    applied += 1;
  } else if (source.includes(to)) {
    alreadyLocalized += 1;
  } else {
    missing.push(from);
  }
}

if (applied === 0) {
  log(alreadyLocalized > 0 ? "已是中文版本，无需改动。" : "没有可替换的文案，未改动文件。");
} else {
  try {
    fs.writeFileSync(target, source);
    log(`已汉化 ${applied} 项文案（${path.relative(process.cwd(), target)}）。`);
  } catch (error) {
    log(`写入失败，跳过：${error.message}`);
  }
}

if (missing.length > 0) {
  log(`提示：${missing.length} 项文案未匹配到，可能是 Next.js 版本变化（不影响构建）：`);
  for (const item of missing.slice(0, 8)) log(`  - ${item.slice(0, 90)}`);
}

process.exit(0);
