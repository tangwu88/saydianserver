import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QRCode from "qrcode";

vi.mock("qrcode", () => ({
  default: { toCanvas: vi.fn().mockResolvedValue(undefined) },
}));

const legacy = {
  schemaVersion: 1,
  audience: "internal_test",
  publishedAt: "2026-09-07T00:00:00Z",
  releases: [
    {
      platform: "android",
      versionName: "0.1.19",
      buildNumber: 23,
      status: "available",
      destination: {
        kind: "direct",
        url: "/down/files/old.apk",
        fileName: "old.apk",
        sizeBytes: 64_661_988,
        sha256: "a".repeat(64),
      },
    },
    {
      platform: "ios",
      versionName: "0.1.19",
      buildNumber: 23,
      status: "coming_soon",
    },
    {
      platform: "harmonyos",
      versionName: "0.1.4",
      buildNumber: 8,
      status: "available",
      destination: {
        kind: "direct",
        url: "/down/files/old.hap",
        fileName: "old.hap",
        sizeBytes: 9_394_620,
        sha256: "b".repeat(64),
      },
    },
  ],
};
const health = {
  ...legacy,
  realm: "global",
  publishedAt: "2026-10-04T00:00:00Z",
  releases: legacy.releases.map(({ platform }) => ({
    platform,
    packageId:
      platform === "harmonyos"
        ? "cn.saydian.app.global.hm"
        : "cn.saydian.app.global",
    versionName: platform === "ios" ? "1.0.1" : "1.0.0",
    buildNumber: platform === "ios" ? 1013 : 1012,
    status: platform === "android" ? "available" : "coming_soon",
    ...(platform === "ios" ? { pendingReason: "review" } : {}),
    ...(platform === "android"
      ? {
          destination: {
            kind: "direct",
            url: "/global/down/files/health.apk",
            fileName: "health.apk",
            sizeBytes: 68_029_891,
            sha256: "c".repeat(64),
          },
        }
      : {}),
  })),
};

const ring = {
  ...health,
  releases: health.releases.map((release) => ({
    ...release,
    packageId:
      release.platform === "harmonyos"
        ? "cn.saydian.ring.hm"
        : "cn.saydian.ring",
  })),
};

function element() {
  const attributes = new Map<string, string>();
  const classes = new Set<string>();
  return {
    textContent: "",
    innerHTML: "",
    href: "",
    alt: "",
    attributes,
    classList: {
      add: (...names: string[]) => names.forEach((name) => classes.add(name)),
      remove: (...names: string[]) =>
        names.forEach((name) => classes.delete(name)),
    },
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
    addEventListener: vi.fn(),
    closest: () => null,
  };
}

function page(path = "/down") {
  const nodes = new Map<string, ReturnType<typeof element>>();
  for (const id of [
    "manifest-status",
    "device-notice",
    "page-qr",
    "page-title",
    "page-description",
    "page-eyebrow",
    "brand-lockup",
    "canonical-url",
    "product-health",
    "product-legacy",
    "product-ring",
    "health-links",
    "ios-note",
    "health-package-note",
    "health-signature-note",
  ])
    nodes.set(`#${id}`, element());
  const cards = new Map(
    legacy.releases.map(({ platform }) => {
      const fields = new Map(
        ["version", "action", "size", "hash-block", "hash", "copy-hash"].map(
          (field) => [`[data-field="${field}"]`, element()],
        ),
      );
      fields.set(".status-badge", element());
      fields.set("h3", element());
      fields.get("h3")!.textContent = `${platform} 版`;
      fields
        .get('[data-field="action"]')!
        .setAttribute("aria-disabled", "true");
      const card = {
        ...element(),
        querySelector: (selector: string) => fields.get(selector) ?? null,
        fields,
      };
      return [platform, card] as const;
    }),
  );
  vi.stubGlobal("document", {
    title: "",
    querySelector: (selector: string) => {
      const match = selector.match(/^\[data-platform="([^"]+)"\]( h3)?$/);
      if (match)
        return match[2]
          ? cards.get(match[1]!)?.fields.get("h3")
          : cards.get(match[1]!);
      return nodes.get(selector) ?? null;
    },
  });
  vi.stubGlobal("navigator", {
    userAgent: "Desktop",
    platform: "MacIntel",
    maxTouchPoints: 0,
  });
  vi.stubGlobal("window", {
    location: { pathname: path, origin: "https://app.saydian.cn" },
  });
  return { cards, nodes };
}

