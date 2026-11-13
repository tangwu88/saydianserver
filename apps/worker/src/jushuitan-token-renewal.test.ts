import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { jstDay, type JstRenewal } from "@saydian/app-contracts";
import { JushuitanTokenRenewal, renewalSign } from "./jushuitan-token-renewal";
import { encryptWorkerSecrets, decryptWorkerSecrets } from "./integration-secrets";
beforeEach(() => { process.env.INTEGRATION_MASTER_KEY = "ab".repeat(32); });
function fixture() {
 let now = Date.parse("2026-01-28T00:00:00Z");
 let value: JstRenewal = { enabled: true, status: "READY", message: "", issuedAt: "2026-01-01T00:00:00Z", expiresAt: "2026-01-31T00:00:00Z", nextAttemptAt: "2026-01-28T00:00:00Z" };
 let secret = encryptWorkerSecrets("jushuitan", { appKey: "synthetic-key", appSecret: "synthetic-secret", accessToken: "old-access", refreshToken: "old-refresh", other: "preserved" });
 value.secretVersion = createHash("sha256").update(secret.ciphertext).digest("hex");
 const db: any = { appSetting: { findUnique: vi.fn(async () => ({ value })), update: vi.fn(async ({ data }) => { value = structuredClone(data.value); }) }, integrationConfig: { findUnique: vi.fn(async () => ({ state: "CONFIGURED" })) }, integrationSecret: { findUnique: vi.fn(async () => ({ ...secret })), update: vi.fn(async ({ data }) => { secret = data; }) }, auditLog: { create: vi.fn() }, $queryRaw: vi.fn() };
 // Serialize transactions like the production row lock; provider work runs outside them.
 let tail = Promise.resolve();
 db.$transaction = (fn: any) => { const result = tail.then(() => fn(db)); tail = result.catch(() => {}); return result; };
 const request = vi.fn(async (..._args: any[]) => new Response(JSON.stringify({ code: 0, data: { access_token: "new-access", refresh_token: "new-refresh", expires_in: 2592000 } })));
 const worker = () => new JushuitanTokenRenewal(db, request, () => now);
 return { db, worker, request, state: () => value, stored: () => decryptWorkerSecrets("jushuitan", secret), set: (patch: Partial<JstRenewal>) => Object.assign(value, patch), tick: () => { now += 121000; } };
}
it("matches the official authorization signature example (prefix secret only)", () => {
 expect(renewalSign({ app_key: "5b53060f23d84ddf9703056e84fa5a2d", timestamp: "1639128407", grant_type: "authorization_code", charset: "utf-8", code: "123456" }, "e9c5ca33fecb404b8e6cdbd0ef4a6d25")).toBe("05e3a51e19e0883afd1882ccd309e0b9");
});
it("claims durably before HTTP and atomically encrypts both returned tokens while preserving credentials", async () => {
 const h = fixture(); const original = h.request.getMockImplementation()!;
 h.request.mockImplementation(async (...args) => { expect(h.state().status).toBe("RUNNING"); expect(args[0]).toBe("https://openapi.jushuitan.com/openWeb/auth/refreshToken"); expect(String(args[1].body)).toContain("grant_type=refresh_token"); return original(...args); });
 await h.worker().runOnce();
 expect(h.stored()).toMatchObject({ accessToken: "new-access", refreshToken: "new-refresh", appSecret: "synthetic-secret", other: "preserved" });
 expect(h.state().status).toBe("READY"); expect(h.state().renewedAt).toBeDefined();
 expect(JSON.stringify(h.db.auditLog.create.mock.calls)).not.toMatch(/new-access|new-refresh|synthetic-secret/);
});
it("only one of two workers requests rotation", async () => {
 const h = fixture(); await Promise.all([h.worker().runOnce(), h.worker().runOnce()]); expect(h.request).toHaveBeenCalledOnce();
});
it.each(["expired", "early", "disabled"])("never requests when %s", async kind => {
 const h = fixture(); h.set(kind === "expired" ? { expiresAt: "2026-01-27T00:00:00Z" } : kind === "early" ? { issuedAt: "2026-01-27T00:00:00Z" } : { enabled: false }); await h.worker().runOnce(); expect(h.request).not.toHaveBeenCalled();
});
it("stops after a timeout without leaking an exception or retrying a possibly completed rotation", async () => {
 const h = fixture(); h.request.mockRejectedValue(new Error("synthetic-secret new-access")); await h.worker().runOnce(); expect(h.state()).toMatchObject({ enabled: false, status: "CHECK_REQUIRED" }); h.tick(); await h.worker().runOnce(); expect(h.request).toHaveBeenCalledOnce(); expect(JSON.stringify(h.state())).not.toContain("synthetic-secret"); expect(h.stored().accessToken).toBe("old-access");
});
it("does not overwrite credentials edited during the provider request", async () => {
 const h = fixture(), original = h.request.getMockImplementation()!;
 h.request.mockImplementation(async (...args) => { await h.db.integrationSecret.update({ data: encryptWorkerSecrets("jushuitan", { accessToken: "admin-new", refreshToken: "admin-refresh" }) }); return original(...args); });
 await h.worker().runOnce(); expect(h.stored().accessToken).toBe("admin-new"); expect(h.state().enabled).toBe(false);
});
it("retains a valid short-lived returned pair and halts scheduling instead of losing the rotated credentials", async () => {
 const h = fixture(); h.request.mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { access_token: "short-access", refresh_token: "short-refresh", expires_in: 86400 } })));
 await h.worker().runOnce(); expect(h.stored()).toMatchObject({ accessToken: "short-access", refreshToken: "short-refresh" }); expect(h.state()).toMatchObject({ enabled: false, status: "CHECK_REQUIRED" });
});
