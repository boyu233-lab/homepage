import fs from "fs";
import path from "path";
import * as yaml from "js-yaml";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import createMockRes from "test-utils/create-mock-res";

// 临时目录放在系统临时区，避免 eslint 全仓扫描时与测试的建/删目录产生竞态
const { CONF_DIR } = vi.hoisted(() => ({
  CONF_DIR: `${process.env.TEMP || process.env.TMP || "/tmp"}`.replace(/\\/g, "/") +
    `/homepage-bookmarks-test-${process.pid}`,
}));

vi.mock("utils/config/config", () => ({ CONF_DIR }));

import handler, {
  backupCurrent,
  buildYaml,
  extractHeader,
  flatten,
  toYamlString,
  validateGroups,
  validateRaw,
} from "pages/api/config/bookmarks";

const FILE = path.join(CONF_DIR, "bookmarks.yaml");

const SAMPLE_GROUPS = [
  {
    name: "搜索引擎",
    bookmarks: [
      { name: "百度", href: "https://www.baidu.com", icon: "mdi-magnify", description: "中文搜索" },
      { name: "Google", href: "https://www.google.com", target: "_blank" },
    ],
  },
  { name: "社区与开发", bookmarks: [{ name: "GitHub", href: "https://github.com" }] },
];

function req(method, body) {
  return {
    method,
    url: "/api/config/bookmarks",
    headers: { host: "localhost:3000" },
    cookies: {},
    ...(body === undefined ? {} : { body }),
  };
}

function clearDir() {
  if (!fs.existsSync(CONF_DIR)) return;
  for (const entry of fs.readdirSync(CONF_DIR)) {
    fs.unlinkSync(path.join(CONF_DIR, entry));
  }
}

