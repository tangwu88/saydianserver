import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { compare } from "bcryptjs";
import { Prisma } from "@prisma/client";
import { Reflector } from "@nestjs/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdminService } from "./admin.service";
import { AdminController } from "./admin.controller";
import { AdminAuthGuard } from "./admin-auth";
import { AuthService } from "../auth/auth.service";
import { GlobalAuthService } from "../auth/global-auth.service";
import { AuthController } from "../auth/auth.controller";
import { UserAuthGuard } from "../common/user-auth.guard";
import { LegacySiteController } from "../legacy/legacy-site.controller";

beforeEach(() => {
  vi.stubEnv("ACCESS_TOKEN_SECRET", "synthetic-admin-created-member-login-secret");
  vi.stubEnv("REFRESH_TOKEN_PEPPER", "synthetic-admin-created-member-refresh-pepper");
});
afterEach(() => vi.unstubAllEnvs());

const admin = { id: "synthetic-admin", role: "SUPER_ADMIN" };
const input = { mobile: "13900001234", password: "synthetic-password-123" };
function harness() {
  const users = new Map<string, any>();
  const sessions = new Map<string, any>();
  const tx = {
    user: {
      create: vi.fn(async ({ data }: any) => {
        if (users.has(data.mobile)) throw new Prisma.PrismaClientKnownRequestError("private database detail", { code: "P2002", clientVersion: "6" });
        const row = { ...data, id: randomUUID(), compatibilityId: 10001 };
        users.set(data.mobile, row); return row;
      }),
      findUnique: vi.fn(async ({ where }: any) => users.get(where.mobile) ?? null),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => [...users.values()].find(user => user.id === where.id)),
    },
    userSession: {
      create: vi.fn(async ({ data }: any) => { const session = { ...data, revokedAt: null }; sessions.set(data.id, session); return session; }),
      findFirst: vi.fn(async ({ where }: any) => {
        const session = sessions.get(where.id); if (!session || session.userId !== where.userId || session.accessJti !== where.accessJti) return null;
        return { ...session, user: [...users.values()].find(user => user.id === session.userId) };
      }),
    },
    auditLog: { create: vi.fn(async (_input: any) => ({})) },
    consentRecord: { upsert: vi.fn(async () => ({})) },
    globalLegalDocument: { findMany: vi.fn(async () => ["user_agreement", "privacy_policy", "say_ring_user_agreement", "say_ring_privacy_policy"].map(documentType => ({ documentType, version: "v1", locale: "en", contentHtml: "Synthetic legal document" }))) },
  };
  const db = { ...tx, $transaction: vi.fn(async (operation: any) => {
    const snapshot = new Map(users);
    try { return await operation(tx); } catch (e) { users.clear(); for (const [key, value] of snapshot) users.set(key, value); throw e; }
  }) };
  const service = new AdminService(db as any, {} as any);
  const auth = new AuthService(db as any, {} as any, {} as any, {} as any);
  const native = new AuthController(auth, new GlobalAuthService(db as any, {} as any, auth), {} as any);
  return { service, tx, users, auth, native, db };
}
it("creates a verified shared App account with a bcrypt password and a redacted audit", async () => {
  const h = harness();
  const result = await h.service.createMember(admin, "request-create", input);
  const row = h.users.get("+8613900001234");
  expect(row.mobileVerifiedAt).toBeInstanceOf(Date);
  expect(row.passwordHash).toMatch(/^\$2b\$12\$/);
  expect(await compare(input.password, row.passwordHash)).toBe(true);
  expect(result).toMatchObject({ memberNo: "10001", mobileVerified: true, status: "ACTIVE" });
  expect(JSON.stringify(result)).not.toContain("password");
  const audit = h.tx.auditLog.create.mock.calls[0]![0] as any;
  expect(audit.data).toMatchObject({ action: "MEMBER_CREATE", actorId: admin.id, entityId: result.id, requestId: "request-create" });
  expect(JSON.stringify(audit)).not.toContain(input.mobile);
  expect(JSON.stringify(audit)).not.toContain(input.password);
  expect(h.tx.consentRecord.upsert).not.toHaveBeenCalled();
  expect(h.tx.user.create.mock.calls[0]![0].data).not.toHaveProperty("heightCm");
});
it("allows the created credentials through both watch and ring App login and mall login", async () => {
  const h = harness(); const created = await h.service.createMember(admin, "request-app", input);
  for (const product of ["saydian-global", "say-ring"]) {
    const result = await h.native.login({ mobile: input.mobile, password: input.password, product, consentAccepted: true, consentVersion: "v1", locale: "en" });
    expect(result.member.id).toBe(created.id);
    expect(result.accessToken.split(".")).toHaveLength(3);
    expect(result.refreshToken).toBeTruthy();
    const request = { method: "POST", path: "/api/saydian-app/v2/devices/bind", header: () => `Bearer ${result.accessToken}` };
    await expect(new UserAuthGuard(h.db as any).canActivate({ switchToHttp: () => ({ getRequest: () => request }) } as any)).resolves.toBe(true);
  }
  expect((await h.auth.loginForMall(input.mobile, input.password)).user.id).toBe(created.id);
  // Watch App sends username/group to V1; current Ring mobile login omits product.
  const legacy = new LegacySiteController(h.auth, { member: async () => ({ id: 10001 }) } as any);
  const watchLogin = await legacy.login({ username: input.mobile, password: input.password, group: "app" });
  expect(watchLogin.data.access_token.split(".")).toHaveLength(3);
  expect(watchLogin.data.refresh_token).toBeTruthy();
  expect((await h.native.login({ mobile: input.mobile, password: input.password })).member.id).toBe(created.id);
  await expect(h.native.login({ mobile: input.mobile, password: "wrong-password", product: "saydian-global" })).rejects.toThrow();
  await expect(h.native.login({ mobile: input.mobile, password: input.password, product: "say-ring" })).rejects.toThrow();
});
it.each([{mobile:"invalid"}, {password:"short"}, {password:"密".repeat(25)}, {password:123456789}, {roles:["SUPER_ADMIN"]}, {mobileVerified:false}])("rejects invalid or injected fields before writing: %j", async change => {
  const h=harness(); await expect(h.service.createMember(admin,"request-invalid",{...input,...change})).rejects.toMatchObject({status:400});
  expect(h.tx.user.create).not.toHaveBeenCalled();
});
it("rejects normalized duplicates without changing the original password or account", async () => {
  const h=harness(); await h.service.createMember(admin,"first",input);
  const original=h.users.get("+8613900001234");
  await expect(h.service.createMember(admin,"duplicate",{...input,mobile:"+8613900001234",password:"another-password"})).rejects.toMatchObject({status:409});
  expect(h.users.get(original.mobile)).toEqual(original);
  expect(h.tx.auditLog.create).toHaveBeenCalledTimes(1);
});
it("rolls the new account back if its audit cannot be recorded",async()=>{
  const h=harness(); h.tx.auditLog.create.mockRejectedValueOnce(new Error("audit unavailable"));
  await expect(h.service.createMember(admin,"audit-failure",input)).rejects.toThrow("audit unavailable");
  expect(h.users.size).toBe(0);
});
it.each(["SUPER_ADMIN","APP_OPERATIONS","HEALTH_AUDITOR","CUSTOMER_SERVICE","READ_ONLY","FINANCE"])("checks create privileges for %s",async role=>{
  const h=harness();
  const request={path:"/api/saydian-app/admin/v1/members",method:"POST",header:()=>"Bearer synthetic"};
  const db={adminSession:{findUnique:async()=>({expiresAt:new Date(Date.now()+60000),admin:{id:"admin",active:true,role,roles:[role]}})}};
  const context={getHandler:()=>AdminController.prototype.createMember,getClass:()=>AdminController,switchToHttp:()=>({getRequest:()=>request})};
  const result=new AdminAuthGuard(db as any,new Reflector()).canActivate(context as any);
  if(role==="SUPER_ADMIN") await expect(result).resolves.toBe(true);
  else { await expect(result).rejects.toThrow(); await expect(h.service.createMember({...admin,role},"forbidden",input)).rejects.toMatchObject({status:403}); expect(h.tx.user.create).not.toHaveBeenCalled(); }
});
