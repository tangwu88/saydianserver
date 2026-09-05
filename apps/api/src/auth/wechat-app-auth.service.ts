import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { Gender, IntegrationState } from "@prisma/client";
import { PrismaService } from "../common/prisma.service";
import { safeObject } from "../common/crypto";
import { IntegrationSecretsService } from "../common/integration-secrets.service";
import { markIntegrationVerified } from "../common/integration-health";

const stateMaxAgeMs = 10 * 60 * 1000;
const providerTimeoutMs = 15_000;
const validPlatforms = new Set(["android", "harmony", "ios"]);

export interface WechatAppIdentity {
  openId: string;
  unionId: string | null;
  nickname: string;
  avatarUrl: string | null;
  gender: Gender;
}

@Injectable()
export class WechatAppAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationSecrets: IntegrationSecretsService,
  ) {}

  async exchange(input: {
    code: string;
    state: string;
    platform: string;
  }): Promise<WechatAppIdentity> {
    const code = input.code.trim();
    const state = input.state.trim();
    const platform = input.platform.trim().toLowerCase();
    if (code.length < 6 || code.length > 1_024 || /\s/.test(code)) {
      throw new BadRequestException("微信登录凭证不正确");
    }
    if (!validPlatforms.has(platform)) {
      throw new BadRequestException("客户端平台不正确");
    }
    if (!isFreshWechatAppState(state)) {
      throw new UnauthorizedException("微信授权已失效，请重新授权");
    }

    const integration = await this.prisma.integrationConfig.findUnique({
      where: { key: "wechat_login" },
    });
    if (!integration || integration.state !== IntegrationState.CONFIGURED) {
      throw new ServiceUnavailableException("微信登录暂时无法使用，请稍后再试");
    }
    const publicConfig = safeObject(integration.publicConfig);
    const secrets = await this.integrationSecrets.resolve("wechat_login", {
      appId: "WECHAT_LOGIN_APP_ID",
      appSecret: "WECHAT_LOGIN_APP_SECRET",
    });
    const appId = (secrets.appId ?? String(publicConfig.appId ?? "")).trim();
    const appSecret = (secrets.appSecret ?? "").trim();
    if (!/^wx[A-Za-z0-9]{8,64}$/.test(appId) || appSecret.length < 16) {
      throw new ServiceUnavailableException("微信登录暂时无法使用，请稍后再试");
    }

    const accessUrl = new URL("https://api.weixin.qq.com/sns/oauth2/access_token");
    accessUrl.searchParams.set("appid", appId);
    accessUrl.searchParams.set("secret", appSecret);
    accessUrl.searchParams.set("code", code);
    accessUrl.searchParams.set("grant_type", "authorization_code");
    const access = await this.fetchProvider(accessUrl);
    const providerError = Number(access.errcode ?? 0);
    if ([40029, 40163, 42001].includes(providerError)) {
      throw new UnauthorizedException("微信授权已失效，请重新授权");
    }
    const accessToken = String(access.access_token ?? "").trim();
    const openId = boundedIdentifier(access.openid);
    if (providerError || !accessToken || accessToken.length > 2_048 || !openId) {
      throw new ServiceUnavailableException("微信登录暂时无法使用，请稍后再试");
    }

    const profile = await this.fetchProfile(accessToken, openId);
    const profileOpenId = boundedIdentifier(profile.openid);
    const trustedProfile = !profileOpenId || profileOpenId === openId ? profile : {};
    const unionId =
      boundedIdentifier(trustedProfile.unionid) ?? boundedIdentifier(access.unionid);
    await markIntegrationVerified(this.prisma, "wechat_login");
    return {
      openId,
      unionId,
      nickname: cleanDisplayText(trustedProfile.nickname) || "微信用户",
      avatarUrl: secureAvatarUrl(trustedProfile.headimgurl),
      gender: providerGender(trustedProfile.sex),
    };
  }

  private async fetchProfile(
    accessToken: string,
    openId: string,
  ): Promise<Record<string, unknown>> {
    const profileUrl = new URL("https://api.weixin.qq.com/sns/userinfo");
    profileUrl.searchParams.set("access_token", accessToken);
    profileUrl.searchParams.set("openid", openId);
    profileUrl.searchParams.set("lang", "zh_CN");
    try {
      const result = await this.fetchProvider(profileUrl);
      return Number(result.errcode ?? 0) ? {} : result;
    } catch {
      // A valid one-time-code exchange is sufficient for authentication.
      // Profile fields are optional and must not create a second login attempt.
      return {};
    }
  }

  private async fetchProvider(url: URL): Promise<Record<string, unknown>> {
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(providerTimeoutMs),
      });
      if (!response.ok) {
        throw new ServiceUnavailableException("微信登录暂时无法使用，请稍后再试");
      }
      return safeObject(await response.json().catch(() => ({})));
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new ServiceUnavailableException("微信登录暂时无法使用，请稍后再试");
    }
  }
}

export function isFreshWechatAppState(
  state: string,
  now = Date.now(),
): boolean {
  const match = state.match(/^sd_([0-9]{13})_[A-Za-z0-9-]{16,64}$/);
  if (!match || !Number.isSafeInteger(now) || now <= 0) return false;
  const startedAt = Number(match[1]);
  return (
    Number.isSafeInteger(startedAt) &&
    startedAt <= now + 60_000 &&
    now - startedAt <= stateMaxAgeMs
  );
}

function boundedIdentifier(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text && text.length <= 128 && !/\s/.test(text) ? text : null;
}

function cleanDisplayText(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function secureAvatarUrl(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text || text.length > 1_024) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function providerGender(value: unknown): Gender {
  return Number(value) === 1
    ? Gender.MALE
    : Number(value) === 2
      ? Gender.FEMALE
      : Gender.UNSPECIFIED;
}
