import { beforeEach, describe, expect, it } from "vitest";
import { AuthService } from "./auth.service";
import type { PrismaService } from "../common/prisma.service";
import type { SmsAdapterService } from "./sms-adapter.service";
import type { IntegrationSecretsService } from "../common/integration-secrets.service";

describe("refresh token rotation", () => {
  beforeEach(() => {
    process.env.ACCESS_TOKEN_SECRET = "test-access-secret-with-at-least-32-characters";
    process.env.REFRESH_TOKEN_PEPPER = "test-refresh-pepper-with-at-least-32-chars";
  });

  it("allows only one winner when the same refresh token is used concurrently", async () => {
    let rotationClaims = 0;
    const user = {
      id: "0de70c95-3332-485a-8243-dc539a297622",
      legacyMemberId: null,
      mobile: "13800000000",
      passwordHash: "$2b$12$example",
      status: "ACTIVE",
      nickname: "测试用户",
      avatarUrl: null,
      gender: "UNSPECIFIED",
      birthday: null,
      heightCm: null,
      weightKg: null,
    };
    const prisma = {
      userSession: {
        findUnique: async () => ({
          id: "4068963f-9dd7-4807-ac5e-9118fa1a6272",
          userId: user.id,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          user,
        }),
        updateMany: async () => ({ count: rotationClaims++ === 0 ? 1 : 0 }),
      },
      user: { findUniqueOrThrow: async () => user },
    } as unknown as PrismaService;
    const service = new AuthService(
      prisma,
      { send: async () => undefined } as unknown as SmsAdapterService,
      {} as IntegrationSecretsService,
    );
    const results = await Promise.allSettled([
      service.refresh("same-refresh-token"),
      service.refresh("same-refresh-token"),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });
});
