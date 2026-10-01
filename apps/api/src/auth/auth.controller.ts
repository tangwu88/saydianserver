import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AuthService } from "./auth.service";
import { CurrentUser, type AuthenticatedUser } from "../common/request-context";
import { UserAuthGuard } from "../common/user-auth.guard";
import { safeObject } from "../common/crypto";

import { GlobalAuthService } from "./global-auth.service";
import { Throttle } from "@nestjs/throttler";
import { GlobalWechatAppService } from "./global-wechat-app.service";

@ApiTags("auth")
@Controller("api/saydian-app/v2/auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly globalAuth: GlobalAuthService,
    private readonly globalWechatApp: GlobalWechatAppService,
  ) {}

  @Get("capabilities")
  capabilities(
    @Query("locale") locale?: string,
    @Query("product") product?: string,
  ) {
    return this.globalAuth.capabilities(locale, product);
  }

  @Post("verification-code")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  verificationCode(@Body() input: unknown) {
    return this.globalAuth.requestCode(input);
  }

  @Post("register-with-code")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  registerWithCode(@Body() input: unknown) {
    return this.globalAuth.register(input);
  }

  @Post("register")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  register(@Body() input: unknown) {
    return this.globalAuth.registerWithoutVerification(input);
  }

  @Post("login")
  login(@Body() input: unknown) {
    return this.globalAuth.login(input);
  }

  @Post("wechat-login")
  wechatLogin(@Body() input: unknown) {
    return this.globalWechatApp.login(input);
  }

  @Post("wechat-phone-code")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  wechatPhoneCode(@Body() input: unknown) {
    return this.globalWechatApp.requestPhoneCode(input);
  }

  @Post("wechat-bind-phone")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  wechatBindPhone(@Body() input: unknown) {
    return this.globalWechatApp.bindPhone(input);
  }

  @Post("sms-code")
  requestSms(@Body() input: unknown) {
    const body = safeObject(input);
    return this.auth.requestSmsCode(
      String(body.mobile ?? ""),
      String(body.usage ?? "register"),
    );
  }

  @Post("register-with-sms")
  registerWithSms(@Body() input: unknown) {
    const body = safeObject(input);
    return this.auth.registerWithSms({
      mobile: String(body.mobile ?? ""),
      code: String(body.code ?? ""),
      password: String(body.password ?? ""),
      nickname: String(body.nickname ?? ""),
      consentVersion: String(body.consentVersion ?? ""),
      consentSource: "app_v2",
    });
  }

  @Post("reset-password")
  resetPassword(@Body() input: unknown) {
    const body = safeObject(input);
    if (body.challengeId) return this.globalAuth.resetPassword(input);
    return this.auth.resetPassword(
      String(body.mobile ?? ""),
      String(body.code ?? ""),
      String(body.password ?? body.newPassword ?? ""),
    );
  }

  @Post("refresh")
  refresh(@Body() input: unknown) {
    return this.auth.refresh(String(safeObject(input).refreshToken ?? ""));
  }

  @Post("logout")
  @UseGuards(UserAuthGuard)
  async logout(@CurrentUser() user: AuthenticatedUser) {
    await this.auth.logout(user.sessionId);
    return { loggedOut: true };
  }

  @Post("delete-account")
  @UseGuards(UserAuthGuard)
  deleteAccount(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.requestAccountDeletion(user.id);
  }
}
