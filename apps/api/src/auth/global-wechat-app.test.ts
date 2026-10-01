import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sha256 } from "../common/crypto";
import { GlobalWechatAppService } from "./global-wechat-app.service";

const appId = "wx1234567890abcdef";
const identity = {
  appId,
  openId: "app-open-id",
  unionId: "shared-union-id",
  nickname: "微信昵称",
  avatarUrl: "https://thirdwx.example/avatar.png",
  gender: "UNSPECIFIED",
};

beforeEach(() => {
  vi.stubEnv("APP_REALM", "global");
  vi.stubEnv("BUSINESS_WRITES_PAUSED", "false");
  vi.stubEnv("MAINTENANCE_READ_ONLY", "false");
  vi.stubEnv(
    "ACCESS_TOKEN_SECRET",
    "synthetic-access-token-secret-longer-than-32-characters",
  );
  vi.stubEnv(
    "REFRESH_TOKEN_PEPPER",
    "synthetic-refresh-pepper-longer-than-32-characters",
  );
});

afterEach(() => vi.unstubAllEnvs());

function harness() {
  const users: any[] = [];
  const identities: any[] = [];
  const tickets = new Map<string, any>();
  const challenges = new Map<string, any>();
  const throttles = new Map<string, Date>();
  const legalRows = ["user_agreement", "privacy_policy", "say_ring_user_agreement", "say_ring_privacy_policy"].map(
    (documentType) => ({
      documentType,
      version: "legal-v1",
      locale: "zh-Hans",
      contentHtml: "Synthetic legal text",
      reviewed: true,
      active: true,
    }),
  );

  const userFor = (where: any) =>
    users.find((user) =>
      Object.entries(where).every(([key, value]) => user[key] === value),
    ) ?? null;
  const identityFor = (where: any) => {
    if (where.appId_openId) {
      return identities.find(
        (item) =>
          item.appId === where.appId_openId.appId &&
          item.openId === where.appId_openId.openId,
      ) ?? null;
    }
    return null;
  };
  const tx: any = {
    $queryRaw: vi.fn(async () => [{ ok: 1 }]),
    integrationConfig: {
      findUnique: vi.fn(async () => ({
        state: "CONFIGURED",
        publicConfig: {},
      })),
    },
    globalLegalDocument: { findMany: vi.fn(async ({ where }: any) => legalRows.filter(row => where.documentType.in.includes(row.documentType))) },
    globalVerificationThrottle: {
      upsert: vi.fn(async ({ where, create }: any) => {
        if (!throttles.has(where.key)) throttles.set(where.key, create.reservedAt);
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const current = throttles.get(where.key);
        if (!current || current > where.reservedAt.lte) return { count: 0 };
        throttles.set(where.key, data.reservedAt);
        return { count: 1 };
      }),
    },
    globalVerificationChallenge: {
      count: vi.fn(async ({ where }: any) =>
        [...challenges.values()].filter(
          (row) =>
            row.channel === where.channel &&
            row.identifier === where.identifier &&
            row.createdAt > where.createdAt.gt,
        ).length,
      ),
      create: vi.fn(async ({ data }: any) => {
        challenges.set(data.id, {
          ...data,
          attempts: 0,
          sentAt: null,
          consumedAt: null,
          createdAt: new Date(),
        });
      }),
      findUnique: vi.fn(async ({ where }: any) =>
        challenges.get(where.id) ?? null,
      ),
      update: vi.fn(async ({ where, data }: any) =>
        Object.assign(challenges.get(where.id), data),
      ),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const row = challenges.get(where.id);
        if (
          !row ||
          row.consumedAt ||
          row.attempts >= (where.attempts?.lt ?? 99) ||
          (where.expiresAt && row.expiresAt <= where.expiresAt.gt)
        ) {
          return { count: 0 };
        }
        if (data.attempts) row.attempts += 1;
        if (data.consumedAt) row.consumedAt = data.consumedAt;
        return { count: 1 };
      }),
    },
    commerceWechatBindTicket: {
      create: vi.fn(async ({ data }: any) => tickets.set(data.tokenHash, {
        ...data,
        referralCode: null,
        consumedAt: null,
        createdAt: new Date(),
      })),
      findUnique: vi.fn(async ({ where }: any) =>
        tickets.get(where.tokenHash) ?? null,
      ),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const row = tickets.get(where.tokenHash);
        if (
          !row ||
          row.appId !== where.appId ||
          row.consumedAt ||
          row.expiresAt <= where.expiresAt.gt
        ) {
          return { count: 0 };
        }
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
    wechatOfficialIdentity: {
      findUnique: vi.fn(async ({ where, include }: any) => {
        const row = identityFor(where);
        return row && include?.user
          ? { ...row, user: userFor({ id: row.userId }) }
          : row;
      }),
      findFirst: vi.fn(async ({ where }: any) =>
        identities.find((item) => item.unionId === where.unionId) ?? null,
      ),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: randomUUID(), ...data };
        identities.push(row);
        return row;
      }),
    },
    user: {
      findUnique: vi.fn(async ({ where }: any) => userFor(where)),
      create: vi.fn(async ({ data }: any) => {
        const row = {
          id: randomUUID(),
          status: "ACTIVE",
          avatarUrl: null,
          ...data,
        };
        users.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) =>
        Object.assign(userFor(where), data),
      ),
    },
    userSession: { updateMany: vi.fn(async () => ({ count: 1 })) },
    consentRecord: { upsert: vi.fn(async () => ({})) },
  };
  const prisma: any = {
    ...tx,
    $transaction: vi.fn(async (operation: any) => operation(tx)),
  };
  const delivery: any = {
    assertAvailable: vi.fn(async () => ({})),
    send: vi.fn(async () => undefined),
  };
  const auth: any = {
    issueSession: vi.fn(async (userId: string) => ({
      accessToken: "synthetic-access",
      refreshToken: "synthetic-refresh",
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
      member: { id: userId, nickname: userFor({ id: userId }).nickname },
    })),
  };
  const wechat: any = { exchange: vi.fn(async () => identity) };
  const integrationSecrets: any = {
    resolve: vi.fn(async () => ({
      appId,
      appSecret: "synthetic-app-secret-long-enough",
    })),
  };
  const service = new GlobalWechatAppService(
    prisma,
    auth,
    delivery,
    wechat,
    integrationSecrets,
  );
  return {
    service,
    auth,
    delivery,
    users,
    identities,
    tickets,
    challenges,
    prisma,
  };
}

