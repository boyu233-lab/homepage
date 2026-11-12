import { beforeEach, describe, expect, it, vi } from "vitest";

import createMockRes from "test-utils/create-mock-res";

const { getSettings } = vi.hoisted(() => ({ getSettings: vi.fn() }));

vi.mock("utils/auth", () => ({ withAuth: (handler) => handler }));
vi.mock("utils/config/config", () => ({ getSettings }));

import handler from "pages/api/profiles";
import { resolveProfiles } from "utils/profiles/resolve";

const NOW = new Date("2026-11-12T12:00:00Z");

describe("resolveProfiles", () => {
  it("returns the neutral result when settings has no profiles key (AC-07)", () => {
    expect(resolveProfiles({ headers: {} }, { title: "Home" })).toEqual({ active: null, profiles: [] });
  });

  it("returns the neutral result on a settings parse failure", () => {
    expect(resolveProfiles({ headers: {} }, null)).toEqual({ active: null, profiles: [] });
  });

  it("returns the neutral result when profiles is malformed", () => {
    expect(resolveProfiles({ headers: {} }, { profiles: "not-an-array" })).toEqual({ active: null, profiles: [] });
  });

  it("requires an explicit timezone for a time rule (no silent UTC fallback)", () => {
    const profiles = [{ name: "evening", when: { time: { after: "18:00", before: "23:59" } } }];
    const result = resolveProfiles({ headers: {} }, { profiles }, NOW);
    expect(result.active).toBe(null);
    expect(result.profiles).toEqual([expect.objectContaining({ name: "evening" })]);
  });

  it("activates a time profile only inside its explicit-timezone window", () => {
    const profiles = [
      { name: "evening", when: { time: { timezone: "Asia/Shanghai", after: "18:00", before: "23:59" } } },
    ];
    expect(resolveProfiles({ headers: {} }, { profiles }, NOW).active).toBe("evening");

    const morning = new Date("2026-11-12T01:00:00Z"); // 09:00 in Shanghai
    expect(resolveProfiles({ headers: {} }, { profiles }, morning).active).toBe(null);
  });

  it("classifies network from host and device from User-Agent", () => {
    const profiles = [{ name: "mobile-internal", when: { device: "mobile", network: "internal" } }];
    const req = {
      headers: {
        host: "localhost:3000",
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148",
      },
    };
    expect(resolveProfiles(req, { profiles }).active).toBe("mobile-internal");
  });

  it("keeps active null when no profile matches", () => {
    const profiles = [{ name: "desktop-only", when: { device: "desktop" } }];
    const req = { headers: { "user-agent": "iPhone Mobile Safari" } };
    expect(resolveProfiles(req, { profiles }).active).toBe(null);
  });
});

describe("pages/api/profiles", () => {
  beforeEach(() => {
    getSettings.mockReset();
    getSettings.mockReturnValue({});
  });

  it("returns {active:null,profiles:[]} when profiles are configured off", async () => {
    const res = createMockRes();
    await handler({ method: "GET", headers: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ active: null, profiles: [] });
  });

  it("stays neutral when getSettings throws (parse failure)", async () => {
    getSettings.mockImplementationOnce(() => {
      throw new Error("bad yaml");
    });
    const res = createMockRes();
    await handler({ method: "GET", headers: {} }, res);
    expect(res.body).toEqual({ active: null, profiles: [] });
  });

  it("exposes a resolved active profile when configured", async () => {
    getSettings.mockReturnValueOnce({ profiles: [{ name: "always", when: {} }] });
    const res = createMockRes();
    await handler({ method: "GET", headers: {} }, res);
    expect(res.body.profiles).toHaveLength(1);
    expect(res.body.active).toBe("always");
  });

  it("rejects non-GET requests", async () => {
    const res = createMockRes();
    await handler({ method: "POST", headers: {} }, res);
    expect(res.statusCode).toBe(405);
  });
});
