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
