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
        paths: Object.freeze(["/global/wechat/sayring/*"]),
      }),
    ]),
  }),
});

@Controller(".well-known")
@RawResponse()
export class UniversalLinksController {
  @Get("apple-app-site-association")
  @Header("Content-Type", "application/json")
  @Header("Cache-Control", "public, max-age=300")
  association() {
    return appleAppSiteAssociation;
  }
}
