import { Writable } from "node:stream";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { loggerMock } = vi.hoisted(() => ({ loggerMock: { error: vi.fn() } }));

vi.mock("utils/auth", () => ({ withAuth: (handler) => handler }));
vi.mock("utils/logger", () => ({ default: () => loggerMock }));

const BVID = "BV1BZbSzZEGT";
const VIEW_OK = { code: 0, data: { cid: 31268997329 } };
const PLAY_OK = {
  code: 0,
  data: {
    dash: {
      audio: [
        { id: 30216, bandwidth: 65698, baseUrl: "https://a.mcdn.bilivideo.cn:8082/low.m4s?e=x", backupUrl: [] },
        {
          id: 30280,
          bandwidth: 184052,
          baseUrl: "https://b.mcdn.bilivideo.cn:8082/high.m4s?e=x",
          backupUrl: [
            "https://c.bilivideo.com/high.m4s?e=x",
            "https://evil.example.com/steal.m4s",
            "http://d.bilivideo.com/insecure.m4s",
          ],
        },
      ],
    },
  },
};

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body, body: undefined };
}

function streamResponse(ok = true, status = 206) {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3, 4]));
      controller.close();
    },
  });
  return {
    ok,
    status,
    headers: new Headers({
      "content-type": "video/mp4",
      "content-length": "4",
      "content-range": "bytes 0-3/10",
      "accept-ranges": "bytes",
    }),
    body,
  };
}

function makeRes() {
  const chunks = [];
  const res = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk);
      callback();
    },
  });
  res.chunks = chunks;
  res.headers = {};
  res.setHeader = vi.fn((name, value) => {
    res.headers[name.toLowerCase()] = value;
  });
  res.status = vi.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body) => {
    res.payload = body;
    return res;
  });
  return res;
}

async function loadModule() {
  vi.resetModules();
  return import("pages/api/widgets/bilibili_audio");
}

async function call(query = { bvid: BVID }, options = {}) {
  const handler = (await loadModule()).default;
  const res = makeRes();
  await handler({ method: options.method || "GET", query, headers: options.headers || {} }, res);
  return res;
}

describe("pages/api/widgets/bilibili_audio — B站纯音频代理", () => {
  beforeEach(() => {
    loggerMock.error.mockReset();
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(VIEW_OK))
      .mockResolvedValueOnce(jsonResponse(PLAY_OK))
      .mockResolvedValueOnce(streamResponse());
  });

  it("非法 bvid 直接 400，且不请求上游", async () => {
    const res = await call({ bvid: "javascript:alert(1)" });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.payload.error).toBe("invalid bvid");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("取 cid → 取音轨 → 带 Referer/Range 转发，响应头适配 <audio> 且透传 body", async () => {
    const res = await call({ bvid: BVID }, { headers: { range: "bytes=0-1023" } });
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(global.fetch.mock.calls[0][0]).toContain("x/web-interface/wbi/view?bvid=");
    expect(global.fetch.mock.calls[1][0]).toContain("x/player/playurl?");
    expect(global.fetch.mock.calls[2][0]).toContain("c.bilivideo.com"); // 443 备用地址优先
    expect(global.fetch.mock.calls[2][1].headers).toMatchObject({
      Referer: "https://www.bilibili.com/",
      Range: "bytes=0-1023",
    });
    expect(res.statusCode).toBe(206);
    expect(res.headers["content-type"]).toBe("audio/mp4");
    expect(res.headers["content-range"]).toBe("bytes 0-3/10");
    expect(res.headers["accept-ranges"]).toBe("bytes");
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(Buffer.concat(res.chunks)).toHaveLength(4);
  });

  it("HEAD 请求只回响应头，不转发音频数据", async () => {
    const res = await call({ bvid: BVID }, { method: "HEAD" });
    expect(res.headers["content-type"]).toBe("audio/mp4");
    expect(res.chunks).toHaveLength(0);
  });

  it("第一个 CDN 失败时自动回退备用地址", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(VIEW_OK))
      .mockResolvedValueOnce(jsonResponse(PLAY_OK))
      .mockResolvedValueOnce({ ok: false, status: 403, body: { cancel: vi.fn() } })
      .mockResolvedValueOnce(streamResponse());
    const res = await call();
    expect(global.fetch).toHaveBeenCalledTimes(4);
    expect(res.statusCode).toBe(206);
  });

  it("view / playurl 失败或无音轨时返回 502，不抛异常", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(jsonResponse({ code: -404 }, true));
    expect((await call()).status).toHaveBeenCalledWith(502);

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(VIEW_OK))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { dash: { audio: [] } } }));
    expect((await call()).status).toHaveBeenCalledWith(502);
    expect(loggerMock.error).toHaveBeenCalled();
  });

  it("所有 CDN 都不可用时返回 502", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(VIEW_OK))
      .mockResolvedValueOnce(jsonResponse(PLAY_OK))
      .mockResolvedValue({ ok: false, status: 403, body: { cancel: vi.fn() } });
    const res = await call();
    expect(res.status).toHaveBeenCalledWith(502);
  });

  it("safeCdnUrl 只放行 B站自家 CDN 的 HTTPS 地址", async () => {
    const { safeCdnUrl } = await loadModule();
    expect(safeCdnUrl("https://cn-abc.bilivideo.com/x.m4s?e=1")).toContain("bilivideo.com");
    expect(safeCdnUrl("https://xy.mcdn.bilivideo.cn:8082/x.m4s")).toContain("8082");
    expect(safeCdnUrl("http://cn-abc.bilivideo.com/x.m4s")).toBeNull();
    expect(safeCdnUrl("https://evil.example.com/x.m4s")).toBeNull();
    expect(safeCdnUrl("https://bilivideo.com.evil.example/x.m4s")).toBeNull();
    expect(safeCdnUrl("not-a-url")).toBeNull();
  });

  it("pickAudioUrls 选最高码率并过滤不合规备用地址", async () => {
    const { pickAudioUrls } = await loadModule();
    const urls = pickAudioUrls(PLAY_OK.data);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("c.bilivideo.com"); // 标准 443 排前面
    expect(urls[1]).toContain("8082");
    expect(urls.join(" ")).not.toContain("evil.example.com");
    expect(pickAudioUrls({})).toEqual([]);
  });

  it("cid 与音轨地址分别缓存，不重复请求上游", async () => {
    const mod = await loadModule();
    const cid = await mod.resolveCid(BVID);
    const urls = await mod.resolveAudioUrls(BVID, cid);
    expect(cid).toBe(31268997329);
    expect(urls).toHaveLength(2);
    await mod.resolveCid(BVID);
    await mod.resolveAudioUrls(BVID, cid);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
