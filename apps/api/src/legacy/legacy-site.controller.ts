import {
  Body,
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { NoFilesInterceptor } from "@nestjs/platform-express";
import { AuthService } from "../auth/auth.service";
import { safeObject } from "../common/crypto";
import { RawResponse } from "../common/raw-response.decorator";
import { CurrentUser, type AuthenticatedUser } from "../common/request-context";
import { UserAuthGuard } from "../common/user-auth.guard";
import { legacySession, legacySuccess } from "./legacy-response";
import { LegacyService } from "./legacy.service";

@Controller("api/v1/site")
@RawResponse()
@UseInterceptors(NoFilesInterceptor({ limits: { fields: 30, fieldSize: 2 * 1024 * 1024 } }))
export class LegacySiteController {
  constructor(
    private readonly auth: AuthService,
    private readonly legacy: LegacyService,
  ) {}

  @Post("login")
  async login(@Body() input: unknown) {
    const body = safeObject(input);
    const session = await this.auth.login(
      String(body.username ?? body.mobile ?? ""),
      String(body.password ?? ""),
    );
    return legacySession(session, await this.legacy.member(session.member.id));
  }

  @Post("register")
  async register(@Body() input: unknown) {
    const body = safeObject(input);
    const nickname = String(body.nickname ?? "").trim();
    const registerInput = {
      mobile: String(body.mobile ?? body.username ?? ""),
      password: String(body.password ?? ""),
      ...(nickname ? { nickname } : {}),
      consentVersion: String(
        body.consent_version ?? "legacy-app-registration-v1",
      ),
      consentSource: "legacy_app_registration",
    };
    const code = String(body.code ?? "").trim();
    const session = code
      ? await this.auth.registerWithSms({ ...registerInput, code })
      : await this.auth.register(registerInput);
    return legacySession(session, await this.legacy.member(session.member.id));
  }

  @Post("sms-code")
  async smsCode(@Body() input: unknown) {
    const body = safeObject(input);
    const result = await this.auth.requestSmsCode(
      String(body.mobile ?? ""),
      normalizeSmsUsage(String(body.usage ?? "register")),
    );
    return legacySuccess(result, "验证码已发送");
  }

  @Post("up-pwd")
  async resetPassword(@Body() input: unknown) {
    const body = safeObject(input);
    const session = await this.auth.resetPassword(
      String(body.mobile ?? ""),
      String(body.code ?? ""),
      String(body.password ?? ""),
    );
    return legacySession(session, await this.legacy.member(session.member.id));
  }

  @Post("refresh")
  async refresh(@Body() input: unknown) {
    const session = await this.auth.refresh(
      String(safeObject(input).refresh_token ?? ""),
    );
    return legacySession(session, await this.legacy.member(session.member.id));
  }

  @Post("logout")
  @UseGuards(UserAuthGuard)
  async logout(@CurrentUser() user: AuthenticatedUser) {
    await this.auth.logout(user.sessionId);
    return legacySuccess({ logged_out: true }, "已退出登录");
  }
}

function normalizeSmsUsage(value: string): string {
  const normalized = value.trim().toLowerCase();
  return ["reset", "forgot", "up-pwd", "reset_password"].includes(normalized)
    ? "reset_password"
    : "register";
}
