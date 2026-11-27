import { describe, expect, it } from "vitest";
import {
  UniversalLinksController,
  appleAppSiteAssociation,
} from "./universal-links.controller";

describe("UniversalLinksController", () => {
  it("preserves each WeChat callback and associates only the two Say Ring friend routes", () => {
    expect(new UniversalLinksController().association()).toBe(
      appleAppSiteAssociation,
    );
    expect(appleAppSiteAssociation).toEqual({
      applinks: {
        apps: [],
        details: [
          {
            appID: "W7SXQ4A226.cc.saidian.app",
            paths: ["/wechat/*", "/global/saydian-cn/ring/invite", "/global/saydian-cn/ring/respond"],
            components: [
              { "/": "/wechat/*", comment: "Saydian WeChat callback" },
              { "/": "/global/saydian-cn/ring/invite" },
              { "/": "/global/saydian-cn/ring/respond" },
            ],
          },
          {
            appID: "W7SXQ4A226.cn.saydian.ring",
            paths: ["/global/wechat/sayring/*", "/global/say-ring/invite", "/global/say-ring/respond"],
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
