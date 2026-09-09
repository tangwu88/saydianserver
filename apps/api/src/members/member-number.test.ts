import { afterEach, describe, expect, it, vi } from "vitest";
import { decode } from "jsonwebtoken";
import { AuthService } from "../auth/auth.service";
import { AdminService } from "../admin/admin.service";

afterEach(() => vi.unstubAllEnvs());

const user = {
  id: "11111111-1111-4111-8111-111111111111", compatibilityId: 27,
  legacyMemberId: null, nickname: "Synthetic member", status: "ACTIVE",
  mobile: null, email: "qa@example.invalid", locale: "en", avatarUrl: null,
  gender: "UNSPECIFIED", birthday: null, heightCm: null, weightKg: null,
  createdAt: new Date("2026-09-10T00:00:00Z"), _count: { healthRecords: 0, devices: 0 },
};

describe("member display numbers", () => {
  it("returns the same number for sessions and profile without changing UUID identity", async () => {
    vi.stubEnv("APP_REALM", "global");
    vi.stubEnv("ACCESS_TOKEN_SECRET", "synthetic-member-number-signing-secret");
    vi.stubEnv("REFRESH_TOKEN_PEPPER", "synthetic-member-number-pepper");
    const auth = new AuthService({ user: { findUniqueOrThrow: async () => user }, userSession: { create: vi.fn() } } as any, {} as any, {} as any, {} as any);
    const session = await auth.issueSession(user.id);
    const profile = await auth.profile(user.id);
    expect(session.member).toEqual(profile);
    expect(profile).toMatchObject({ id: user.id, memberNo: "27", promo_code: "27", emailMasked: "q***@example.invalid" });
    expect(decode(session.accessToken)).toMatchObject({ sub: user.id });
    expect(profile).not.toHaveProperty("email");
    expect(profile).not.toHaveProperty("passwordHash");
  });

  it("does not change the domestic App profile contract", async () => {
    vi.stubEnv("APP_REALM", "domestic");
    const auth = new AuthService({ user: { findUniqueOrThrow: async () => user } } as any, {} as any, {} as any, {} as any);
    expect(await auth.profile(user.id)).not.toHaveProperty("promo_code");
  });

  it("lists existing international registrations, masks email and searches their numeric number", async () => {
    vi.stubEnv("APP_REALM", "global");
    const findMany = vi.fn(async (_query: any) => [user]);
    const count = vi.fn(async (_query: any) => 1);
    const service = new AdminService({ user: { findMany, count }, $transaction: (queries: Promise<unknown>[]) => Promise.all(queries) } as any, {} as any);
    const result = await service.members(" 27 ", 2, 10);
    expect(result).toMatchObject({ items: [{ id: user.id, memberNo: "27", emailMasked: "q***@example.invalid" }], total: 1, page: 2, pageSize: 10 });
    const query = findMany.mock.calls[0]![0] as any;
    expect(query.skip).toBe(10);
    expect(query.where.OR).toContainEqual({ compatibilityId: 27 });
    expect(query.where.OR).toContainEqual({ email: { contains: "27", mode: "insensitive" } });
    expect((count.mock.calls[0]![0] as any).where).toEqual(query.where);
    expect(result.items[0]).not.toHaveProperty("email");
  });

  it("does not treat an email or out-of-range search as an integer database filter", async () => {
    vi.stubEnv("APP_REALM", "global");
    const findMany = vi.fn(async (_query: any) => []);
    const service = new AdminService({ user: { findMany, count: async () => 0 }, $transaction: (queries: Promise<unknown>[]) => Promise.all(queries) } as any, {} as any);
    for (const search of ["qa@example.invalid", "9999999999999999999999999", "-1"]) await service.members(search);
    for (const [query] of findMany.mock.calls as unknown as [any][]) expect(query.where.OR.some((part: any) => "compatibilityId" in part)).toBe(false);
  });
});