const response = (data: unknown, ok = true) => ({
  ok,
  json: async () => ({ data }),
});
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe("isolated download pages", () => {
  it.each(["/down", "/down/", "/global/down", "/global/down/"])(
    "loads only Health on %s, never the domestic HAP",
    async (path) => {
      const p = page(path);
      const fetch = vi.fn(async (_url: string) => response(health));
      vi.stubGlobal("fetch", fetch);
      await import("./main");
      await vi.waitFor(() =>
        expect(
          p.cards.get("android")!.fields.get('[data-field="version"]')!
            .textContent,
        ).toBe("1.0.0（1012）"),
      );
      expect(p.nodes.get("#page-title")!.innerHTML).toContain("SAYDIAN Health");
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0]?.[0]).toContain("product=saydian-global");
      expect(p.nodes.get("#canonical-url")!.href).toBe(
        "https://app.saydian.cn/global/down",
      );
      expect(QRCode.toCanvas).toHaveBeenCalledWith(
        p.nodes.get("#page-qr"),
        "https://app.saydian.cn/global/down",
        expect.any(Object),
      );
      expect(
        p.cards.get("android")!.fields.get('[data-field="action"]')!.href,
      ).toBe("/global/down/files/health.apk");
      expect(
        p.cards.get("harmonyos")!.fields.get('[data-field="version"]')!
          .textContent,
      ).toBe("1.0.0（1012）");
      expect(
        p.cards.get("harmonyos")!.fields.get('[data-field="action"]')!.href,
      ).toBe("");
      expect(
        p.cards.get("ios")!.fields.get('[data-field="version"]')!.textContent,
      ).toBe("1.0.1（1013）");
      expect(p.cards.get("ios")!.fields.get(".status-badge")!.textContent).toBe(
        "等待审核",
      );
      expect(
        p.cards.get("ios")!.fields.get('[data-field="action"]')!.href,
      ).toBe("");
      expect(
        p.cards
          .get("ios")!
          .fields.get('[data-field="action"]')!
          .attributes.get("aria-disabled"),
      ).toBe("true");
    },
  );

  it.each(["missing", "wrong-package", "invalid-hash"])(
    "fails closed for %s Health data without a domestic fallback",
    async (failure) => {
      const p = page();
      const invalid = structuredClone(health);
      if (failure === "wrong-package")
        invalid.releases[0]!.packageId = "cc.saidian.app";
      if (failure === "invalid-hash")
        invalid.releases[0]!.destination!.sha256 = "invalid";
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) =>
          url.includes("saydian-global")
            ? response(invalid, failure !== "missing")
            : response(legacy),
        ),
      );
      await import("./main");
      await vi.waitFor(() =>
        expect(
          p.cards.get("android")!.fields.get(".status-badge")!.textContent,
        ).toBe("暂不可用"),
      );
      expect(
        p.cards.get("android")!.fields.get('[data-field="action"]')!.href,
      ).toBe("");
      expect(
        p.cards
          .get("android")!
          .fields.get('[data-field="action"]')!
          .attributes.get("aria-disabled"),
      ).toBe("true");
      expect(
        p.cards.get("harmonyos")!.fields.get('[data-field="action"]')!.href,
      ).toBe("");
    },
  );

  it.each(["/down/legacy", "/down/legacy/"])(
    "preserves all domestic cards and links on %s",
    async (path) => {
      const p = page(path);
      const fetch = vi.fn(async (_url: string) => response(legacy));
      vi.stubGlobal("fetch", fetch);
      await import("./main");
      await vi.waitFor(() =>
        expect(
          p.cards.get("android")!.fields.get('[data-field="action"]')!.href,
        ).toBe("/down/files/old.apk"),
      );
      expect(
        p.cards.get("harmonyos")!.fields.get('[data-field="action"]')!.href,
      ).toBe("/down/files/old.hap");
      expect(p.nodes.get("#page-title")!.innerHTML).toContain("原赛电 App");
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0]?.[0]).toBe(
        "/api/saydian-app/v2/support/app-update",
      );
    },
  );

  it("loads only the independent Say Ring manifest on /say-ring", async () => {
    const p = page("/say-ring");
    const fetch = vi.fn(async (_url: string) => response(ring));
    vi.stubGlobal("fetch", fetch);
    await import("./main");
    await vi.waitFor(() =>
      expect(
        p.cards.get("android")!.fields.get('[data-field="version"]')!
          .textContent,
      ).toBe("1.0.0（1012）"),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "/api/saydian-app/v2/support/app-update?product=say-ring",
    );
    expect(p.nodes.get("#page-title")!.innerHTML).toContain("Say Ring");
  });

  it("does not present Say Ring's Baidu placeholder as an installation link", async () => {
    const p = page("/say-ring");
    const invalid = {
      ...ring,
      releases: ring.releases.map((release) =>
        release.platform === "android"
          ? {
              ...release,
              destination: { kind: "market", url: "https://www.baidu.com/" },
            }
          : release,
      ),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(invalid)),
    );
    await import("./main");
    await vi.waitFor(() =>
      expect(
        p.cards.get("android")!.fields.get(".status-badge")!.textContent,
      ).toBe("安装地址待确认"),
    );
    expect(
      p.cards.get("android")!.fields.get('[data-field="action"]')!.href,
    ).toBe("");
    expect(
      p.cards
        .get("android")!
        .fields.get('[data-field="action"]')!
        .attributes.get("aria-disabled"),
    ).toBe("true");
  });

  it("enables only an explicitly available official TestFlight release", async () => {
    const p = page();
    const approved = {
      ...health,
      releases: health.releases.map((release) =>
        release.platform === "ios"
          ? {
              ...release,
              pendingReason: undefined,
              status: "available",
              destination: {
                kind: "testflight",
                url: "https://testflight.apple.com/join/fixture",
              },
            }
          : release,
      ),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(approved)),
    );
    await import("./main");
    await vi.waitFor(() =>
      expect(
        p.cards.get("ios")!.fields.get('[data-field="action"]')!.href,
      ).toBe("https://testflight.apple.com/join/fixture"),
    );
    expect(p.cards.get("ios")!.fields.get(".status-badge")!.textContent).toBe(
      "可下载",
    );
    expect(p.nodes.get("#ios-note")!.textContent).toBe(
      "通过 TestFlight 安装。",
    );
  });

  it.each([undefined, "review"])(
    "uses editable pendingReason %s instead of guessing from the build number",
    async (pendingReason) => {
      const p = page();
      const manifest = {
        ...health,
        releases: health.releases.map((release) =>
          release.platform === "ios" ? { ...release, pendingReason } : release,
        ),
      };
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => response(manifest)),
      );
      await import("./main");
      await vi.waitFor(() =>
        expect(
          p.cards.get("ios")!.fields.get(".status-badge")!.textContent,
        ).toBe(pendingReason === "review" ? "等待审核" : "待开放"),
      );
      expect(
        p.cards.get("ios")!.fields.get('[data-field="action"]')!.href,
      ).toBe("");
    },
  );
});
