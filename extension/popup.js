import { getConfig, hostOf, openHomepage, openOptions, setConfig } from "./common.js";

const $ = (id) => document.getElementById(id);

async function render() {
  const cfg = await getConfig();
  if (cfg.homepageUrl) {
    $("status-dot").classList.add("on");
    $("status-text").textContent = `已指向 ${hostOf(cfg.homepageUrl)}`;
    $("open").disabled = false;
  } else {
    $("status-dot").classList.remove("on");
    $("status-text").textContent = "尚未配置地址，点下方按钮填写";
    $("open").disabled = true;
  }
  $("open-on-startup").checked = cfg.openOnStartup;
}

$("open").addEventListener("click", async () => {
  const cfg = await getConfig();
  if (!cfg.homepageUrl) return openOptions();
  await openHomepage(cfg.homepageUrl);
});

$("open-on-startup").addEventListener("change", async (event) => {
  await setConfig({ openOnStartup: event.target.checked });
});

$("options").addEventListener("click", openOptions);

render().catch((error) => {
  $("status-text").textContent = `读取配置失败：${error.message}`;
});
