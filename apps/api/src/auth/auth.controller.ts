import {
  Body,
  Controller,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AuthService } from "./auth.service";
import { CurrentUser, type AuthenticatedUser } from "../common/request-context";
import { UserAuthGuard } from "../common/user-auth.guard";
import { safeObject } from "../common/crypto";

@ApiTags("auth")
@Controller("api/saydian-app/v2/auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("register")
  register(@Body() input: unknown) {
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
    const body = safeObject(input);
    return this.auth.login(
      String(body.mobile ?? body.username ?? ""),
      String(body.password ?? ""),
    );
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
