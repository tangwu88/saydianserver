import { BadRequestException } from "@nestjs/common";

// App identity is separate from the shared account/legal product.
export function wechatAppConfiguration(appProduct?: unknown) {
  if (appProduct === "saydian-app-cn") {
    return {
      key: "cn_wechat_login",
      environment: {
        appId: "CN_WECHAT_LOGIN_APP_ID",
        appSecret: "CN_WECHAT_LOGIN_APP_SECRET",
      },
    };
  }
  if (
    appProduct == null ||
    appProduct === "" ||
    appProduct === "saydian-global"
  ) {
    return {
      key: "wechat_login",
      environment: {
        appId: "WECHAT_LOGIN_APP_ID",
        appSecret: "WECHAT_LOGIN_APP_SECRET",
      },
    };
  }
  throw new BadRequestException("微信登录应用标识不正确");
}
