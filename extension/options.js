import { DEFAULTS, getConfig, normalizeUrl, openHomepage, setConfig } from "./common.js";

const $ = (id) => document.getElementById(id);

function flash(text, ok = true) {
  const node = $("message");
  node.textContent = text;
  node.dataset.ok = String(ok);
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => {
    node.textContent = "";
  }, 4000);
}

async function load() {
  const cfg = await getConfig();
  $("homepage-url").value = cfg.homepageUrl;
  $("redirect-delay").value = cfg.redirectDelayMs ?? DEFAULTS.redirectDelayMs;
  $("open-on-startup").checked = cfg.openOnStartup;
  $("pause-with-shift").checked = cfg.pauseWithShift;
}

$("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = normalizeUrl($("homepage-url").value);
  if (!url) {
    flash("地址无效：请填写 http(s) 地址，或 域名:端口。", false);
    return;
  }
  const delay = Math.min(3000, Math.max(0, Number($("redirect-delay").value) || 0));
  await setConfig({
    homepageUrl: url,
    redirectDelayMs: delay,
    openOnStartup: $("open-on-startup").checked,
    pauseWithShift: $("pause-with-shift").checked,
  });
  $("homepage-url").value = url;
  $("redirect-delay").value = delay;
  flash(`已保存：${url}`, true);
});

$("test").addEventListener("click", async () => {
  const url = normalizeUrl($("homepage-url").value);
  if (!url) return flash("请先填写有效地址。", false);
  await openHomepage(url);
  flash("已在新标签页打开。", true);
});

$("startup-settings").addEventListener("click", async () => {
  try {
    await chrome.tabs.create({ url: "chrome://settings/onStartup", active: true });
  } catch {
    flash("无法自动打开，请手动访问 chrome://settings/onStartup", false);
  }
});

load().catch((error) => flash(`读取配置失败：${error.message}`, false));
