import { DEFAULTS, getConfig, openHomepage, openOptions, setConfig } from "./common.js";

const STARTUP_GRACE_MS = 1500;
const NEW_TAB_MARKER = "lastNewTabRedirectAt";

chrome.runtime.onInstalled.addListener(async (details) => {
  const cfg = await getConfig();
  if (!cfg.homepageUrl) {
    await setConfig({ ...DEFAULTS, homepageUrl: "" });
  }
  if (details.reason === "install" || !cfg.homepageUrl) {
    openOptions();
  }
});

// 浏览器启动时兜底：若本次启动没有经过新标签页（例如"继续上次会话"或"打开特定网页"），
// 就主动打开 Homepage。新标签页接管成功时会写一个会话标记，这里据此避免重复开标签。
chrome.runtime.onStartup.addListener(() => {
  handleStartup().catch((error) => console.warn("[Homepage] startup skipped:", error));
});

async function handleStartup() {
  const cfg = await getConfig();
  if (!cfg.openOnStartup || !cfg.homepageUrl) return;

  await new Promise((resolve) => setTimeout(resolve, STARTUP_GRACE_MS));

  const { [NEW_TAB_MARKER]: marker } = await chrome.storage.session.get(NEW_TAB_MARKER);
  const openedByNewTab = typeof marker === "number" && Date.now() - marker < 10000;
  if (openedByNewTab) return;

  const fresh = await getConfig();
  if (!fresh.openOnStartup || !fresh.homepageUrl) return;
  await openHomepage(fresh.homepageUrl);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "NEW_TAB_REDIRECTED") {
    chrome.storage.session
      .set({ [NEW_TAB_MARKER]: Date.now() })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message?.type === "OPEN_HOMEPAGE") {
    getConfig()
      .then((cfg) => openHomepage(cfg.homepageUrl))
      .then((ok) => sendResponse({ ok }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  return false;
});
