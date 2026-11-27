import { Controller, Get, Header } from "@nestjs/common";
import { RawResponse } from "./common/raw-response.decorator";

const APP_ID = "W7SXQ4A226.cc.saidian.app";

export const appleAppSiteAssociation = Object.freeze({
  applinks: Object.freeze({
    apps: Object.freeze([]),
    details: Object.freeze([
      Object.freeze({
        appID: APP_ID,
        paths: Object.freeze(["/wechat/*", "/global/saydian-cn/ring/invite", "/global/saydian-cn/ring/respond"]),
        components: Object.freeze([
          Object.freeze({
            "/": "/wechat/*",
            comment: "Saydian WeChat callback",
          }),
          Object.freeze({ "/": "/global/saydian-cn/ring/invite" }),
          Object.freeze({ "/": "/global/saydian-cn/ring/respond" }),
        ]),
      }),
      Object.freeze({
        appID: "W7SXQ4A226.cn.saydian.ring",
        paths: Object.freeze([
          "/global/wechat/sayring/*",
          "/global/say-ring/invite",
          "/global/say-ring/respond",
        ]),
      }),
    ]),
  }),
});

@Controller(".well-known")
@RawResponse()
export class UniversalLinksController {
  @Get("assetlinks.json")
  @Header("Content-Type", "application/json")
  @Header("Cache-Control", "public, max-age=300")
  androidAssociation() {
    const fingerprints = (process.env.SAY_RING_ANDROID_LINK_CERTIFICATES ?? "")
      .split(",").map((value) => value.trim().toUpperCase())
      .filter((value) => /^[A-F0-9]{2}(?::[A-F0-9]{2}){31}$/.test(value));
    // Older CN builds claimed the Say Ring paths. Do not add a domain-wide CN
    // association here: it would verify those old filters too. CN web buttons
    // use a package-scoped intent for the new path instead.
    if (fingerprints.length === 0 || process.env.DEPLOYMENT_SITE === "us") return [];
    return [{
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app", package_name: "cn.saydian.ring",
        sha256_cert_fingerprints: [...new Set(fingerprints)],
      },
    }];
  }

  @Get("apple-app-site-association")
  @Header("Content-Type", "application/json")
  @Header("Cache-Control", "public, max-age=300")
  association() {
    return appleAppSiteAssociation;
  }
}
