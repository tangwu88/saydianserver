import { describe, expect, it } from "vitest";
import {
  UniversalLinksController,
  appleAppSiteAssociation,
} from "./universal-links.controller";

describe("UniversalLinksController", () => {
  it("keeps each production app restricted to its own WeChat callback path", () => {
    expect(new UniversalLinksController().association()).toBe(
      appleAppSiteAssociation,
    );
    expect(appleAppSiteAssociation).toEqual({
      applinks: {
        apps: [],
        details: [
          {
            appID: "W7SXQ4A226.cc.saidian.app",
            paths: ["/wechat/*"],
            components: [
              { "/": "/wechat/*", comment: "Saydian WeChat callback" },
            ],
          },
          {
            appID: "W7SXQ4A226.cn.saydian.ring",
            paths: ["/global/wechat/sayring/*"],
          },
        ],
      },
    });
  });

  it("keeps the public association immutable and free of API response wrapping", () => {
    const association = new UniversalLinksController().association();
    expect(Object.keys(association)).toEqual(["applinks"]);
    expect(Object.isFrozen(association)).toBe(true);
    expect(Object.isFrozen(association.applinks)).toBe(true);
    expect(Object.isFrozen(association.applinks.details)).toBe(true);
    for (const detail of association.applinks.details) {
      expect(Object.isFrozen(detail)).toBe(true);
      expect(Object.isFrozen(detail.paths)).toBe(true);
      expect(detail.paths).not.toContain("*");
      expect(detail.paths).not.toContain("/*");
      expect(detail.paths).not.toContain("/global/*");
    }
  });
});
