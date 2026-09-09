import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AuthService } from "./auth.service";
import { CurrentUser, type AuthenticatedUser } from "../common/request-context";
import { UserAuthGuard } from "../common/user-auth.guard";
import { safeObject } from "../common/crypto";
import { isGlobalRealm } from "../common/deployment-realm";
import { GlobalAuthService } from "./global-auth.service";
import { Throttle } from "@nestjs/throttler";

@ApiTags("auth")
@Controller("api/saydian-app/v2/auth")
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly globalAuth: GlobalAuthService) {}

  @Get("capabilities")
  capabilities(@Query("locale") locale?: string) { return this.globalAuth.capabilities(locale); }

  @Post("verification-code")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  verificationCode(@Body() input: unknown) { return this.globalAuth.requestCode(input); }

  @Post("register-with-code")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  registerWithCode(@Body() input: unknown) { return this.globalAuth.register(input); }

  @Post("register")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  register(@Body() input: unknown) {
    if (isGlobalRealm()) return this.globalAuth.registerWithoutVerification(input);
    const body = safeObject(input);
    return this.auth.register({
      mobile: String(body.mobile ?? ""),
      password: String(body.password ?? ""),
      nickname: String(body.nickname ?? ""),
      consentVersion: String(body.consentVersion ?? ""),
      consentSource: "app_v2",
    });
  }

  @Post("login")
  login(@Body() input: unknown) {
    if (isGlobalRealm()) return this.globalAuth.login(input);
    const body = safeObject(input);
    return this.auth.login(
      String(body.mobile ?? body.username ?? ""),
      String(body.password ?? ""),
    );
  }

  @Post("wechat-login")
  wechatLogin(@Body() input: unknown) {
    const body = safeObject(input);
    return this.auth.loginWechatApp({
      code: String(body.code ?? ""),
      state: String(body.state ?? ""),
      platform: String(body.platform ?? ""),
      consentAccepted: body.consentAccepted === true,
      consentVersion: String(body.consentVersion ?? ""),
      consentSource: "app_v2_wechat",
    });
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
    if (isGlobalRealm()) return this.globalAuth.resetPassword(input);
    const body = safeObject(input);
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
