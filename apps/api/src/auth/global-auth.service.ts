import { Injectable } from "@nestjs/common";
import { Prisma, UserStatus } from "@prisma/client";
import { hash } from "bcryptjs";
import { randomInt, randomUUID } from "node:crypto";
import { PrismaService } from "../common/prisma.service";
import { env, envBoolean } from "../common/environment";
import { isUuid, safeObject, secureEqual, sha256 } from "../common/crypto";
import { isGlobalRealm } from "../common/deployment-realm";
import { AuthService } from "./auth.service";
import { GlobalVerificationDeliveryService } from "./global-verification-delivery.service";
import { globalError, globalIdentity, globalLocale, globalLocales, maskedIdentifier, type VerificationPurpose } from "./global-identity";
import { globalLegalBundle } from "./global-legal";
import { businessWritesPaused } from "@saydian/app-contracts";

@Injectable()
export class GlobalAuthService {
  constructor(private readonly prisma: PrismaService, private readonly delivery: GlobalVerificationDeliveryService, private readonly auth: AuthService) {}

  async capabilities(locale?: string) {
    this.requireGlobal();
    const ready = await this.delivery.capabilities();
    const legal = await globalLegalBundle(this.prisma, locale);
    const deliveryOpen = !businessWritesPaused(process.env);
    const unverifiedRegistration = this.unverifiedRegistrationEnabled();
    const registrationOpen = Boolean(legal) && deliveryOpen;
    return {
      realm: "global",
      defaultLocale: "en",
      supportedLocales: [...globalLocales],
      registration: {
        email: registrationOpen && (unverifiedRegistration || ready.email),
        sms: registrationOpen && (unverifiedRegistration || ready.sms),
        verificationRequired: !unverifiedRegistration,
      },
      recovery: { email: ready.email && deliveryOpen, sms: ready.sms && deliveryOpen },
      smsCountries: ready.smsCountries,
      verification: { codeLength: 6, expiresIn: 300, retryAfter: 60 },
      consentVersion: legal?.consentVersion ?? null,
      legal: legal?.documents ?? null,
    };
  }

  async requestCode(input: unknown) {
    this.requireGlobal();
    const body = safeObject(input);
    const identity = globalIdentity(body.channel, body.identifier);
    const purpose = String(body.purpose ?? "register") as VerificationPurpose;
    if (!["register", "reset_password"].includes(purpose)) throw globalError(400, "invalid_verification_purpose", "Choose a valid verification purpose.");
    const locale = globalLocale(body.locale);
    if (purpose === "register" && !(await globalLegalBundle(this.prisma, locale))) throw globalError(503, "legal_unavailable", "The terms and privacy policy are not available yet. Please try again later.");
    await this.delivery.assertAvailable(identity.channel, identity.country);
    const challengeId = randomUUID();
    const now = new Date();
    const code = String(randomInt(100_000, 1_000_000));
    const key = sha256(`${identity.channel}:${identity.identifier}`);
    await this.prisma.$transaction(async tx => {
      await tx.globalVerificationThrottle.upsert({ where: { key }, create: { key, reservedAt: new Date(0) }, update: {} });
      const reserved = await tx.globalVerificationThrottle.updateMany({ where: { key, reservedAt: { lte: new Date(now.valueOf() - 60_000) } }, data: { reservedAt: now } });
      if (reserved.count !== 1) throw globalError(429, "verification_rate_limited", "Please wait before requesting another code.");
      const daily = await tx.globalVerificationChallenge.count({ where: { channel: identity.channel, identifier: identity.identifier, createdAt: { gt: new Date(now.valueOf() - 86_400_000) } } });
      if (daily >= 10) throw globalError(429, "verification_rate_limited", "Too many verification requests. Please try again later.");
      await tx.globalVerificationChallenge.create({ data: { id: challengeId, channel: identity.channel, identifier: identity.identifier, purpose, locale, codeHash: this.codeHash(challengeId, code), expiresAt: new Date(now.valueOf() + 300_000) } });
    });
    try {
      await this.delivery.send({ ...identity, code, purpose, locale, challengeId });
      await this.prisma.globalVerificationChallenge.update({ where: { id: challengeId }, data: { sentAt: new Date() } });
    } catch (error) {
      await this.prisma.globalVerificationChallenge.update({ where: { id: challengeId }, data: { consumedAt: new Date() } });
      throw error;
    }
    return { challengeId, expiresIn: 300, retryAfter: 60, maskedIdentifier: maskedIdentifier(identity.channel, identity.identifier) };
  }

