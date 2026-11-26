import { Controller, Get, Header } from "@nestjs/common";
import { RawResponse } from "./common/raw-response.decorator";

const APP_ID = "W7SXQ4A226.cc.saidian.app";

export const appleAppSiteAssociation = Object.freeze({
  applinks: Object.freeze({
    apps: Object.freeze([]),
    details: Object.freeze([
      Object.freeze({
        appID: APP_ID,
        paths: Object.freeze(["/wechat/*"]),
        components: Object.freeze([
          Object.freeze({
            "/": "/wechat/*",
            comment: "Saydian WeChat callback",
          }),
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
