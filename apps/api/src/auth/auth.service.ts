import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { UserStatus } from "@prisma/client";
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
  ) {}

  async register(input: RegisterInput): Promise<SessionContract> {
    const mobile = normalizedMobile(input.mobile);
    this.assertPassword(input.password);
    if (!mobile) throw new BadRequestException("手机号格式不正确");
    if (!input.consentVersion.trim()) {
      throw new BadRequestException("请先阅读并同意用户协议与隐私政策");
    }
    const existing = await this.prisma.user.findUnique({ where: { mobile } });
    if (existing && existing.status !== UserStatus.DELETED) {
      throw new ConflictException("该手机号已注册，请直接登录");
    }
    const passwordHash = await hash(input.password, 12);
    const user = await this.prisma.$transaction(async (tx) => {
      const created = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: {
              passwordHash,
              status: UserStatus.ACTIVE,
              nickname: input.nickname?.trim() || `用户${mobile.slice(-4)}`,
            },
          })
        : await tx.user.create({
            data: {
              mobile,
              passwordHash,
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

  async login(mobileInput: string, password: string): Promise<SessionContract> {
    const mobile = normalizedMobile(mobileInput);
    if (!mobile || !password) throw new UnauthorizedException("账号或密码错误");
    const user = await this.prisma.user.findUnique({ where: { mobile } });
    if (
      !user?.passwordHash ||
      user.status !== UserStatus.ACTIVE ||
      !(await compare(password, user.passwordHash))
    ) {
      throw new UnauthorizedException("账号或密码错误");
    }
    if (!user.passwordHash.startsWith("$2b$12$")) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hash(password, 12) },
      });
    }
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
    const mobile = normalizedMobile(mobileInput);
    const usage = usageInput.trim() || "register";
    if (!mobile) throw new BadRequestException("手机号格式不正确");
    if (!["register", "reset_password"].includes(usage)) {
      throw new BadRequestException("验证码用途不正确");
    }
    const recent = await this.prisma.smsCode.count({
      where: { mobile, createdAt: { gt: new Date(Date.now() - 60_000) } },
    });
    if (recent > 0) throw new BadRequestException("请稍后再获取验证码");
    const testMode = envBoolean("ALLOW_TEST_OTP");
    if (!testMode && env("SMS_PROVIDER", "disabled") === "disabled") {
      throw new ServiceUnavailableException("短信服务暂时无法使用，请稍后再试");
    }
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
    return this.register(input);
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

  private async issueSession(userId: string): Promise<SessionContract> {
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
        issuer: "saydianapp-server",
        audience: "saydian-app",
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
  }): MemberProfileContract {
    const mobileMasked = maskMobile(user.mobile);
    return {
      id: user.id,
      ...(user.legacyMemberId ? { legacyMemberId: user.legacyMemberId } : {}),
      ...(mobileMasked ? { mobileMasked } : {}),
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

  private async consumeSms(
    mobileInput: string,
    code: string,
    usage: string,
  ): Promise<void> {
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
