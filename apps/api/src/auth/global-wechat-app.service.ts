import { Injectable } from "@nestjs/common";
import { IntegrationState, Prisma, UserStatus } from "@prisma/client";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { businessWritesPaused } from "@saydian/app-contracts";
import { PrismaService } from "../common/prisma.service";
import { IntegrationSecretsService } from "../common/integration-secrets.service";
import { env } from "../common/environment";
import { isUuid, safeObject, secureEqual, sha256 } from "../common/crypto";

import { AuthService } from "./auth.service";
import { GlobalVerificationDeliveryService } from "./global-verification-delivery.service";
import {
  globalError,
  globalIdentity,
  globalLocale,
  maskedIdentifier,
} from "./global-identity";
import {
  defaultGlobalLegalProduct,
  globalConsentSource,
  globalLegalBundle,
  recordSayRingMinimumAgeConsent,
  sayRingMinimumAgeConsent,
} from "./global-legal";
import { WechatAppAuthService } from "./wechat-app-auth.service";
import {
  safeWechatProfile,
  signWechatProfile,
  verifiedWechatProfile,
  wechatProfileBackfill,
} from "./wechat-h5-profile";

const bindingPurpose = "wechat_bind";
const ticketLifetimeMs = 5 * 60_000;

type AppTicket = {
  tokenHash: string;
  appId: string;
  product: string;
  openId: string;
  unionId: string | null;
  expiresAt: Date;
  consumedAt: Date | null;
};