  async register(input: unknown) {
    this.requireGlobal();
    const body = safeObject(input);
    const password = this.password(body.password);
    const consentVersion = String(body.consentVersion ?? "").trim();
    if (!consentVersion || consentVersion.length > 80) throw globalError(400, "consent_required", "Read and agree to the terms and privacy policy.");
    const legal = await globalLegalBundle(this.prisma, body.locale);
    if (!legal) throw globalError(503, "legal_unavailable", "The terms and privacy policy are not available yet. Please try again later.");
    if (legal.consentVersion !== consentVersion) throw globalError(409, "consent_outdated", "The terms have changed. Please read and agree to the latest version.");
    const nickname = String(body.nickname ?? "").trim();
    if (nickname.length > 40) throw globalError(400, "invalid_nickname", "Your name must be no longer than 40 characters.");
    const passwordHash = await hash(password, 12);
    let userId: string;
    try {
      userId = await this.consume(body.challengeId, body.code, "register", async (tx, challenge) => {
        const where = challenge.channel === "email" ? { email: challenge.identifier } : { mobile: challenge.identifier };
        if (await tx.user.findUnique({ where })) throw globalError(409, "account_exists", "This account already exists. Please sign in.");
        const user = await tx.user.create({ data: {
          ...(challenge.channel === "email" ? { email: challenge.identifier, emailVerifiedAt: new Date() } : { mobile: challenge.identifier, mobileVerifiedAt: new Date() }),
          passwordHash, nickname: nickname || "Saydian user", locale: globalLocale(body.locale ?? challenge.locale),
        } });
        for (const documentType of ["user_agreement", "privacy_policy"]) {
          await tx.consentRecord.create({ data: { userId: user.id, documentType, version: consentVersion, source: `global_app_v2:${legal.locale}` } });
        }
        return user.id;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw globalError(409, "account_exists", "This account already exists. Please sign in.");
      throw error;
    }
    return this.auth.issueSession(userId);
  }

  async registerWithoutVerification(input: unknown) {
    this.requireGlobal();
    if (!this.unverifiedRegistrationEnabled() || businessWritesPaused(process.env)) {
      throw globalError(503, "registration_unavailable", "Registration is temporarily unavailable. Please try again later.");
    }
    const body = safeObject(input);
    const identifier = body.identifier ?? body.email ?? body.mobile ?? body.username;
    const identity = globalIdentity(body.channel ?? (String(identifier ?? "").includes("@") ? "email" : "sms"), identifier);
    const password = this.password(body.password);
    const consentVersion = String(body.consentVersion ?? "").trim();
    if (!consentVersion || consentVersion.length > 80) {
      throw globalError(400, "consent_required", "Read and agree to the terms and privacy policy.");
    }
    const legal = await globalLegalBundle(this.prisma, body.locale);
    if (!legal) {
      throw globalError(503, "legal_unavailable", "The terms and privacy policy are not available yet. Please try again later.");
    }
    if (legal.consentVersion !== consentVersion) {
      throw globalError(409, "consent_outdated", "The terms have changed. Please read and agree to the latest version.");
    }
    const nickname = String(body.nickname ?? "").trim();
    if (nickname.length > 40) {
      throw globalError(400, "invalid_nickname", "Your name must be no longer than 40 characters.");
    }
    const passwordHash = await hash(password, 12);
    let userId: string;
    try {
      userId = await this.prisma.$transaction(async tx => {
        const where = identity.channel === "email" ? { email: identity.identifier } : { mobile: identity.identifier };
        if (await tx.user.findUnique({ where })) {
          throw globalError(409, "account_exists", "This account already exists. Please sign in.");
        }
        const user = await tx.user.create({ data: {
          ...(identity.channel === "email" ? { email: identity.identifier } : { mobile: identity.identifier }),
          passwordHash,
          nickname: nickname || "Saydian user",
          locale: globalLocale(body.locale),
        } });
        for (const documentType of ["user_agreement", "privacy_policy"]) {
          await tx.consentRecord.create({
            data: {
              userId: user.id,
              documentType,
              version: consentVersion,
              source: `global_app_v2_unverified:${legal.locale}`,
            },
          });
        }
        return user.id;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw globalError(409, "account_exists", "This account already exists. Please sign in.");
      }
      throw error;
    }
    return this.auth.issueSession(userId);
  }

  async login(input: unknown) {
    this.requireGlobal();
    const body = safeObject(input);
    const identifier = String(body.identifier ?? body.mobile ?? body.username ?? "");
    const identity = globalIdentity(body.channel ?? (identifier.includes("@") ? "email" : "sms"), identifier);
    return this.auth.login(identity.identifier, this.password(body.password));
  }

  async resetPassword(input: unknown) {
    this.requireGlobal();
    const body = safeObject(input);
    const passwordHash = await hash(this.password(body.password ?? body.newPassword), 12);
    const userId = await this.consume(body.challengeId, body.code, "reset_password", async (tx, challenge) => {
      const user = await tx.user.findUnique({ where: challenge.channel === "email" ? { email: challenge.identifier } : { mobile: challenge.identifier } });
      if (!user || user.status !== UserStatus.ACTIVE) throw globalError(400, "account_unavailable", "This account cannot be reset. Please contact support.");
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await tx.userSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      return user.id;
    });
    return this.auth.issueSession(userId);
  }

  private async consume<T>(idInput: unknown, codeInput: unknown, purpose: VerificationPurpose, operation: (tx: Prisma.TransactionClient, challenge: { channel: string; identifier: string; locale: string }) => Promise<T>): Promise<T> {
    const id = String(idInput ?? "");
    const code = String(codeInput ?? "");
    if (!isUuid(id) || !/^\d{6}$/.test(code)) throw this.invalidCode();
    const result = await this.prisma.$transaction(async tx => {
      const challenge = await tx.globalVerificationChallenge.findUnique({ where: { id } });
      if (!challenge || challenge.purpose !== purpose || !challenge.sentAt || challenge.consumedAt || challenge.expiresAt <= new Date() || challenge.attempts >= 5) return { invalid: true as const };
      if (!secureEqual(challenge.codeHash, this.codeHash(id, code))) {
        await tx.globalVerificationChallenge.updateMany({ where: { id, attempts: { lt: 5 }, consumedAt: null }, data: { attempts: { increment: 1 } } });
        return { invalid: true as const };
      }
      const claimed = await tx.globalVerificationChallenge.updateMany({ where: { id, consumedAt: null, attempts: { lt: 5 }, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
      if (claimed.count !== 1) return { invalid: true as const };
      return { invalid: false as const, value: await operation(tx, challenge) };
    });
    if (result.invalid) throw this.invalidCode();
    return result.value;
  }

  private codeHash(id: string, code: string) { return sha256(`global:${id}:${code}:${env("REFRESH_TOKEN_PEPPER")}`); }
  private unverifiedRegistrationEnabled() { return envBoolean("GLOBAL_UNVERIFIED_REGISTRATION_ENABLED"); }
  private invalidCode() { return globalError(400, "verification_invalid", "The verification code is incorrect or has expired."); }
  private password(value: unknown) {
    const result = String(value ?? "");
    if (result.length < 8 || Buffer.byteLength(result, "utf8") > 72) throw globalError(400, "invalid_password", "Use a password of at least 8 characters and at most 72 UTF-8 bytes.");
    return result;
  }
  private requireGlobal() {
    if (!isGlobalRealm()) throw globalError(404, "not_found", "This feature is unavailable.");
  }
}
