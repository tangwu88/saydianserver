import { describe, expect, it, vi } from "vitest";
import { hash, compare } from "bcryptjs";
import { PartnerAuthService, PartnerAuthGuard } from "./partner-auth";
import { randomUUID } from "node:crypto";
import { sha256 } from "../common/crypto";

async function harness(required = true) {
  const partner = {
    id: randomUUID(),
    active: true,
    mustChangePassword: required,
    passwordHash: await hash("synthetic-initial-password", 4),
    username: "qa",
    level: { name: "战略合作" },
  };
  const session = {
    id: randomUUID(),
    partnerId: partner.id,
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    memberSessionId: null,
    partner,
  };
  const db: any = {
    $queryRaw: vi.fn(),
    brandPartner: {
      findUnique: vi.fn(async () => partner),
      findUniqueOrThrow: vi.fn(async () => partner),
      update: vi.fn(async ({ data }: any) => Object.assign(partner, data)),
    },
    partnerSession: {
      findUnique: vi.fn(async () => session),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    auditLog: { create: vi.fn() },
    partnerAgreement: { findFirst: vi.fn(async () => null) },
  };
  db.$transaction = (fn: any) => fn(db);
  const service = new PartnerAuthService(db);
  const input = {
    currentPassword: "synthetic-initial-password",
    newPassword: "synthetic-new-password",
    confirmPassword: "synthetic-new-password",
  };
  return { partner, session, db, service, input };
}
function context(path: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        header: () => "Bearer synthetic",
        originalUrl: path,
      }),
    }),
  } as any;
}
describe("brand partner first password boundary", () => {
  it.each([true, false])(
    "returns the persisted initial-password requirement at login (%s)",
    async (required) => {
      const h = await harness(required);
      const login = await h.service.login({
        username: "qa",
        password: h.input.currentPassword,
      });
      expect(login.mustChangePassword).toBe(required);
      expect(JSON.stringify(login)).not.toContain(h.partner.passwordHash);
    },
  );
  it.each(["products", "orders", "dashboard", "agreement", "agreement/accept"])(
    "blocks %s until password is changed",
    async (path) => {
      const h = await harness();
      const guard = new PartnerAuthGuard(h.db);
      try {
        await guard.canActivate(context(`/api/saydian-app/vip/v1/${path}`));
        throw new Error("unexpected access");
      } catch (e: any) {
        expect(e.getResponse().errorKey).toBe(
          "PARTNER_PASSWORD_CHANGE_REQUIRED",
        );
      }
      expect(h.db.partnerAgreement.findFirst).not.toHaveBeenCalled();
    },
  );
  it.each(["me", "logout", "change-password"])(
    "allows auth/%s before agreement and initial password completion",
    async (path) => {
      const h = await harness();
      expect(
        await new PartnerAuthGuard(h.db).canActivate(
          context(`/global/api/saydian-app/vip/v1/auth/${path}?v=1`),
        ),
      ).toBe(true);
    },
  );
  it("changes the password, rotates all sessions and does not audit credentials", async () => {
    const h = await harness();
    const result = await h.service.changePassword(
      h.partner.id,
      h.session.id,
      h.input,
      "request",
    );
    expect(result.mustChangePassword).toBe(false);
    expect(h.partner.mustChangePassword).toBe(false);
    expect(await compare(h.input.newPassword, h.partner.passwordHash)).toBe(
      true,
    );
    expect(h.db.partnerSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { partnerId: h.partner.id, revokedAt: null },
      }),
    );
    expect(h.db.partnerSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tokenHash: sha256(result.token) }),
      }),
    );
    const audit = JSON.stringify(h.db.auditLog.create.mock.calls);
    for (const secret of [
      h.input.currentPassword,
      h.input.newPassword,
      h.partner.passwordHash,
      result.token,
    ])
      expect(audit).not.toContain(secret);
  });
  it.each([
    { currentPassword: "wrong-password" },
    { newPassword: "short", confirmPassword: "short" },
    { confirmPassword: "not-the-same" },
    {
      newPassword: "synthetic-initial-password",
      confirmPassword: "synthetic-initial-password",
    },
    { newPassword: "中".repeat(25), confirmPassword: "中".repeat(25) },
  ])(
    "rejects invalid passwords without mutating credentials %j",
    async (changes) => {
      const h = await harness();
      await expect(
        h.service.changePassword(
          h.partner.id,
          h.session.id,
          { ...h.input, ...changes },
          "request",
        ),
      ).rejects.toThrow();
      expect(h.db.brandPartner.update).not.toHaveBeenCalled();
      expect(h.db.partnerSession.updateMany).not.toHaveBeenCalled();
    },
  );
  it("rejects a session belonging to a different partner", async () => {
    const h = await harness();
    h.session.partnerId = randomUUID();
    await expect(
      h.service.changePassword(h.partner.id, h.session.id, h.input, "request"),
    ).rejects.toThrow("登录已失效");
    expect(h.db.brandPartner.update).not.toHaveBeenCalled();
  });
});
