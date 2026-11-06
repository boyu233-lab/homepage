import { DEFAULTS, getConfig, hostOf, normalizeUrl, openOptions, setConfig } from "./common.js";

const $ = (id) => document.getElementById(id);
let timer = null;
let target = "";

function showPanel(name) {
  document.querySelectorAll("[data-panel]").forEach((node) => {
    node.hidden = node.dataset.panel !== name;
  });
}

function stopTimer() {
  if (timer) clearTimeout(timer);
  timer = null;
}

// 跳转前给后台一个会话标记：本次浏览器启动已由新标签页承担，
// 后台的启动兜底逻辑就不必再开一个重复标签。
async function go() {
  if (!target) return;
  stopTimer();
  try {
    await chrome.runtime.sendMessage({ type: "NEW_TAB_REDIRECTED" });
  } catch {
    // 后台暂时不可用也不该阻塞跳转
  }
  location.replace(target);
}

function bindCommonHandlers() {
  $("open-now").addEventListener("click", go);
  $("resume").addEventListener("click", go);
  $("stay").addEventListener("click", () => {
    stopTimer();
    showPanel("paused");
  });
  ["settings", "settings-paused", "settings-setup"].forEach((id) =>
    $(id).addEventListener("click", openOptions),
  );

  $("setup-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const url = normalizeUrl($("url-input").value);
    if (!url) {
      $("setup-error").hidden = false;
      return;
    }
    $("setup-error").hidden = true;
    await setConfig({ homepageUrl: url });
    target = url;
    await go();
  });
}

async function init() {
  const cfg = await getConfig();

  if (!cfg.homepageUrl) {
    showPanel("setup");
    setTimeout(() => $("url-input").focus(), 30);
    return;
  }

  target = cfg.homepageUrl;
  $("target-host").textContent = hostOf(target);
  $("shift-hint").hidden = !cfg.pauseWithShift;

  const delay = Math.min(3000, Math.max(0, Number(cfg.redirectDelayMs ?? DEFAULTS.redirectDelayMs) || 0));
  $("progress-bar").style.animationDuration = `${Math.max(delay, 200)}ms`;
  showPanel("redirecting");
  timer = setTimeout(go, delay);
}

document.addEventListener("keydown", async (event) => {
  if (event.key !== "Shift" || !timer) return;
  const cfg = await getConfig();
  if (!cfg.pauseWithShift) return;
  stopTimer();
  showPanel("paused");
});

// 先绑定交互，确保即使读取配置失败，首屏里的地址表单依然可用
bindCommonHandlers();

init().catch((error) => {
  console.error("[Homepage] 初始化失败", error);
  showPanel("setup");
  $("setup-error").hidden = false;
  $("setup-error").textContent = "读取配置失败，可直接在上面重新填写地址，或打开设置页检查。";
});