@Injectable()
export class GlobalWechatAppService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly delivery: GlobalVerificationDeliveryService,
    private readonly wechat: WechatAppAuthService,
    private readonly integrationSecrets: IntegrationSecretsService,
  ) {}

  async capability(options: {
    legalReady: boolean;
    deliveryOpen: boolean;
    smsReady: boolean;
  }) {
    if (!options.legalReady || !options.deliveryOpen) {
      return {
        enabled: false,
        appId: null,
        phoneBindingAvailable: false,
      };
    }
    const appId = await this.configuredAppId().catch(() => null);
    return {
      enabled: Boolean(appId),
      appId,
      phoneBindingAvailable: Boolean(appId) && options.smsReady,
    };
  }

  async login(input: unknown) {
    this.requireAvailable();
    const body = safeObject(input);
    if (body.consentAccepted !== true) {
      throw globalError(
        400,
        "consent_required",
        "Read and agree to the terms and privacy policy.",
      );
    }
    const legal = await this.legal(
      body.consentVersion,
      body.locale,
      body.product,
    );
    const identity = await this.wechat.exchange({
      code: String(body.code ?? ""),
      state: String(body.state ?? ""),
      platform: String(body.platform ?? ""),
    });
    const linked = await this.prisma.wechatOfficialIdentity.findUnique({
      where: {
        appId_openId: { appId: identity.appId, openId: identity.openId },
      },
      include: { user: true },
    });
    const profile = safeWechatProfile({
      nickname: identity.nickname,
      avatarUrl: identity.avatarUrl,
    });
    if (linked?.user) {
      if (linked.user.status !== UserStatus.ACTIVE) throw inactive();
      if (linked.user.mobileVerifiedAt) {
        const userId = await this.prisma
          .$transaction(async (tx) => {
            await this.currentConfiguration(tx, identity.appId);
            await lockUser(tx, linked.userId);
            await lockIdentity(tx, identity.appId, identity.openId);
            const current = await tx.wechatOfficialIdentity.findUnique({
              where: {
                appId_openId: {
                  appId: identity.appId,
                  openId: identity.openId,
                },
              },
              include: { user: true },
            });
            if (
              !current?.user ||
              current.userId !== linked.userId ||
              current.user.status !== UserStatus.ACTIVE ||
              !current.user.mobileVerifiedAt
            ) {
              throw inactive();
            }
            await tx.user.update({
              where: { id: current.userId },
              data: {
                wechatAppOpenId: identity.openId,
                ...(identity.unionId
                  ? { wechatUnionId: identity.unionId }
                  : {}),
                ...wechatProfileBackfill(current.user, profile),
              },
            });
            await recordConsent(tx, current.userId, legal);
            return current.userId;
          })
          .catch(identityConflict);
        return this.auth.issueSession(userId);
      }
    }
    const token = randomBytes(32).toString("hex");
    await this.prisma.commerceWechatBindTicket.create({
      data: {
        tokenHash: sha256(token),
        appId: identity.appId,
        product: legal.product,
        openId: identity.openId,
        unionId: identity.unionId,
        returnTo: "/",
        expiresAt: new Date(Date.now() + ticketLifetimeMs),
      },
    });
    return {
      requiresPhoneBinding: true as const,
      bindTicket: token,
      expiresIn: ticketLifetimeMs / 1000,
      wechatProfile: profile,
      wechatProfileProof: signWechatProfile(profile, token),
    };
  }

  async requestPhoneCode(input: unknown) {
    this.requireAvailable();
    const body = safeObject(input);
    const ticket = await this.ticket(body.bindTicket);
    const identity = globalIdentity("sms", body.identifier);
    const locale = globalLocale(body.locale);
    const legal = await this.legal(body.consentVersion, locale, body.product);
    assertTicketProduct(ticket, legal.product);
    await this.delivery.assertAvailable("sms", identity.country);
    const id = randomUUID();
    const code = String(randomInt(100_000, 1_000_000));
    const now = new Date();
    const expiresAt = new Date(
      Math.min(ticket.expiresAt.valueOf(), now.valueOf() + ticketLifetimeMs),
    );
    await this.prisma.$transaction(async (tx) => {
      await this.currentConfiguration(tx, ticket.appId);
      await tx.$queryRaw`SELECT "tokenHash" FROM "CommerceWechatBindTicket" WHERE "tokenHash" = ${ticket.tokenHash} FOR UPDATE`;
      await this.ticket(body.bindTicket, tx);
      for (const key of [
        sha256(`sms:${identity.identifier}`),
        sha256(`wechat-app-bind-ticket:${ticket.tokenHash}`),
      ].sort()) {
        await tx.globalVerificationThrottle.upsert({
          where: { key },
          create: { key, reservedAt: new Date(0) },
          update: {},
        });
        const reserved = await tx.globalVerificationThrottle.updateMany({
          where: {
            key,
            reservedAt: { lte: new Date(now.valueOf() - 60_000) },
          },
          data: { reservedAt: now },
        });
        if (reserved.count !== 1) throw rateLimited();
      }
      const count = await tx.globalVerificationChallenge.count({
        where: {
          channel: "sms",
          identifier: identity.identifier,
          createdAt: { gt: new Date(now.valueOf() - 86_400_000) },
        },
      });
      if (count >= 10) throw rateLimited();
      await tx.globalVerificationChallenge.create({
        data: {
          id,
          channel: "sms",
          identifier: identity.identifier,
          purpose: bindingPurpose,
          locale,
          codeHash: bindingHash(id, code, ticket.tokenHash),
          expiresAt,
        },
      });
    });
    try {
      await this.delivery.send({
        ...identity,
        code,
        purpose: bindingPurpose,
        locale,
        challengeId: id,
      });
      await this.prisma.globalVerificationChallenge.update({
        where: { id },
        data: { sentAt: new Date() },
      });
    } catch (error) {
      await this.prisma.globalVerificationChallenge.update({
        where: { id },
        data: { consumedAt: new Date() },
      });
      throw error;
    }
    return {
      challengeId: id,
      expiresIn: Math.max(
        1,
        Math.floor((expiresAt.valueOf() - now.valueOf()) / 1000),
      ),
      retryAfter: 60,
      maskedIdentifier: maskedIdentifier("sms", identity.identifier),
    };
  }

  async bindPhone(input: unknown) {
    this.requireAvailable();
    const body = safeObject(input);
    const ticket = await this.ticket(body.bindTicket);
    const challengeId = String(body.challengeId ?? "");
    const code = String(body.code ?? "");
    if (!isUuid(challengeId) || !/^\d{6}$/.test(code)) throw invalidCode();
    const result = await this.prisma
      .$transaction(
        async (tx) => {
          await this.currentConfiguration(tx, ticket.appId);
          await tx.$queryRaw`SELECT id FROM "GlobalVerificationChallenge" WHERE id = ${challengeId}::uuid FOR UPDATE`;
          const challenge = await tx.globalVerificationChallenge.findUnique({
            where: { id: challengeId },
          });
          if (
            !challenge ||
            challenge.channel !== "sms" ||
            challenge.purpose !== bindingPurpose ||
            !challenge.sentAt ||
            challenge.consumedAt ||
            challenge.attempts >= 5 ||
            challenge.expiresAt <= new Date()
          ) {
            return { invalid: true as const };
          }
          if (
            !secureEqual(
              challenge.codeHash,
              bindingHash(challengeId, code, ticket.tokenHash),
            )
          ) {
            await tx.globalVerificationChallenge.updateMany({
              where: { id: challengeId, consumedAt: null, attempts: { lt: 5 } },
              data: { attempts: { increment: 1 } },
            });
            return { invalid: true as const };
          }
          const identity = globalIdentity("sms", challenge.identifier);
          await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`global-wechat-app-phone:${identity.identifier}`}, 0))`;
          await lockIdentity(tx, ticket.appId, ticket.openId);
          const [linked, unionLinked, byPhone, byOpenId, byUnionId] =
            await Promise.all([
              tx.wechatOfficialIdentity.findUnique({
                where: {
                  appId_openId: { appId: ticket.appId, openId: ticket.openId },
                },
              }),
              ticket.unionId
                ? tx.wechatOfficialIdentity.findFirst({
                    where: { unionId: ticket.unionId },
                  })
                : null,
              tx.user.findUnique({ where: { mobile: identity.identifier } }),
              tx.user.findUnique({ where: { wechatAppOpenId: ticket.openId } }),
              ticket.unionId
                ? tx.user.findUnique({
                    where: { wechatUnionId: ticket.unionId },
                  })
                : null,
            ]);
          const ownerIds = new Set(
            [
              linked?.userId,
              unionLinked?.userId,
              byOpenId?.id,
              byUnionId?.id,
            ].filter((value): value is string => Boolean(value)),
          );
          if (ownerIds.size > 1) throw conflict();
          const ownerId = ownerIds.values().next().value as string | undefined;
          if (ownerId && byPhone && byPhone.id !== ownerId) throw conflict();
          let user = ownerId
            ? await tx.user.findUnique({ where: { id: ownerId } })
            : byPhone;
          if (user) {
            await lockUser(tx, user.id);
            user = await tx.user.findUnique({ where: { id: user.id } });
            if (!user || user.status !== UserStatus.ACTIVE) throw inactive();
            if (user.mobile && user.mobile !== identity.identifier)
              throw conflict();
            if (
              user.wechatAppOpenId &&
              user.wechatAppOpenId !== ticket.openId
            ) {
              throw conflict();
            }
            if (
              user.wechatUnionId &&
              ticket.unionId &&
              user.wechatUnionId !== ticket.unionId
            ) {
              throw conflict();
            }
          }
          const legal = await this.legal(
            body.consentVersion,
            body.locale ?? challenge.locale,
            body.product,
            tx,
          );
          assertTicketProduct(ticket, legal.product);
          const ageConsent = !user
            ? sayRingMinimumAgeConsent(legal.product, body.ageConfirmed)
            : null;
          const consumed = await tx.globalVerificationChallenge.updateMany({
            where: {
              id: challengeId,
              consumedAt: null,
              attempts: { lt: 5 },
              sentAt: { not: null },
              expiresAt: { gt: new Date() },
            },
            data: { consumedAt: new Date() },
          });
          if (consumed.count !== 1) return { invalid: true as const };
          if (user && !user.mobileVerifiedAt) {
            await tx.userSession.updateMany({
              where: { userId: user.id, revokedAt: null },
              data: { revokedAt: new Date() },
            });
          }
          const profile = verifiedWechatProfile(
            body.wechatProfileProof,
            String(body.bindTicket ?? ""),
          );
          const userData = {
            mobile: identity.identifier,
            mobileVerifiedAt: new Date(),
            wechatAppOpenId: ticket.openId,
            ...(ticket.unionId ? { wechatUnionId: ticket.unionId } : {}),
          };
          const saved = user
            ? await tx.user.update({
                where: { id: user.id },
                data: { ...userData, ...wechatProfileBackfill(user, profile) },
              })
            : await tx.user.create({
                data: {
                  ...userData,
                  passwordHash: null,
                  nickname: profile.nickname || "Saydian user",
                  ...(profile.avatarUrl
                    ? { avatarUrl: profile.avatarUrl }
                    : {}),
                  locale: globalLocale(body.locale ?? challenge.locale),
                },
              });
          const claimed = await tx.commerceWechatBindTicket.updateMany({
            where: {
              tokenHash: ticket.tokenHash,
              appId: ticket.appId,
              consumedAt: null,
              expiresAt: { gt: new Date() },
            },
            data: { consumedAt: new Date() },
          });
          if (claimed.count !== 1) throw invalidTicket();
          if (!linked) {
            await tx.wechatOfficialIdentity.create({
              data: {
                userId: saved.id,
                appId: ticket.appId,
                openId: ticket.openId,
                unionId: ticket.unionId,
                verifiedAt: new Date(),
              },
            });
          } else if (linked.userId !== saved.id) {
            throw conflict();
          }
          await recordConsent(tx, saved.id, legal);
          await recordSayRingMinimumAgeConsent(
            tx,
            saved.id,
            ageConsent,
            globalConsentSource("global_app_wechat", legal),
          );
          return { invalid: false as const, userId: saved.id };
        },
        { maxWait: 10_000, timeout: 30_000 },
      )
      .catch(identityConflict);
    if (result.invalid) throw invalidCode();
    return this.auth.issueSession(result.userId);
  }

  private requireAvailable() {
    if (businessWritesPaused(process.env)) {
      throw globalError(
        503,
        "social_login_unavailable",
        "Sign-in is temporarily unavailable during maintenance.",
      );
    }
  }

  private async legal(
    version: unknown,
    locale: unknown,
    product: unknown,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const document = await globalLegalBundle(db, locale, product);
    if (!document) {
      throw globalError(
        503,
        "legal_unavailable",
        "The terms and privacy policy are not available yet.",
      );
    }
    if (typeof version !== "string" || !version.trim()) {
      throw globalError(
        400,
        "consent_required",
        "Read and agree to the terms and privacy policy.",
      );
    }
    if (document.consentVersion !== version) {
      throw globalError(
        409,
        "consent_outdated",
        "The terms have changed. Read and agree to the latest version.",
      );
    }
    return document;
  }

  private async configuredAppId() {
    const integration = await this.prisma.integrationConfig.findUnique({
      where: { key: "wechat_login" },
      select: { state: true, publicConfig: true },
    });
    if (integration?.state !== IntegrationState.CONFIGURED) return null;
    const publicConfig = safeObject(integration.publicConfig);
    const secrets = await this.integrationSecrets.resolve("wechat_login", {
      appId: "WECHAT_LOGIN_APP_ID",
      appSecret: "WECHAT_LOGIN_APP_SECRET",
    });
    const appId = String(secrets.appId ?? publicConfig.appId ?? "").trim();
    const appSecret = String(secrets.appSecret ?? "").trim();
    return /^wx[A-Za-z0-9]{8,64}$/.test(appId) && appSecret.length >= 16
      ? appId
      : null;
  }

  private async currentConfiguration(
    tx: Prisma.TransactionClient,
    expectedAppId: string,
  ) {
    await tx.$queryRaw`SELECT id FROM "IntegrationConfig" WHERE key = 'wechat_login' FOR SHARE`;
    const integration = await tx.integrationConfig.findUnique({
      where: { key: "wechat_login" },
      select: { state: true },
    });
    if (
      integration?.state !== IntegrationState.CONFIGURED ||
      (await this.configuredAppId()) !== expectedAppId
    ) {
      throw globalError(
        503,
        "social_login_unavailable",
        "WeChat sign-in is unavailable.",
      );
    }
  }

  private async ticket(
    value: unknown,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<AppTicket> {
    if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
      throw invalidTicket();
    }
    const row = await db.commerceWechatBindTicket.findUnique({
      where: { tokenHash: sha256(value) },
    });
    if (!row || row.consumedAt || row.expiresAt <= new Date()) {
      throw invalidTicket();
    }
    const configured = await this.configuredAppId();
    if (!configured || row.appId !== configured) throw invalidTicket();
    return { ...row, product: row.product || defaultGlobalLegalProduct };
  }
}

async function lockUser(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
}

async function lockIdentity(
  tx: Prisma.TransactionClient,
  appId: string,
  openId: string,
) {
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`wechat-app-openid:${appId}:${openId}`}, 0))`;
}

