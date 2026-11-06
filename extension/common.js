// 所有页面共用的配置读写与 URL 校验。
// 隐私约定：配置只存 chrome.storage.local（本机），绝不使用 storage.sync，
// 避免把自托管域名 / 内网地址同步到 Google 账号或任何云端。

export const DEFAULTS = {
  homepageUrl: "",
  openOnStartup: true,
  redirectDelayMs: 700,
  pauseWithShift: true,
};

export function normalizeUrl(raw) {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(value.includes("://") ? value : `http://${value}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    if (url.username || url.password) return null;
    // 去掉 fragment，避免把锚点当成首页地址的一部分
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export async function getConfig() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  return {
    ...DEFAULTS,
    ...stored,
    homepageUrl: normalizeUrl(stored.homepageUrl) || "",
  };
}

export async function setConfig(patch) {
  await chrome.storage.local.set(patch);
}

export async function openHomepage(url) {
  const target = normalizeUrl(url);
  if (!target) return false;
  // chrome.tabs.create 不需要 "tabs" 权限，因此本扩展只申请 storage。
  await chrome.tabs.create({ url: target, active: true });
  return true;
}

export function openOptions() {
  chrome.runtime.openOptionsPage();
}