describe("pages/api/config/bookmarks", () => {
  beforeEach(() => {
    fs.mkdirSync(CONF_DIR, { recursive: true });
    clearDir();
    vi.restoreAllMocks();
  });

  afterAll(() => {
    clearDir();
    try {
      fs.rmdirSync(CONF_DIR);
    } catch {
      // 目录可能已被其它测试文件清理
    }
  });

  describe("structure helpers", () => {
    it("merges every field map of a bookmark instead of dropping all but the first", () => {
      const data = [
        { G: [{ B: [{ href: "https://example.com", icon: "mdi-web" }, { description: "备注", ping: "/ping" }] }] },
      ];
      expect(flatten(data)).toEqual([
        {
          name: "G",
          bookmarks: [
            { name: "B", href: "https://example.com", icon: "mdi-web", description: "备注", ping: "/ping" },
          ],
        },
      ]);
    });

    it("keeps unknown fields when serialising back to YAML", () => {
      const text = toYamlString([
        { name: "G", bookmarks: [{ name: "B", href: "https://example.com", siteMonitor: "x", id: "#tile-blue" }] },
      ]);
      expect(flatten(yaml.load(text))[0].bookmarks[0]).toMatchObject({
        siteMonitor: "x",
        id: "#tile-blue",
      });
    });

    it("extracts the leading comment block and document marker", () => {
      const raw = "# 我的书签\n# 第二行注释\n---\n- 分组:\n    - B:\n        - href: https://example.com\n";
      expect(extractHeader(raw)).toBe("# 我的书签\n# 第二行注释\n---\n");
      expect(buildYaml(SAMPLE_GROUPS, raw).startsWith("# 我的书签\n# 第二行注释\n---\n")).toBe(true);
    });
  });

  describe("validation", () => {
    it("accepts a well formed group set", () => {
      expect(validateGroups(SAMPLE_GROUPS)).toBeNull();
    });

    it.each([
      ["非数组", { groups: {} }],
      ["空分组名", [{ name: "  ", bookmarks: [] }]],
      ["重复分组名", [{ name: "G", bookmarks: [] }, { name: "G", bookmarks: [] }]],
      ["空标签名", [{ name: "G", bookmarks: [{ name: "", href: "https://example.com" }] }]],
      [
        "重复标签名",
        [
          {
            name: "G",
            bookmarks: [
              { name: "B", href: "https://example.com" },
              { name: "B", href: "https://example.org" },
            ],
          },
        ],
      ],
      ["非法链接", [{ name: "G", bookmarks: [{ name: "B", href: "javascript:alert(1)" }] }]],
      ["协议相对链接", [{ name: "G", bookmarks: [{ name: "B", href: "//evil.example" }] }]],
      ["保留键", [{ name: "__proto__", bookmarks: [] }]],
    ])("rejects %s", (_label, groups) => {
      expect(validateGroups(groups)).toBeTruthy();
    });

    it("rejects malformed or non-bookmark raw YAML", () => {
      expect(validateRaw("- [unclosed")).toContain("YAML 解析失败");
      expect(validateRaw("just a string")).toContain("不是合法的 bookmarks 分组结构");
      expect(validateRaw("")).toBe("YAML 内容为空");
    });

    it("accepts valid raw YAML", () => {
      expect(validateRaw(toYamlString(SAMPLE_GROUPS))).toBeNull();
    });
  });

  describe("GET / POST", () => {
    it("returns both flattened groups and the raw source", async () => {
      fs.writeFileSync(FILE, "# header\n---\n" + toYamlString(SAMPLE_GROUPS), "utf8");
      const res = createMockRes();
      await handler(req("GET"), res);
      expect(res.statusCode).toBe(200);
      expect(res.body.groups).toHaveLength(2);
      expect(res.body.groups[0].bookmarks[0].name).toBe("百度");
      expect(res.body.raw).toContain("# header");
    });

    it("writes visual edits atomically, keeps the header and creates a timestamped backup", async () => {
      fs.writeFileSync(FILE, "# 保留这段注释\n---\n" + toYamlString(SAMPLE_GROUPS), "utf8");
      const res = createMockRes();
      await handler(req("POST", { groups: SAMPLE_GROUPS }), res);
      expect(res.statusCode).toBe(200);
      expect(res.body.mode).toBe("visual");
      expect(res.body.backup).toMatch(/^bookmarks\.yaml\.\d{8}-\d{6}(?:-\d+)?\.bak$/);

      const written = fs.readFileSync(FILE, "utf8");
      expect(written.startsWith("# 保留这段注释\n---\n")).toBe(true);
      expect(flatten(yaml.load(written))).toEqual(SAMPLE_GROUPS);
      expect(fs.existsSync(path.join(CONF_DIR, res.body.backup))).toBe(true);

      const readBack = createMockRes();
      await handler(req("GET"), readBack);
      expect(readBack.body.groups).toEqual(SAMPLE_GROUPS);
    });

    it("writes raw source verbatim, preserving inline comments", async () => {
      fs.writeFileSync(FILE, toYamlString(SAMPLE_GROUPS), "utf8");
      const raw = "# 源码模式注释\n---\n" + toYamlString(SAMPLE_GROUPS) + "\n# 尾注\n";
      const res = createMockRes();
      await handler(req("POST", { raw }), res);
      expect(res.statusCode).toBe(200);
      expect(res.body.mode).toBe("raw");
      expect(fs.readFileSync(FILE, "utf8")).toBe(raw);
    });

    it("rejects invalid input with 400 without touching the file", async () => {
      const original = toYamlString(SAMPLE_GROUPS);
      fs.writeFileSync(FILE, original, "utf8");
      const res = createMockRes();
      await handler(req("POST", { groups: [{ name: "", bookmarks: [] }] }), res);
      expect(res.statusCode).toBe(400);
      expect(fs.readFileSync(FILE, "utf8")).toBe(original);
    });

    it("rejects unsupported methods", async () => {
      const res = createMockRes();
      await handler(req("DELETE"), res);
      expect(res.statusCode).toBe(405);
    });
  });

  describe("backup rotation", () => {
    it("keeps only the most recent 10 timestamped backups", () => {
      fs.writeFileSync(FILE, toYamlString(SAMPLE_GROUPS), "utf8");
      for (let i = 0; i < 12; i += 1) backupCurrent(CONF_DIR, FILE);
      const backups = fs
        .readdirSync(CONF_DIR)
        .filter((entry) => /^bookmarks\.yaml\.\d{8}-\d{6}(?:-\d+)?\.bak$/.test(entry));
      expect(backups).toHaveLength(10);
    });
  });
});