describe("global native WeChat phone binding", () => {
  it("advertises only the public AppID when login and SMS are ready", async () => {
    const h = harness();
    const capability = await h.service.capability({
      legalReady: true,
      deliveryOpen: true,
      smsReady: true,
    });
    expect(capability).toEqual({
      enabled: true,
      appId,
      phoneBindingAvailable: true,
    });
    expect(JSON.stringify(capability)).not.toContain("synthetic-app-secret");
  });

  it("requires OTP on first authorization and directly signs in afterwards", async () => {
    const h = harness();
    const pending: any = await h.service.login({
      code: "one-time-code",
      state: `sd_${Date.now()}_01234567-89ab-cdef-0123456789ab`,
      platform: "android",
      consentAccepted: true,
      consentVersion: "legal-v1",
      locale: "zh-Hans",
      product: "say-ring",
    });
    expect(pending).toMatchObject({
      requiresPhoneBinding: true,
      bindTicket: expect.stringMatching(/^[a-f0-9]{64}$/),
      wechatProfileProof: expect.any(String),
    });
    expect(h.users).toHaveLength(0);
    expect(h.auth.issueSession).not.toHaveBeenCalled();

    await expect(h.service.requestPhoneCode({
      bindTicket: pending.bindTicket,
      identifier: "+8613812345678",
      consentVersion: "legal-v1",
      locale: "zh-Hans",
    })).rejects.toMatchObject({ status: 409 });
    expect(h.delivery.send).not.toHaveBeenCalled();

    const challenge: any = await h.service.requestPhoneCode({
      bindTicket: pending.bindTicket,
      identifier: "+8613812345678",
      consentVersion: "legal-v1",
      locale: "zh-Hans",
      product: "say-ring",
    });
    const delivered = h.delivery.send.mock.calls[0]![0];
    expect(challenge).not.toHaveProperty("code");
    expect(delivered.code).toMatch(/^\d{6}$/);

    const session: any = await h.service.bindPhone({
      bindTicket: pending.bindTicket,
      challengeId: challenge.challengeId,
      code: delivered.code,
      consentVersion: "legal-v1",
      locale: "zh-Hans",
      product: "say-ring",
      wechatProfileProof: pending.wechatProfileProof,
    });
    expect(session.member.id).toBe(h.users[0].id);
    expect(h.users[0]).toMatchObject({
      mobile: "+8613812345678",
      mobileVerifiedAt: expect.any(Date),
      wechatAppOpenId: identity.openId,
      wechatUnionId: identity.unionId,
      nickname: identity.nickname,
    });
    expect(h.identities[0]).toMatchObject({
      userId: h.users[0].id,
      appId,
      openId: identity.openId,
    });
    expect(h.tickets.get(sha256(pending.bindTicket)).consumedAt).toBeInstanceOf(Date);
    expect(h.prisma.consentRecord.upsert.mock.calls.map(([call]: any[]) => call.create)).toEqual([
      expect.objectContaining({ documentType: "say_ring_user_agreement", source: "global_app_wechat:say-ring:zh-Hans" }),
      expect.objectContaining({ documentType: "say_ring_privacy_policy", source: "global_app_wechat:say-ring:zh-Hans" }),
    ]);

    const next: any = await h.service.login({
      code: "next-one-time-code",
      state: `sd_${Date.now()}_01234567-89ab-cdef-0123456789ab`,
      platform: "android",
      consentAccepted: true,
      consentVersion: "legal-v1",
      locale: "zh-Hans",
      product: "say-ring",
    });
    expect(next.member.id).toBe(h.users[0].id);
    expect(next).not.toHaveProperty("requiresPhoneBinding");
  });
});
