import { withAuth } from "utils/auth";
import { BVID_PATTERN, loadView, pageLink } from "utils/bilibili-view";
import { getPrivateWidgetOptions } from "utils/config/widget-helpers";
import createLogger from "utils/logger";

const logger = createLogger("bilibili_pages");

// B站「视频选集」：一个视频（例如 120 首纯音乐合集）里往往有几十到上百个分P，
// 每个分P有自己的 cid 与标题。搜索结果只是「视频」，歌单必须是这个视频的分P列表。
//
// 上游地址写死、只接受合法 bvid，链接按白名单格式拼接，避免 SSRF。
// 沿用 bilibili_music 的 widget key 读取配置，已有部署无需改 widgets.yaml。
const WIDGET_TYPE = "bilibili_music";

async function handler(req, res) {
  const { index, bvid: rawBvid, force } = req.query;
  await getPrivateWidgetOptions(WIDGET_TYPE, index);

  const bvid = typeof rawBvid === "string" ? rawBvid.trim() : "";
  if (!BVID_PATTERN.test(bvid)) {
    return res.status(400).json({ error: "invalid bvid", items: [] });
  }

  let view;
  try {
    view = await loadView(bvid, { force: force === "1" });
  } catch (error) {
    logger.error("B站选集读取失败 (%s): %s", bvid, error?.message ?? String(error));
    view = null;
  }

  res.setHeader("Cache-Control", "private, no-store");
  if (!view) {
    return res.status(200).json({
      bvid,
      title: "",
      author: "",
      total: 0,
      items: [],
      updatedAt: null,
      error: "选集暂不可用",
    });
  }

  return res.status(200).json({
    bvid,
    title: view.title,
    author: view.author,
    link: `https://www.bilibili.com/video/${bvid}`,
    total: view.pages.length,
    items: view.pages.map((entry) => ({ ...entry, link: pageLink(bvid, entry.page) })),
    updatedAt: new Date().toISOString(),
  });
}

export default withAuth(handler);
