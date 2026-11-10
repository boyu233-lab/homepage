import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BACKUP_KEEP,
  CONFIG_FILES,
  applyContent,
  fileStats,
  isBackupName,
  isKnownFile,
  listBackups,
  maxUploadBytes,
  readConfigFile,
  restoreBackup,
  sha256,
  validateContent,
  writeAtomic,
} from "utils/config/upload";

const DIR = path.join(os.tmpdir(), `homepage-config-upload-${process.pid}`);

function clearDir() {
  if (!fs.existsSync(DIR)) return;
  for (const name of fs.readdirSync(DIR)) {
    fs.unlinkSync(path.join(DIR, name));
  }
}

function raw(name) {
  return fs.readFileSync(path.join(DIR, name), "utf8");
}

describe("utils/config/upload", () => {
  beforeEach(() => {
    fs.mkdirSync(DIR, { recursive: true });
    clearDir();
    vi.unstubAllEnvs();
  });

  afterAll(() => {
    clearDir();
    try {
      fs.rmdirSync(DIR);
    } catch {
      // 目录可能已被其它测试清理
    }
  });

  it("只接受固定表内的文件名，拒绝路径穿越", () => {
    expect(CONFIG_FILES).toHaveLength(9);
    expect(isKnownFile("custom.css")).toBe(true);
    expect(isKnownFile("../docker-entrypoint.sh")).toBe(false);
    expect(isKnownFile("settings.yaml/../../etc/passwd")).toBe(false);
    expect(() => readConfigFile(DIR, "../package.json")).toThrow(/不支持的文件/);
    expect(() => applyContent(DIR, "../evil", "x")).toThrow(/不支持的文件/);
  });

  it("校验 YAML 语法与顶层结构，拦截传错文件", () => {
    expect(validateContent("widgets.yaml", "- search:\n    provider: google\n").valid).toBe(true);
    expect(validateContent("settings.yaml", "title: Hi\n").valid).toBe(true);
    expect(validateContent("settings.yaml", "- a\n- b\n").error).toMatch(/顶层/);
    expect(validateContent("widgets.yaml", "title: 传错文件\n").error).toMatch(/顶层/);
    expect(validateContent("widgets.yaml", "- a: [\n").error).toMatch(/YAML 解析失败/);
    expect(validateContent("widgets.yaml", "# 仅注释\n").valid).toBe(true);
    expect(validateContent("custom.css", "body { color: red }\n").valid).toBe(true);
    expect(validateContent("custom.css", "a\u0000b").error).toMatch(/NUL/);
    expect(validateContent("custom.css", 123).valid).toBe(false);
  });

  it("体积上限可配置且受硬上限约束", () => {
    vi.stubEnv("HOMEPAGE_CONFIG_UPLOAD_MAX_BYTES", "2048");
    expect(maxUploadBytes()).toBe(2048);
    expect(validateContent("custom.css", "x".repeat(3000)).error).toMatch(/上限/);
    vi.stubEnv("HOMEPAGE_CONFIG_UPLOAD_MAX_BYTES", "99999999");
    expect(maxUploadBytes()).toBe(2 * 1024 * 1024);
  });

  it("上传写入、生成备份、原子替换且不残留临时文件", () => {
    fs.writeFileSync(path.join(DIR, "custom.css"), "body{color:blue}\n");
    const result = applyContent(DIR, "custom.css", "body{color:red}\n");

    expect(result.ok).toBe(true);
    expect(result.backup).toMatch(/^custom\.css\.\d{8}-\d{6}(?:-\d+)?\.bak$/);
    expect(readConfigFile(DIR, "custom.css")).toBe("body{color:red}\n");
    expect(raw(result.backup)).toBe("body{color:blue}\n");
    expect(result.sha256).toBe(sha256("body{color:red}\n"));
    expect(fs.readdirSync(DIR).some((name) => name.includes(".tmp-"))).toBe(false);
  });

  it("写盘前拒绝非法内容，不改动现有文件", () => {
    fs.writeFileSync(path.join(DIR, "widgets.yaml"), "- original: yes\n");
    const result = applyContent(DIR, "widgets.yaml", "title: 结构不对\n");
    expect(result.ok).toBe(false);
    expect(readConfigFile(DIR, "widgets.yaml")).toBe("- original: yes\n");
  });

  it("每个文件独立保留最近若干份备份", () => {
    fs.writeFileSync(path.join(DIR, "widgets.yaml"), "- v0\n");
    for (let i = 1; i <= 12; i += 1) {
      applyContent(DIR, "widgets.yaml", `- v${i}\n`);
    }
    const backups = listBackups(DIR, "widgets.yaml");
    expect(backups).toHaveLength(BACKUP_KEEP);
    expect(readConfigFile(DIR, "widgets.yaml")).toBe("- v12\n");
    expect(listBackups(DIR, "custom.css")).toHaveLength(0);
    expect(backups[0].modified).toBeTruthy();
  });

  it("按备份名回滚，回滚前再备份当前内容", () => {
    fs.writeFileSync(path.join(DIR, "bookmarks.yaml"), "- 原始:\n    - 百度: [{ href: 'https://www.baidu.com' }]\n");
    const applied = applyContent(
      DIR,
      "bookmarks.yaml",
      "- 新:\n    - Google: [{ href: 'https://www.google.com' }]\n",
    );
    const restored = restoreBackup(DIR, "bookmarks.yaml", applied.backup);

    expect(restored.ok).toBe(true);
    expect(restored.restoredFrom).toBe(applied.backup);
    expect(restored.backup).toBeTruthy();
    expect(readConfigFile(DIR, "bookmarks.yaml")).toContain("原始");
    expect(() => restoreBackup(DIR, "bookmarks.yaml", "../../package.json")).toThrow(/不合法/);
    expect(() => restoreBackup(DIR, "bookmarks.yaml", "bookmarks.yaml.20200101-000000.bak")).toThrow(
      /不存在/,
    );
  });

  it("备份名白名单只认本文件的合法格式", () => {
    expect(isBackupName("custom.js", "custom.js.20261110-215530.bak")).toBe(true);
    expect(isBackupName("custom.js", "custom.js.20261110-215530-01.bak")).toBe(true);
    expect(isBackupName("custom.js", "custom.css.20261110-215530.bak")).toBe(false);
    expect(isBackupName("custom.js", "../custom.js.20261110-215530.bak")).toBe(false);
  });

  it("列出 9 个文件的状态与 sha256", () => {
    fs.writeFileSync(path.join(DIR, "custom.css"), "a{}");
    const stats = fileStats(DIR);
    expect(stats).toHaveLength(9);
    const css = stats.find((entry) => entry.name === "custom.css");
    expect(css.exists).toBe(true);
    expect(css.sha256).toBe(sha256("a{}"));
    expect(css.label).toBeTruthy();
    expect(stats.find((entry) => entry.name === "settings.yaml").exists).toBe(false);
  });

  it("原子写不残留临时文件", () => {
    writeAtomic(path.join(DIR, "custom.js"), "console.log(1)");
    expect(readConfigFile(DIR, "custom.js")).toBe("console.log(1)");
    expect(fs.readdirSync(DIR).some((name) => name.includes(".tmp-"))).toBe(false);
  });
});
