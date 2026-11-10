import fs from "fs";
import path from "path";

import { withAuth } from "utils/auth";
import { CONF_DIR } from "utils/config/config";
import createLogger from "utils/logger";

const logger = createLogger("configFileService");

/**
 * @param {import("next").NextApiRequest} req
 * @param {import("next").NextApiResponse} res
 */
async function handler(req, res) {
  const { path: relativePath } = req.query;

  // only two supported files, for now
  if (!["custom.css", "custom.js"].includes(relativePath)) {
    return res.status(422).end("Unsupported file");
  }

  const filePath = path.join(CONF_DIR, relativePath);

  try {
    // Read the content of the file or return empty content
    const fileContent = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
    // 配置上传后首页会 location.reload()。no-cache 阻止浏览器启发式缓存旧样式/脚本；
    // Next.js 的 res.send 自带基于内容的 ETag 与 If-None-Match → 304，无需在此重复实现。
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
    // hard-coded since we only support two known files for now
    const mimeType = relativePath === "custom.css" ? "text/css" : "text/javascript";
    res.setHeader("Content-Type", mimeType);
    return res.status(200).send(fileContent);
  } catch (error) {
    if (error) logger.error(error);
    return res.status(500).end("Internal Server Error");
  }
}

export default withAuth(handler, { public: (req) => req.query?.path === "custom.css" });
