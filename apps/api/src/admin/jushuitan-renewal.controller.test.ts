import "reflect-metadata";
import { beforeEach, expect, it, vi } from "vitest";
import { JushuitanRenewalController } from "./jushuitan-renewal.controller";
import { IntegrationSecretsService, encryptIntegrationSecrets, decryptIntegrationSecrets } from "../common/integration-secrets.service";
beforeEach(() => { process.env.INTEGRATION_MASTER_KEY = "ab".repeat(32); });
function fixture() {
 let value: any = undefined;
 let encrypted = encryptIntegrationSecrets("jushuitan", { appKey: "synthetic-key", appSecret: "synthetic-secret", shopId: "123" }, Buffer.from("ab".repeat(32), "hex"));
 const db: any = { $queryRaw: vi.fn(), integrationConfig: { findUnique: vi.fn(async () => ({ state: "CONFIGURED" })) }, appSetting: { findUnique: vi.fn(async () => value ? { value } : null), upsert: vi.fn(async ({ create }) => { value = create.value; }) }, integrationSecret: { findUnique: vi.fn(async () => encrypted), upsert: vi.fn(async ({ update }) => { encrypted = update; }) } };
 db.$transaction = (fn: any) => fn(db);
 const service = new JushuitanRenewalController(db, new IntegrationSecretsService(db));
 const now = Date.now(), body = { enabled: true, issuedAt: new Date(now - 86400000).toISOString(), expiresAt: new Date(now + 29 * 86400000).toISOString(), accessToken: "synthetic-access", refreshToken: "synthetic-refresh" };
 return { service, db, body, set: (v: any) => { value = v; }, secret: () => decryptIntegrationSecrets("jushuitan", encrypted, Buffer.from("ab".repeat(32), "hex")) };
}
it("limits configuration to integration and super admins while allowing ERP read roles", () => {
 expect(Reflect.getMetadata("saydian.admin-roles", JushuitanRenewalController.prototype.configure)).toEqual(["SUPER_ADMIN", "INTEGRATION_ADMIN"]);
 expect(Reflect.getMetadata("saydian.admin-roles", JushuitanRenewalController.prototype.status)).toContain("READ_ONLY");
});
it("stores tokens encrypted, preserves existing credentials, and returns only non-secret scheduling metadata", async () => {
 const h = fixture(); await h.service.configure(h.body);
 expect(h.secret()).toMatchObject({ appKey: "synthetic-key", shopId: "123", accessToken: "synthetic-access", refreshToken: "synthetic-refresh" });
 expect(JSON.stringify(await h.service.status())).not.toMatch(/synthetic-access|synthetic-refresh|synthetic-secret/);
 expect(h.db.appSetting.upsert.mock.calls[0]![0].create.public).toBe(false);
});
it("rejects invalid, expired or partial authorization without changing credentials", async () => {
 const h = fixture();
 for (const patch of [{ refreshToken: "" }, { expiresAt: "2020-01-01" }, { issuedAt: "invalid" }, { enabled: "true" }, { unexpected: "value" }]) await expect(h.service.configure({ ...h.body, ...patch })).rejects.toThrow();
 expect(h.db.integrationSecret.upsert).not.toHaveBeenCalled();
});
it("does not allow disable/re-enable to bypass reauthorization after an uncertain rotation", async () => {
 const h = fixture(); h.set({ ...h.body, status: "CHECK_REQUIRED" });
 await h.service.configure({ enabled: false }); await expect(h.service.configure({ enabled: true })).rejects.toThrow();
});
it("rejects writes while a token rotation is actively in flight", async () => {
 const h = fixture(); h.set({ status: "RUNNING", attemptedAt: new Date().toISOString() });
 await expect(h.service.configure(h.body)).rejects.toThrow(/正在续期/);
});
