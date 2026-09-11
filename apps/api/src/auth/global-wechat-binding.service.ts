import { Injectable } from "@nestjs/common";
import { Prisma, UserStatus } from "@prisma/client";
import { compare, hash } from "bcryptjs";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { AuthService } from "./auth.service";
import { GlobalVerificationDeliveryService } from "./global-verification-delivery.service";
import { PrismaService } from "../common/prisma.service";
import { env } from "../common/environment";
import { isUuid, safeObject, secureEqual, sha256 } from "../common/crypto";
import { globalError, globalIdentity, globalLocale, maskedIdentifier } from "./global-identity";
import { globalLegalBundle } from "./global-legal";
import { globalWechatPhoneTestEnabled, requireGlobalWechatH5, requireGlobalWechatPhoneTest } from "./global-wechat-policy";

const purpose = "wechat_bind";
const phoneTestPurpose = "wechat_phone_test";
type Ticket = { tokenHash: string; appId: string; openId: string; unionId: string | null; expiresAt: Date; consumedAt: Date | null; returnTo: string };

@Injectable()
export class GlobalWechatBindingService {
  constructor(private readonly prisma: PrismaService, private readonly auth: AuthService, private readonly delivery: GlobalVerificationDeliveryService) {}

  capabilities() { return this.delivery.capabilities(); }

  async legal(version: unknown, locale: unknown, db: Prisma.TransactionClient = this.prisma) {
    const document = await globalLegalBundle(db, locale);
    if (!document) throw globalError(503, "legal_unavailable", "The terms and privacy policy are not available yet.");
    if (typeof version !== "string" || !version.trim()) throw globalError(400, "consent_required", "Read and agree to the terms and privacy policy.");
    if (document.consentVersion !== version) throw globalError(409, "consent_outdated", "The terms have changed. Read and agree to the latest version.");
    return document;
  }

