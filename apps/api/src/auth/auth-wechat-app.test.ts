import { beforeEach, describe, expect, it, vi } from "vitest";
import { Gender, UserStatus } from "@prisma/client";
import { AuthService } from "./auth.service";
import type { PrismaService } from "../common/prisma.service";
import type { SmsAdapterService } from "./sms-adapter.service";
import type { IntegrationSecretsService } from "../common/integration-secrets.service";
import type {
  WechatAppAuthService,
  WechatAppIdentity,
} from "./wechat-app-auth.service";

const identity: WechatAppIdentity = {
  openId: "app-open-id",
  unionId: "shared-union-id",
  nickname: "微信昵称",
  avatarUrl: "https://thirdwx.example/avatar.png",
  gender: Gender.FEMALE,
};

const baseUser = {
  id: "0de70c95-3332-485a-8243-dc539a297622",
  legacyMemberId: null,
  mobile: null,
  passwordHash: null,
  status: UserStatus.ACTIVE,
  nickname: "既有用户",
  avatarUrl: null,
  gender: Gender.UNSPECIFIED,
  birthday: null,
  heightCm: null,
  weightKg: null,
};

function fixture(options: {
  byOpenId?: typeof baseUser | null;
  byUnionId?: typeof baseUser | null;
} = {}) {
  let savedUser = baseUser;
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    savedUser = { ...baseUser, ...data } as typeof baseUser;
    return savedUser;
  });
  const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    savedUser = { ...baseUser, ...data } as typeof baseUser;
    return savedUser;
  });
  const upsertConsent = vi.fn(async () => ({}));
  const transactionUser = {
    findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
      "wechatAppOpenId" in where
        ? (options.byOpenId ?? null)
        : (options.byUnionId ?? null)),
    create,
    update,
  };
  const prisma = {
    $transaction: async (operation: (tx: unknown) => unknown) =>
      operation({ user: transactionUser, consentRecord: { upsert: upsertConsent } }),
    userSession: { create: vi.fn(async () => ({})) },
    user: { findUniqueOrThrow: vi.fn(async () => savedUser) },
  } as unknown as PrismaService;
  const exchange = vi.fn(async () => identity);
  const service = new AuthService(
    prisma,
    {} as SmsAdapterService,
    {} as IntegrationSecretsService,
    { exchange } as unknown as WechatAppAuthService,
  );
  return { service, exchange, create, update, upsertConsent };
}

function input(consentAccepted = true) {
  return {
    code: "one-time-code",
    state: "fresh-state",
    platform: "harmony",
    consentAccepted,
    consentVersion: "harmony-native-legal-v1",
    consentSource: "legacy_app_wechat_harmony",
  };
}

describe("native WeChat account mapping", () => {
  beforeEach(() => {
    process.env.ACCESS_TOKEN_SECRET =
      "test-access-secret-with-at-least-32-characters";
    process.env.REFRESH_TOKEN_PEPPER =
      "test-refresh-pepper-with-at-least-32-chars";
  });

  it("requires explicit legal consent before provider exchange", async () => {
    const { service, exchange } = fixture();
    await expect(service.loginWechatApp(input(false))).rejects.toThrow(
      "请先阅读并同意",
    );
    expect(exchange).not.toHaveBeenCalled();
  });

  it("creates a mobile-app identity without inventing a phone number", async () => {
    const { service, create, upsertConsent } = fixture();
    const session = await service.loginWechatApp(input());
    expect(session.member.nickname).toBe("微信昵称");
    expect(create).toHaveBeenCalledWith({
      data: {
        wechatAppOpenId: "app-open-id",
        wechatUnionId: "shared-union-id",
        nickname: "微信昵称",
        avatarUrl: "https://thirdwx.example/avatar.png",
        gender: Gender.FEMALE,
      },
    });
    expect(upsertConsent).toHaveBeenCalledTimes(2);
  });

  it("joins the mobile App identity to an existing UnionID account", async () => {
    const { service, update, create } = fixture({ byUnionId: baseUser });
    await service.loginWechatApp(input());
    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: baseUser.id },
      data: expect.objectContaining({
        status: UserStatus.ACTIVE,
        wechatAppOpenId: "app-open-id",
        wechatUnionId: "shared-union-id",
        avatarUrl: "https://thirdwx.example/avatar.png",
        gender: Gender.FEMALE,
      }),
    });
  });

  it("refuses to merge conflicting OpenID and UnionID owners", async () => {
    const other = { ...baseUser, id: "c03cd9ae-b71d-4d86-a401-a8376e2f4398" };
    const { service } = fixture({ byOpenId: baseUser, byUnionId: other });
    await expect(service.loginWechatApp(input())).rejects.toThrow(
      "微信账号关联存在冲突",
    );
  });
});