async function recordConsent(
  tx: Prisma.TransactionClient,
  userId: string,
  legal: NonNullable<Awaited<ReturnType<typeof globalLegalBundle>>>,
) {
  const source = globalConsentSource("global_app_wechat", legal);
  for (const documentType of Object.values(legal.documentTypes)) {
    await tx.consentRecord.upsert({
      where: {
        userId_documentType_version: {
          userId,
          documentType,
          version: legal.consentVersion,
        },
      },
      create: {
        userId,
        documentType,
        version: legal.consentVersion,
        source,
      },
      update: { withdrawnAt: null, source },
    });
  }
}

function bindingHash(id: string, code: string, ticketHash: string) {
  return sha256(
    `global:${id}:${code}:${env("REFRESH_TOKEN_PEPPER")}:wechat-app-bind:${ticketHash}`,
  );
}

function invalidTicket() {
  return globalError(
    401,
    "wechat_binding_expired",
    "WeChat authorization has expired. Authorize again.",
  );
}

function invalidCode() {
  return globalError(
    400,
    "verification_invalid",
    "The verification code is incorrect or has expired.",
  );
}

function inactive() {
  return globalError(
    409,
    "account_unavailable",
    "This account cannot sign in. Contact support.",
  );
}

function conflict() {
  return globalError(
    409,
    "identity_conflict",
    "These identities belong to different accounts. They will not be merged automatically.",
  );
}

function rateLimited() {
  return globalError(
    429,
    "verification_rate_limited",
    "Wait before requesting another code.",
  );
}

function identityConflict(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    throw conflict();
  }
  throw error;
}

function assertTicketProduct(ticket: AppTicket, product: string) {
  if (ticket.product !== product) {
    throw globalError(
      409,
      "product_mismatch",
      "Continue with the same product.",
    );
  }
}
