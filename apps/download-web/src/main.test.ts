import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    versionName: "1.0.0",
    buildNumber: 1012,
    status: platform === "android" ? "available" : "coming_soon",
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
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("download page platform-specific publication", () => {
  it("replaces only Android with Health, preserving HarmonyOS and iPhone", async () => {
    const p = page();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        response(url.includes("saydian-global") ? health : legacy),
      ),
    );
    await import("./main");
    await vi.waitFor(() =>
      expect(
        p.cards.get("android")!.fields.get('[data-field="version"]')!
          .textContent,
      ).toBe("1.0.0（1012）"),
    );
    expect(p.cards.get("android")!.fields.get("h3")!.textContent).toBe(
      "Saydian Health 安卓版",
    );
    expect(
      p.cards.get("android")!.fields.get('[data-field="action"]')!.href,
    ).toBe("/global/down/files/health.apk");
    expect(
      p.cards.get("harmonyos")!.fields.get('[data-field="version"]')!
        .textContent,
    ).toBe("0.1.4（8）");
    expect(
      p.cards.get("harmonyos")!.fields.get('[data-field="action"]')!.href,
    ).toBe("/down/files/old.hap");
    expect(
      p.cards
        .get("ios")!
        .fields.get('[data-field="action"]')!
        .attributes.get("aria-disabled"),
    ).toBe("true");
  });

  it.each(["missing", "wrong-package", "invalid-hash"])(
    "fails closed for %s Health data without disabling HarmonyOS",
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
      ).toBe("/down/files/old.hap");
    },
  );

  it("keeps Health Android available when the legacy manifest is unavailable", async () => {
    const p = page();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        response(
          url.includes("saydian-global") ? health : null,
          url.includes("saydian-global"),
        ),
      ),
    );
    await import("./main");
    await vi.waitFor(() =>
      expect(
        p.cards.get("android")!.fields.get('[data-field="action"]')!.href,
      ).toBe("/global/down/files/health.apk"),
    );
    expect(
      p.cards.get("harmonyos")!.fields.get(".status-badge")!.textContent,
    ).toBe("暂不可用");
  });

  it("loads only the independent Say Ring manifest on /say-ring", async () => {
    const p = page("/say-ring");
    const fetch = vi.fn(async (_url: string) => response(legacy));
    vi.stubGlobal("fetch", fetch);
    await import("./main");
    await vi.waitFor(() =>
      expect(
        p.cards.get("android")!.fields.get('[data-field="version"]')!
          .textContent,
      ).toBe("0.1.19（23）"),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "/api/saydian-app/v2/support/app-update?product=say-ring",
    );
    expect(p.nodes.get("#page-title")!.innerHTML).toContain("Say Ring");
  });
});