  async linkedUser(appId: string, openId: string, version: string, locale: unknown) {
    requireGlobalWechatH5();
    const initial = await this.prisma.wechatOfficialIdentity.findUnique({ where: { appId_openId: { appId, openId } } });
    if (!initial) return null;
    return this.prisma.$transaction(async tx => {
      await this.currentConfiguration(tx);
      await lockUser(tx, initial.userId);
      await lockIdentity(tx, appId, openId);
      const current = await tx.wechatOfficialIdentity.findUnique({ where: { appId_openId: { appId, openId } } });
      if (!current || current.userId !== initial.userId) throw invalidTicket();
      await tx.$queryRaw`SELECT id FROM "WechatOfficialIdentity" WHERE id = ${current.id}::uuid FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: current.userId } });
      if (!user || user.status !== UserStatus.ACTIVE) throw inactive();
      if (!user.mobileVerifiedAt && !(globalWechatPhoneTestEnabled() && user.mobile)) return null;
      const legal = await this.legal(version, locale, tx);
      await recordConsent(tx, user.id, legal.consentVersion, legal.locale);
      return user.id;
    });
  }

  async bindAccount(appId: string, input: unknown) {
    requireGlobalWechatH5();
    const body = safeObject(input);
    const ticket = await this.ticket(body.bindTicket, appId);
    const identifier = String(body.identifier ?? "");
    const identity = globalIdentity(identifier.includes("@") ? "email" : "sms", identifier);
    const secret = password(body.password);
    const where = identity.channel === "email" ? { email: identity.identifier } : { mobile: identity.identifier };
    const candidate = await this.prisma.user.findUnique({ where });
    if (!candidate?.passwordHash || candidate.status !== UserStatus.ACTIVE || !await compare(secret, candidate.passwordHash)) {
      throw globalError(401, "invalid_credentials", "The account or password is incorrect.");
    }
    if (!candidate.emailVerifiedAt && !candidate.mobileVerifiedAt) throw verificationRequired();
    const userId = await this.prisma.$transaction(async tx => {
      await this.currentConfiguration(tx);
      await lockUser(tx, candidate.id);
      const current = await tx.user.findUnique({ where: { id: candidate.id } });
      if (!current || current.status !== UserStatus.ACTIVE || current.passwordHash !== candidate.passwordHash) throw inactive();
      if (!current.emailVerifiedAt && !current.mobileVerifiedAt) throw verificationRequired();
      await lockIdentity(tx, appId, ticket.openId);
      const legal = await this.legal(body.consentVersion, body.locale, tx);
      await this.attach(tx, ticket, current.id);
      await recordConsent(tx, current.id, legal.consentVersion, legal.locale);
      return current.id;
    }).catch(identityConflict);
    return this.session(userId, ticket.returnTo, appId);
  }

  async requestCode(appId: string, input: unknown) {
    requireGlobalWechatH5();
    const body = safeObject(input);
    if (body.purpose !== undefined && body.purpose !== purpose) throw globalError(400, "invalid_verification_purpose", "This endpoint only verifies WeChat account binding.");
    const ticket = await this.ticket(body.bindTicket, appId);
    const identity = globalIdentity(body.channel, body.identifier);
    const locale = globalLocale(body.locale);
    if (!await globalLegalBundle(this.prisma, locale)) throw globalError(503, "legal_unavailable", "The terms and privacy policy are not available yet.");
    await this.delivery.assertAvailable(identity.channel, identity.country);
    const id = randomUUID(), code = String(randomInt(100_000, 1_000_000)), now = new Date();
    const expiresAt = new Date(Math.min(ticket.expiresAt.valueOf(), now.valueOf() + 300_000));
    await this.prisma.$transaction(async tx => {
      await this.currentConfiguration(tx);
      await tx.$queryRaw`SELECT "tokenHash" FROM "CommerceWechatBindTicket" WHERE "tokenHash" = ${ticket.tokenHash} FOR UPDATE`;
      await this.ticket(body.bindTicket, appId, tx);
      // The identifier budget is shared with registration/recovery; a binding
      // ticket also has its own one-per-minute budget across all identifiers.
      const keys = [sha256(`${identity.channel}:${identity.identifier}`), sha256(`wechat-bind-ticket:${ticket.tokenHash}`)].sort();
      for (const key of keys) {
        await tx.globalVerificationThrottle.upsert({ where: { key }, create: { key, reservedAt: new Date(0) }, update: {} });
        const reserved = await tx.globalVerificationThrottle.updateMany({ where: { key, reservedAt: { lte: new Date(now.valueOf() - 60_000) } }, data: { reservedAt: now } });
        if (reserved.count !== 1) throw globalError(429, "verification_rate_limited", "Wait before requesting another code.");
      }
      const count = await tx.globalVerificationChallenge.count({ where: { channel: identity.channel, identifier: identity.identifier, createdAt: { gt: new Date(now.valueOf() - 86_400_000) } } });
      if (count >= 10) throw globalError(429, "verification_rate_limited", "Too many verification requests. Try again later.");
      await tx.globalVerificationChallenge.create({ data: { id, channel: identity.channel, identifier: identity.identifier, purpose, locale, codeHash: bindingHash(id, code, ticket.tokenHash), expiresAt } });
    });
    try {
      await this.delivery.send({ ...identity, code, purpose, locale, challengeId: id });
      await this.prisma.globalVerificationChallenge.update({ where: { id }, data: { sentAt: new Date() } });
    } catch (error) {
      await this.prisma.globalVerificationChallenge.update({ where: { id }, data: { consumedAt: new Date() } });
      throw error;
    }
    return { challengeId: id, expiresIn: Math.max(1, Math.floor((expiresAt.valueOf() - now.valueOf()) / 1000)), retryAfter: 60, maskedIdentifier: maskedIdentifier(identity.channel, identity.identifier) };
  }

  async bindCode(appId: string, input: unknown) {
    requireGlobalWechatH5();
    const body = safeObject(input);
    const ticket = await this.ticket(body.bindTicket, appId);
    const challengeId = String(body.challengeId ?? ""), code = String(body.code ?? "");
    if (!isUuid(challengeId) || !/^\d{6}$/.test(code)) throw invalidCode();
    // Required uniformly so the API does not disclose whether an account
    // exists. Existing accounts keep their password and profile unchanged.
    const passwordHash = await hash(password(body.password), 12);
    const nickname = String(body.nickname ?? "").trim();
    if (nickname.length > 40) throw globalError(400, "invalid_nickname", "Your name must be no longer than 40 characters.");
    const result = await this.prisma.$transaction(async tx => {
      await this.currentConfiguration(tx);
      await tx.$queryRaw`SELECT id FROM "GlobalVerificationChallenge" WHERE id = ${challengeId}::uuid FOR UPDATE`;
      const challenge = await tx.globalVerificationChallenge.findUnique({ where: { id: challengeId } });
      if (!challenge || challenge.purpose !== purpose || !challenge.sentAt || challenge.consumedAt || challenge.attempts >= 5 || challenge.expiresAt <= new Date()) return { invalid: true as const };
      if (!secureEqual(challenge.codeHash, bindingHash(challengeId, code, ticket.tokenHash))) {
        await tx.globalVerificationChallenge.updateMany({ where: { id: challengeId, consumedAt: null, attempts: { lt: 5 } }, data: { attempts: { increment: 1 } } });
        return { invalid: true as const };
      }
      const identity = globalIdentity(challenge.channel, challenge.identifier);
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`global-wechat-account:${identity.channel}:${identity.identifier}`}, 0))`;
      const where = identity.channel === "email" ? { email: identity.identifier } : { mobile: identity.identifier };
      let user = await tx.user.findUnique({ where });
      if (user) {
        await lockUser(tx, user.id);
        user = await tx.user.findUnique({ where: { id: user.id } });
        if (!user || user.status !== UserStatus.ACTIVE) throw inactive();
        if (!user.passwordHash || !await compare(String(body.password), user.passwordHash)) {
          await tx.globalVerificationChallenge.updateMany({ where: { id: challengeId, consumedAt: null, attempts: { lt: 5 } }, data: { attempts: { increment: 1 } } });
          return { invalid: true as const, credentials: true as const };
        }
      }
      await lockIdentity(tx, appId, ticket.openId);
      const legal = await this.legal(body.consentVersion, body.locale ?? challenge.locale, tx);
      // Check conflicts before touching verified flags or creating a User.
      const linked = await tx.wechatOfficialIdentity.findUnique({ where: { appId_openId: { appId, openId: ticket.openId } } });
      if (linked && linked.userId !== user?.id) throw conflict();
      if (user) {
        const other = await tx.wechatOfficialIdentity.findUnique({ where: { userId_appId: { userId: user.id, appId } } });
        if (other && other.openId !== ticket.openId) throw conflict();
      }
      const claimed = await tx.globalVerificationChallenge.updateMany({ where: { id: challengeId, consumedAt: null, attempts: { lt: 5 }, sentAt: { not: null }, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
      if (claimed.count !== 1) return { invalid: true as const };
      // An unverified registration may have been preclaimed by another party.
      // Require both its old password and this OTP, then revoke pre-verification
      // sessions before granting verified access. Never reset an old password.
      if (user && (identity.channel === "email" ? !user.emailVerifiedAt : !user.mobileVerifiedAt)) {
        await tx.userSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      const verified = identity.channel === "email" ? { emailVerifiedAt: new Date() } : { mobileVerifiedAt: new Date() };
      const saved = user ? await tx.user.update({ where: { id: user.id }, data: verified })
        : await tx.user.create({ data: { ...where, ...verified, passwordHash, nickname: nickname || "Saydian user", locale: globalLocale(body.locale ?? challenge.locale) } });
      await this.attach(tx, ticket, saved.id);
      await recordConsent(tx, saved.id, legal.consentVersion, legal.locale);
      return { invalid: false as const, userId: saved.id };
    }, { maxWait: 10_000, timeout: 30_000 }).catch(identityConflict);
    if (result.invalid) {
      if ("credentials" in result) throw globalError(401, "invalid_credentials", "Use this account's existing password. Verification codes do not reset passwords.");
      throw invalidCode();
    }
    return this.session(result.userId, ticket.returnTo, appId);
  }

  async requestPhoneCode(appId: string, input: unknown) {
    const body = safeObject(input);
    if (!globalWechatPhoneTestEnabled()) return { ...await this.requestCode(appId, { ...body, channel: "sms", purpose }), mode: "sms", sent: true, verificationRequired: true };
    requireGlobalWechatPhoneTest();
    const ticket = await this.ticket(body.bindTicket, appId), identity = globalIdentity("sms", body.identifier), locale = globalLocale(body.locale);
    if (!await globalLegalBundle(this.prisma, locale)) throw globalError(503, "legal_unavailable", "The terms and privacy policy are not available yet.");
    const id = randomUUID(), now = new Date(), expiresAt = new Date(Math.min(ticket.expiresAt.valueOf(), now.valueOf() + 300_000));
    await this.prisma.$transaction(async tx => {
      await this.currentConfiguration(tx); requireGlobalWechatPhoneTest();
      await tx.$queryRaw`SELECT "tokenHash" FROM "CommerceWechatBindTicket" WHERE "tokenHash" = ${ticket.tokenHash} FOR UPDATE`;
      await this.ticket(body.bindTicket, appId, tx);
      for (const key of [sha256(`sms:${identity.identifier}`), sha256(`wechat-bind-ticket:${ticket.tokenHash}`)].sort()) {
        await tx.globalVerificationThrottle.upsert({ where: { key }, create: { key, reservedAt: new Date(0) }, update: {} });
        if ((await tx.globalVerificationThrottle.updateMany({ where: { key, reservedAt: { lte: new Date(now.valueOf() - 60_000) } }, data: { reservedAt: now } })).count !== 1) throw globalError(429, "verification_rate_limited", "Wait before requesting another code.");
      }
      if (await tx.globalVerificationChallenge.count({ where: { channel: "sms", identifier: identity.identifier, createdAt: { gt: new Date(now.valueOf() - 86_400_000) } } }) >= 10) throw globalError(429, "verification_rate_limited", "Too many verification requests. Try again later.");
      await tx.globalVerificationChallenge.create({ data: { id, channel: "sms", identifier: identity.identifier, purpose: phoneTestPurpose, locale, codeHash: phoneTestHash(id, ticket.tokenHash), expiresAt } });
    });
    // This is explicitly not delivery or ownership verification. No sentAt,
    // provider call, provider verification record or real OTP is fabricated.
    return { challengeId: id, expiresIn: Math.max(1, Math.floor((expiresAt.valueOf() - now.valueOf()) / 1000)), retryAfter: 60, maskedIdentifier: maskedIdentifier("sms", identity.identifier), mode: "test", sent: false, verificationRequired: false };
  }

  async bindPhone(appId: string, input: unknown) {
    requireGlobalWechatH5();
    const body = safeObject(input), ticket = await this.ticket(body.bindTicket, appId);
    const challengeId = String(body.challengeId ?? ""), code = String(body.code ?? "");
    if (!isUuid(challengeId) || !/^\d{6}$/.test(code)) throw invalidCode();
    const result = await this.prisma.$transaction(async tx => {
      await this.currentConfiguration(tx);
      await tx.$queryRaw`SELECT id FROM "GlobalVerificationChallenge" WHERE id = ${challengeId}::uuid FOR UPDATE`;
      const challenge = await tx.globalVerificationChallenge.findUnique({ where: { id: challengeId } });
      if (!challenge || challenge.channel !== "sms" || ![purpose, phoneTestPurpose].includes(challenge.purpose) || challenge.consumedAt || challenge.attempts >= 5 || challenge.expiresAt <= new Date()) return { invalid: true as const };
      const temporary = challenge.purpose === phoneTestPurpose;
      if (temporary) requireGlobalWechatPhoneTest();
      if ((temporary && (challenge.sentAt || !secureEqual(challenge.codeHash, phoneTestHash(challengeId, ticket.tokenHash)))) ||
          (!temporary && (!challenge.sentAt || !secureEqual(challenge.codeHash, bindingHash(challengeId, code, ticket.tokenHash))))) {
        await tx.globalVerificationChallenge.updateMany({ where: { id: challengeId, consumedAt: null, attempts: { lt: 5 } }, data: { attempts: { increment: 1 } } });
        return { invalid: true as const };
      }
      const identity = globalIdentity("sms", challenge.identifier);
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`global-wechat-account:sms:${identity.identifier}`}, 0))`;
      const initialLink = await tx.wechatOfficialIdentity.findUnique({ where: { appId_openId: { appId, openId: ticket.openId } } });
      const byPhone = await tx.user.findUnique({ where: { mobile: identity.identifier } });
      // An entered, unverified number is never a credential for another User.
      if ((temporary && byPhone && byPhone.id !== initialLink?.userId) || (initialLink && byPhone && initialLink.userId !== byPhone.id)) throw conflict();
      let user = initialLink ? await tx.user.findUnique({ where: { id: initialLink.userId } }) : byPhone;
      if (user) {
        await lockUser(tx, user.id);
        user = await tx.user.findUnique({ where: { id: user.id } });
        if (!user || user.status !== UserStatus.ACTIVE) throw inactive();
        if (user.mobile && user.mobile !== identity.identifier) throw conflict();
        if (temporary && user.mobileVerifiedAt) throw conflict();
        if (!temporary && !initialLink && !user.mobileVerifiedAt) {
          if (!user.passwordHash) throw conflict();
          if (!body.password) throw globalError(403, "phone_password_required", "Enter the existing account password as well as the verification code.");
          if (!await compare(password(body.password), user.passwordHash)) {
            await tx.globalVerificationChallenge.updateMany({ where: { id: challengeId, consumedAt: null, attempts: { lt: 5 } }, data: { attempts: { increment: 1 } } });
            return { invalid: true as const, credentials: true as const };
          }
        }
      } else if (initialLink) throw inactive();
      await lockIdentity(tx, appId, ticket.openId);
      const linked = await tx.wechatOfficialIdentity.findUnique({ where: { appId_openId: { appId, openId: ticket.openId } } });
      if (linked?.userId !== initialLink?.userId || (linked && linked.userId !== user?.id)) throw conflict();
      if (user) {
        const other = await tx.wechatOfficialIdentity.findUnique({ where: { userId_appId: { userId: user.id, appId } } });
        if (other && other.openId !== ticket.openId) throw conflict();
      }
      const legal = await this.legal(body.consentVersion, body.locale ?? challenge.locale, tx);
      if ((await tx.globalVerificationChallenge.updateMany({ where: { id: challengeId, consumedAt: null, attempts: { lt: 5 }, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } })).count !== 1) return { invalid: true as const };
      if (user && !temporary && !user.mobileVerifiedAt) await tx.userSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      const data = { mobile: identity.identifier, ...(!temporary ? { mobileVerifiedAt: new Date() } : {}) };
      const saved = user ? await tx.user.update({ where: { id: user.id }, data })
        : await tx.user.create({ data: { ...data, passwordHash: null, nickname: "Saydian user", locale: globalLocale(body.locale ?? challenge.locale) } });
      await this.attach(tx, ticket, saved.id);
      await recordConsent(tx, saved.id, legal.consentVersion, legal.locale);
      return { invalid: false as const, userId: saved.id };
    }, { maxWait: 10_000, timeout: 30_000 }).catch(identityConflict);
    if (result.invalid) {
      if ("credentials" in result) throw globalError(401, "invalid_credentials", "Use this account's existing password. Verification codes do not reset passwords.");
      throw invalidCode();
    }
    return this.session(result.userId, ticket.returnTo, appId);
  }

  private async ticket(value: unknown, appId: string, db: Prisma.TransactionClient = this.prisma): Promise<Ticket> {
    if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw invalidTicket();
    const row = await db.commerceWechatBindTicket.findUnique({ where: { tokenHash: sha256(value) } });
    if (!row || row.appId !== appId || row.consumedAt || row.expiresAt <= new Date()) throw invalidTicket();
    return row;
  }

  private async currentConfiguration(tx: Prisma.TransactionClient) {
    requireGlobalWechatH5();
    await tx.$queryRaw`SELECT id FROM "IntegrationConfig" WHERE key = 'wechat_official' FOR SHARE`;
    const config = await tx.integrationConfig.findUnique({ where: { key: "wechat_official" }, select: { state: true } });
    if (config?.state !== "CONFIGURED") throw globalError(503, "wechat_h5_unavailable", "WeChat official-account sign-in is unavailable.");
  }

  private async attach(tx: Prisma.TransactionClient, ticket: Ticket, userId: string) {
    const linked = await tx.wechatOfficialIdentity.findUnique({ where: { appId_openId: { appId: ticket.appId, openId: ticket.openId } } });
    const other = await tx.wechatOfficialIdentity.findUnique({ where: { userId_appId: { userId, appId: ticket.appId } } });
    if ((linked && linked.userId !== userId) || (other && other.openId !== ticket.openId)) throw conflict();
    const claimed = await tx.commerceWechatBindTicket.updateMany({ where: { tokenHash: ticket.tokenHash, appId: ticket.appId, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
    if (claimed.count !== 1) throw invalidTicket();
    if (!linked) await tx.wechatOfficialIdentity.create({ data: { userId, appId: ticket.appId, openId: ticket.openId, unionId: ticket.unionId, verifiedAt: new Date() } });
  }

  async session(userId: string, returnTo: string, appId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== UserStatus.ACTIVE) throw inactive();
    if (user.mobileVerifiedAt) {
      const result = await this.auth.issueMallSession(userId);
      return { ...result, user: { ...result.user, phoneTestMode: false, phoneVerified: true, phoneVerificationStatus: "verified" }, requiresMobileBinding: false as const, requiresAccountBinding: false as const, returnTo };
    }
    if (user.mobile && globalWechatPhoneTestEnabled()) return { ...await this.auth.issuePhoneTestMallSession(userId), requiresMobileBinding: false as const, requiresAccountBinding: false as const, returnTo };
    const identity = await this.prisma.wechatOfficialIdentity.findUnique({ where: { userId_appId: { userId, appId } } });
    if (!identity) throw invalidTicket();
    const token = randomBytes(32).toString("hex");
    await this.prisma.commerceWechatBindTicket.create({ data: { tokenHash: sha256(token), appId: identity.appId, openId: identity.openId, unionId: identity.unionId, returnTo, expiresAt: new Date(Date.now() + 300_000) } });
    return { requiresMobileBinding: true as const, requiresAccountBinding: true as const, requiresPhoneBinding: true as const, bindTicket: token, expiresIn: 300, returnTo };
  }
}

async function lockUser(tx: Prisma.TransactionClient, userId: string) { await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`; }
async function lockIdentity(tx: Prisma.TransactionClient, appId: string, openId: string) { await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`h5-openid:${appId}:${openId}`}, 0))`; }
async function recordConsent(tx: Prisma.TransactionClient, userId: string, version: string, locale: string) {
  for (const documentType of ["user_agreement", "privacy_policy"]) await tx.consentRecord.upsert({
    where: { userId_documentType_version: { userId, documentType, version } },
    create: { userId, documentType, version, source: `global_h5_wechat:${locale}` },
    update: { withdrawnAt: null, source: `global_h5_wechat:${locale}` },
  });
}
function bindingHash(id: string, code: string, ticketHash: string) { return sha256(`global:${id}:${code}:${env("REFRESH_TOKEN_PEPPER")}:wechat-bind:${ticketHash}`); }
function phoneTestHash(id: string, ticketHash: string) { return sha256(`global:${id}:${env("REFRESH_TOKEN_PEPPER")}:wechat-phone-test:${ticketHash}`); }
function password(value: unknown) { const text = typeof value === "string" ? value : ""; if (text.length < 8 || Buffer.byteLength(text, "utf8") > 72) throw globalError(400, "invalid_password", "Use a password of at least 8 characters and at most 72 UTF-8 bytes."); return text; }
function invalidTicket() { return globalError(401, "wechat_binding_expired", "WeChat authorization has expired. Authorize again."); }
function invalidCode() { return globalError(400, "verification_invalid", "The verification code is incorrect or has expired."); }
function inactive() { return globalError(409, "account_unavailable", "This account cannot sign in. Contact support."); }
function verificationRequired() { return globalError(403, "account_verification_required", "Verify your email address or international phone before using the H5 account. WeChat authorization does not verify either identifier."); }
function conflict() { return globalError(409, "identity_conflict", "These identities belong to different accounts. They will not be merged automatically."); }
function identityConflict(error: unknown): never { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw conflict(); throw error; }
