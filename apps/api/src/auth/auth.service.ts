import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { IntegrationState, Prisma, UserStatus } from "@prisma/client";
import { compare, hash } from "bcryptjs";
import { randomUUID } from "node:crypto";
import { sign } from "jsonwebtoken";
import type {
  MemberProfileContract,
  SessionContract,
} from "@saydian/app-contracts";
import { PrismaService } from "../common/prisma.service";
import { env, envBoolean } from "../common/environment";
import {
  maskMobile,
  normalizedMobile,
  randomToken,
  secureEqual,
  sha256,
} from "../common/crypto";
import { SmsAdapterService } from "./sms-adapter.service";
import { IntegrationSecretsService } from "../common/integration-secrets.service";
import { markIntegrationVerified } from "../common/integration-health";
import {
  WechatAppAuthService,
  type WechatAppIdentity,
} from "./wechat-app-auth.service";
import { authAudience, authIssuer, isGlobalRealm } from "../common/deployment-realm";
import { globalError, globalLocale, maskedIdentifier, normalizedEmail } from "./global-identity";

const accessLifetimeSeconds = 15 * 60;
const refreshLifetimeMs = 30 * 24 * 60 * 60 * 1000;

export interface RegisterInput {
  mobile: string;
  password: string;
  nickname?: string;
  consentVersion: string;
  consentSource: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsAdapterService,
    private readonly integrationSecrets: IntegrationSecretsService,
    private readonly wechatApp: WechatAppAuthService,
  ) {}

  async register(input: RegisterInput, mobileVerified = false): Promise<SessionContract> {
    if (isGlobalRealm()) throw globalError(400, "verification_required", "Use verified email or international phone registration.");
    if (!mobileVerified) throw new BadRequestException("请使用手机验证码完成注册");
    const mobile = normalizedMobile(input.mobile);
    this.assertPassword(input.password);
    if (!mobile) throw new BadRequestException("手机号格式不正确");
    if (!input.consentVersion.trim()) {
      throw new BadRequestException("请先阅读并同意用户协议与隐私政策");
    }
    const existing = await this.prisma.user.findUnique({ where: { mobile } });
    if (existing) {
      throw new ConflictException("该手机号已注册，请直接登录");
    }
    const passwordHash = await hash(input.password, 12);
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
            data: {
              mobile,
              passwordHash,
              mobileVerifiedAt: new Date(),
              nickname: input.nickname?.trim() || `用户${mobile.slice(-4)}`,
            },
          });
      for (const documentType of ["user_agreement", "privacy_policy"]) {
        await tx.consentRecord.upsert({
          where: {
            userId_documentType_version: {
              userId: created.id,
              documentType,
              version: input.consentVersion,
            },
          },
          create: {
            userId: created.id,
            documentType,
            version: input.consentVersion,
            source: input.consentSource,
          },
          update: { withdrawnAt: null, source: input.consentSource },
        });
      }
      return created;
    });
    return this.issueSession(user.id);
  }

  private async passwordUser(mobileInput: string, password: string) {
    const mobile = normalizedMobile(mobileInput);
    const email = isGlobalRealm() ? normalizedEmail(mobileInput) : "";
    if ((!mobile && !email) || !password) throw new UnauthorizedException("账号或密码错误");
    const user = await this.prisma.user.findUnique({ where: email ? { email } : { mobile } });
    if (
      !user?.passwordHash ||
      user.status !== UserStatus.ACTIVE ||
      !(await compare(password, user.passwordHash)) ||
      (isGlobalRealm() && !(user.emailVerifiedAt || user.mobileVerifiedAt))
    ) {
      throw new UnauthorizedException("账号或密码错误");
    }
    if (!user.passwordHash.startsWith("$2b$12$")) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hash(password, 12) },
      });
    }
    return user;
  }

  async login(mobileInput: string, password: string): Promise<SessionContract> {
    const user = await this.passwordUser(mobileInput, password);
    return this.issueSession(user.id);
  }

  async refresh(refreshToken: string): Promise<SessionContract> {
    const normalized = refreshToken.trim();
    if (!normalized) throw new UnauthorizedException("登录已失效，请重新登录");
    const tokenHash = this.refreshHash(normalized);
    const session = await this.prisma.userSession.findUnique({
      where: { refreshTokenHash: tokenHash },
      include: { user: true },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.user.status !== UserStatus.ACTIVE
    ) {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }
    const replacement = randomToken();
    const accessJti = randomUUID();
    const rotated = await this.prisma.userSession.updateMany({
      where: {
        id: session.id,
        refreshTokenHash: tokenHash,
        revokedAt: null,
      },
      data: {
        accessJti,
        refreshTokenHash: this.refreshHash(replacement),
        lastUsedAt: new Date(),
      },
    });
    if (rotated.count !== 1) {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }
    return this.sessionContract(
      session.user.id,
      session.id,
      accessJti,
      replacement,
    );
  }

  async refreshForMall(refreshToken: string) {
    const session = await this.refresh(refreshToken);
    return this.mallSession(session, session.member.mobileMasked ?? null);
  }

  async loginForMall(mobile: string, password: string, referralCode?: string) {
    const user = await this.passwordUser(mobile, password);
    if (!(user.mobileVerifiedAt || (isGlobalRealm() && user.emailVerifiedAt))) throw new UnauthorizedException("请先使用手机验证码验证后登录商城");
    const session = await this.issueSession(user.id);
    if (referralCode) await this.bindReferral(user.id, referralCode);
    return this.mallSession(session, user.mobile);
  }

  async issueMallSession(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.status !== UserStatus.ACTIVE || !(user.mobileVerifiedAt || (isGlobalRealm() && user.emailVerifiedAt))) {
      throw new UnauthorizedException("请先完成手机号验证");
    }
    return this.mallSession(await this.issueSession(userId), user.mobile);
  }

  consumeMobileBindingCode(mobile: string, code: string) {
    return this.consumeSms(mobile, code, "bind_mobile");
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async requestSmsCode(
    mobileInput: string,
    usageInput: string,
  ): Promise<{ expiresIn: number; devCode?: string }> {
    if (isGlobalRealm()) throw globalError(400, "verification_required", "Use the verification-code endpoint to verify your account.");
    const mobile = normalizedMobile(mobileInput);
    const usage = usageInput.trim() || "register";
    if (!mobile) throw new BadRequestException("手机号格式不正确");
    if (!["register", "reset_password", "login", "bind_mobile"].includes(usage)) {
      throw new BadRequestException("验证码用途不正确");
    }
    const recent = await this.prisma.smsCode.count({
      where: { mobile, createdAt: { gt: new Date(Date.now() - 60_000) } },
    });
    if (recent > 0) throw new BadRequestException("请稍后再获取验证码");
    const testMode = envBoolean("ALLOW_TEST_OTP");
    const code = testMode
      ? "123456"
      : String(Math.floor(100000 + Math.random() * 900000));
    const stored = await this.prisma.smsCode.create({
      data: {
        mobile,
        usage,
        codeHash: sha256(`${code}:${env("REFRESH_TOKEN_PEPPER")}`),
        expiresAt: new Date(Date.now() + 5 * 60_000),
      },
    });
    if (!testMode) {
      try {
        await this.sms.send(mobile, code, usage);
      } catch (error) {
        await this.prisma.smsCode.delete({ where: { id: stored.id } });
        throw error;
      }
    }
    return { expiresIn: 300, ...(testMode ? { devCode: code } : {}) };
  }

  async registerWithSms(
    input: RegisterInput & { code: string },
  ): Promise<SessionContract> {
    await this.consumeSms(input.mobile, input.code, "register");
    return this.register(input, true);
  }

  async loginWithSms(input: {
    mobile: string;
    code: string;
    consentVersion: string;
    consentSource: string;
    referralCode?: string;
  }) {
    const mobile = normalizedMobile(input.mobile);
    if (!mobile) throw new BadRequestException("手机号格式不正确");
    this.assertConsentVersion(input.consentVersion);
    await this.consumeSms(mobile, input.code, "login");
    const employee = input.referralCode
      ? await this.prisma.commerceEmployee.findFirst({
          where: { referralCode: input.referralCode, active: true },
        })
      : null;
    const user = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { mobile } });
      if (existing && existing.status !== UserStatus.ACTIVE) {
        throw new UnauthorizedException("账号不可用，请联系客服核验状态");
      }
      const saved = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: {
              mobileVerifiedAt: new Date(),
              ...(existing.referralEmployeeId || !employee
                ? {}
                : { referralEmployeeId: employee.id }),
            },
          })
        : await tx.user.create({
            data: {
              mobile,
              mobileVerifiedAt: new Date(),
              nickname: `用户${mobile.slice(-4)}`,
              ...(employee ? { referralEmployeeId: employee.id } : {}),
            },
          });
      await this.recordLegalConsent(
        tx,
        saved.id,
        input.consentVersion,
        input.consentSource,
      );
      return saved;
    });
    return this.mallSession(await this.issueSession(user.id), mobile);
  }

  async loginWechatMini(input: {
    code: string;
    consentVersion: string;
    consentSource: string;
    referralCode?: string;
  }) {
    if (isGlobalRealm()) throw globalError(503, "social_login_unavailable", "Use email or international phone to sign in.");
    const code = input.code.trim();
    if (!code) throw new BadRequestException("微信登录凭证缺失");
    this.assertConsentVersion(input.consentVersion);
    const integration = await this.prisma.integrationConfig.findUnique({
      where: { key: "wechat_pay" },
    });
    if (!integration || integration.state !== IntegrationState.CONFIGURED) {
      throw new ServiceUnavailableException("微信登录暂时无法使用，请稍后再试");
    }
    const publicConfig = safeJsonObject(integration.publicConfig);
    const secrets = await this.integrationSecrets.resolve("wechat_pay", {
      appIdMini: "WECHAT_PAY_APP_ID_MINI",
      appSecretMini: "WECHAT_MINI_APP_SECRET",
    });
    const appId = secrets.appIdMini ?? String(publicConfig.appIdMini ?? "");
    const appSecret = secrets.appSecretMini ?? "";
    if (!appId || !appSecret) {
      throw new ServiceUnavailableException("微信登录暂时无法使用，请稍后再试");
    }
    const response = await fetch(
      `https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`,
      { signal: AbortSignal.timeout(15_000) },
    );
    const result = safeJsonObject(await response.json().catch(() => ({})));
    const openId = String(result.openid ?? "").trim();
    const unionId = String(result.unionid ?? "").trim() || null;
    if (!response.ok || !openId) {
      throw new UnauthorizedException("微信登录失败，请稍后重试");
    }
    await markIntegrationVerified(this.prisma, "wechat_pay");
    const employee = input.referralCode
      ? await this.prisma.commerceEmployee.findFirst({
          where: { referralCode: input.referralCode, active: true },
        })
      : null;
    const user = await this.prisma.$transaction(async (tx) => {
      const [byOpenId, byUnionId] = await Promise.all([
        tx.user.findUnique({ where: { wechatOpenId: openId } }),
        unionId ? tx.user.findUnique({ where: { wechatUnionId: unionId } }) : null,
      ]);
      if (byOpenId && byUnionId && byOpenId.id !== byUnionId.id) {
        throw new ConflictException("微信账号关联存在冲突，请联系客服处理");
      }
      const existing = byUnionId ?? byOpenId;
      if (existing && existing.status !== UserStatus.ACTIVE) {
        throw new UnauthorizedException("账号不可用，请联系客服核验状态");
      }
      const saved = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: {
              wechatOpenId: openId,
              ...(unionId ? { wechatUnionId: unionId } : {}),
              ...(existing.referralEmployeeId || !employee
                ? {}
                : { referralEmployeeId: employee.id }),
            },
          })
        : await tx.user.create({
            data: {
              wechatOpenId: openId,
              ...(unionId ? { wechatUnionId: unionId } : {}),
              nickname: "微信用户",
              ...(employee ? { referralEmployeeId: employee.id } : {}),
            },
          });
      await this.recordLegalConsent(
        tx,
        saved.id,
        input.consentVersion,
        input.consentSource,
      );
      return saved;
    });
    return this.mallSession(await this.issueSession(user.id), user.mobile);
  }

  async loginWechatApp(input: {
    code: string;
    state: string;
    platform: string;
    consentAccepted: boolean;
    consentVersion: string;
    consentSource: string;
  }): Promise<SessionContract> {
    if (isGlobalRealm()) throw globalError(503, "social_login_unavailable", "Use email or international phone to sign in.");
    if (!input.consentAccepted) {
      throw new BadRequestException("请先阅读并同意用户协议与隐私政策");
    }
    this.assertConsentVersion(input.consentVersion);
    const identity = await this.wechatApp.exchange(input);
    const user = await this.prisma.$transaction(async (tx) => {
      const [byOpenId, byUnionId] = await Promise.all([
        tx.user.findUnique({ where: { wechatAppOpenId: identity.openId } }),
        identity.unionId
          ? tx.user.findUnique({ where: { wechatUnionId: identity.unionId } })
          : null,
      ]);
      if (byOpenId && byUnionId && byOpenId.id !== byUnionId.id) {
        throw new ConflictException("微信账号关联存在冲突，请联系客服处理");
      }
      const existing = byUnionId ?? byOpenId;
      if (existing && existing.status !== UserStatus.ACTIVE) {
        throw new UnauthorizedException("账号不可用，请联系客服核验状态");
      }
      const saved = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: {
              wechatAppOpenId: identity.openId,
              ...(identity.unionId ? { wechatUnionId: identity.unionId } : {}),
              ...wechatProfileBackfill(existing, identity),
            },
          })
        : await tx.user.create({
            data: {
              wechatAppOpenId: identity.openId,
              ...(identity.unionId ? { wechatUnionId: identity.unionId } : {}),
              nickname: identity.nickname,
              ...(identity.avatarUrl ? { avatarUrl: identity.avatarUrl } : {}),
              gender: identity.gender,
            },
          });
      await this.recordLegalConsent(
        tx,
        saved.id,
        input.consentVersion,
        input.consentSource,
      );
      return saved;
    });
    return this.issueSession(user.id);
  }

  async bindReferral(userId: string, referralCodeInput: string) {
    const referralCode = referralCodeInput.trim();
    if (!referralCode) return { bound: false };
    const employee = await this.prisma.commerceEmployee.findFirst({
      where: { referralCode, active: true },
    });
    if (!employee) return { bound: false };
    const changed = await this.prisma.user.updateMany({
      where: { id: userId, referralEmployeeId: null },
      data: { referralEmployeeId: employee.id },
    });
    return {
      bound: changed.count === 1,
      ...(changed.count ? { employeeName: employee.name } : {}),
    };
  }

  async resetPassword(
    mobileInput: string,
    code: string,
    password: string,
  ): Promise<SessionContract> {
    const mobile = normalizedMobile(mobileInput);
    this.assertPassword(password);
    await this.consumeSms(mobile, code, "reset_password");
    const user = await this.prisma.user.findUnique({ where: { mobile } });
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new BadRequestException("未找到可重置的账号");
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hash(password, 12) },
      }),
      this.prisma.userSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return this.issueSession(user.id);
  }

  async requestAccountDeletion(userId: string): Promise<{ executeAfter: string }> {
    const executeAfter = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { status: UserStatus.DELETION_PENDING },
      }),
      this.prisma.accountDeletionRequest.create({
        data: { userId, executeAfter },
      }),
      this.prisma.userSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.pushInstallation.updateMany({
        where: { userId },
        data: { enabled: false },
      }),
    ]);
    return { executeAfter: executeAfter.toISOString() };
  }

  async profile(userId: string): Promise<MemberProfileContract> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return this.toProfile(user);
  }

  async issueSession(userId: string): Promise<SessionContract> {
    const sessionId = randomUUID();
    const accessJti = randomUUID();
    const refreshToken = randomToken();
    await this.prisma.userSession.create({
      data: {
        id: sessionId,
        userId,
        accessJti,
        refreshTokenHash: this.refreshHash(refreshToken),
        expiresAt: new Date(Date.now() + refreshLifetimeMs),
      },
    });
    return this.sessionContract(userId, sessionId, accessJti, refreshToken);
  }

  private async sessionContract(
    userId: string,
    sessionId: string,
    accessJti: string,
    refreshToken: string,
  ): Promise<SessionContract> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const expiresAt = new Date(Date.now() + accessLifetimeSeconds * 1000);
    const accessToken = sign(
      { sub: user.id, sid: sessionId, typ: "access" },
      env("ACCESS_TOKEN_SECRET"),
      {
        algorithm: "HS256",
        expiresIn: accessLifetimeSeconds,
        jwtid: accessJti,
        issuer: authIssuer(),
        audience: authAudience(),
      },
    );
    return {
      accessToken,
      refreshToken,
      expiresAt: expiresAt.toISOString(),
      member: this.toProfile(user),
    };
  }

  private toProfile(user: {
    id: string;
    legacyMemberId: string | null;
    mobile: string | null;
    nickname: string;
    avatarUrl: string | null;
    gender: string;
    birthday: Date | null;
    heightCm: { toNumber(): number } | null;
    weightKg: { toNumber(): number } | null;
    email?: string | null;
    locale?: string | null;
  }): MemberProfileContract {
    const mobileMasked = maskMobile(user.mobile);
    return {
      id: user.id,
      ...(user.legacyMemberId ? { legacyMemberId: user.legacyMemberId } : {}),
      ...(mobileMasked ? { mobileMasked } : {}),
      ...(isGlobalRealm() ? {
        ...(user.mobile ? { phoneMasked: maskedIdentifier("sms", user.mobile) } : {}),
        ...(user.email ? { emailMasked: maskedIdentifier("email", user.email) } : {}),
        locale: globalLocale(user.locale),
      } : {}),
      nickname: user.nickname,
      ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
      gender:
        user.gender === "MALE"
          ? "male"
          : user.gender === "FEMALE"
            ? "female"
            : "unspecified",
      ...(user.birthday
        ? { birthday: user.birthday.toISOString().slice(0, 10) }
        : {}),
      ...(user.heightCm ? { heightCm: user.heightCm.toNumber() } : {}),
      ...(user.weightKg ? { weightKg: user.weightKg.toNumber() } : {}),
    };
  }

  private refreshHash(token: string): string {
    return sha256(`${token}:${env("REFRESH_TOKEN_PEPPER")}`);
  }

  private assertPassword(password: string): void {
    if (password.length < 8 || password.length > 72) {
      throw new BadRequestException("密码需为8至72个字符");
    }
  }

  private assertConsentVersion(version: string): void {
    if (!version.trim() || version.length > 80) {
      throw new BadRequestException("请先阅读并同意用户协议与隐私政策");
    }
  }

  private async recordLegalConsent(
    tx: Prisma.TransactionClient,
    userId: string,
    version: string,
    source: string,
  ) {
    for (const documentType of ["user_agreement", "privacy_policy"]) {
      await tx.consentRecord.upsert({
        where: {
          userId_documentType_version: { userId, documentType, version },
        },
        create: { userId, documentType, version, source },
        update: { withdrawnAt: null, source },
      });
    }
  }

  private mallSession(session: SessionContract, mobile: string | null) {
    return {
      token: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
      user: {
        id: session.member.id,
        nickname: session.member.nickname,
        mobile,
        avatarUrl: session.member.avatarUrl ?? null,
      },
    };
  }

  private async consumeSms(
    mobileInput: string,
    code: string,
    usage: string,
  ): Promise<void> {
    if (isGlobalRealm()) throw globalError(400, "verification_required", "Use the verification-code endpoint to verify your account.");
    const mobile = normalizedMobile(mobileInput);
    if (!mobile || !/^\d{6}$/.test(code)) {
      throw new BadRequestException("验证码不正确");
    }
    const record = await this.prisma.smsCode.findFirst({
      where: {
        mobile,
        usage,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!record || record.attempts >= 5) {
      throw new BadRequestException("验证码不正确或已过期");
    }
    const submittedHash = sha256(`${code}:${env("REFRESH_TOKEN_PEPPER")}`);
    if (!secureEqual(record.codeHash, submittedHash)) {
      await this.prisma.smsCode.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException("验证码不正确或已过期");
    }
    const consumed = await this.prisma.smsCode.updateMany({
      where: { id: record.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) {
      throw new BadRequestException("验证码不正确或已过期");
    }
  }
}

function safeJsonObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function wechatProfileBackfill(
  existing: {
    nickname: string;
    avatarUrl: string | null;
    gender: string;
  },
  identity: WechatAppIdentity,
): Prisma.UserUpdateInput {
  return {
    ...(!existing.avatarUrl && identity.avatarUrl
      ? { avatarUrl: identity.avatarUrl }
      : {}),
    ...(existing.nickname === "微信用户" && identity.nickname !== "微信用户"
      ? { nickname: identity.nickname }
      : {}),
    ...(existing.gender === "UNSPECIFIED" && identity.gender !== "UNSPECIFIED"
      ? { gender: identity.gender }
      : {}),
  };
}
