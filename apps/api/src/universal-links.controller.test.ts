import { describe, expect, it } from "vitest";
import {
  UniversalLinksController,
  appleAppSiteAssociation,
} from "./universal-links.controller";

describe("UniversalLinksController", () => {
  it("publishes only the production Saydian app and WeChat callback path", () => {
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
        ],
      },
    });
  });
});
