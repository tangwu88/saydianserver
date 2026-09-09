import { afterEach, describe, expect, it, vi } from "vitest";
import { SupportService } from "./support.service";
import type { PrismaService } from "../common/prisma.service";
import type { IntegrationSecretsService } from "../common/integration-secrets.service";

const unavailable = { configured: false, message: "客服渠道暂时无法使用，请稍后再试" };
afterEach(() => vi.unstubAllEnvs());
function harness(rows: Array<{ key: string; public: boolean; value: unknown }>) {
  const findFirst = vi.fn(async ({ where, select }: any) => {
    const row = rows.find(item => item.key === where.key && item.public === where.public);
    return row && select.value ? { value: row.value } : null;
  });
  const findUnique = vi.fn(() => { throw new Error("Unfiltered settings read must not be used"); });
  const secrets = { resolve: vi.fn() };
  const service = new SupportService(
    { appSetting: { findFirst, findUnique } } as unknown as PrismaService,
    secrets as unknown as IntegrationSecretsService,
  );
  return { service, findFirst, findUnique, secrets };
}
describe("public support configuration boundary", () => {
  it("does not reuse domestic support settings in the global account deployment", async () => {
    vi.stubEnv("APP_REALM", "global");
    const h = harness([{ key: "support", public: true, value: { configured: true } }]);
    expect(await h.service.supportConfig()).toEqual({ configured: false, message: "Support is temporarily unavailable. Please try again later." });
    expect(h.findFirst).toHaveBeenCalledWith({ where: { key: "global_support", public: true }, select: { value: true } });
  });
  it("filters by both exact support key and explicit publication at the database boundary", async () => {
    const h = harness([]);
    expect(await h.service.supportConfig()).toEqual(unavailable);
    expect(h.findFirst).toHaveBeenCalledWith({ where: { key: "support", public: true }, select: { value: true } });
    expect(h.findUnique).not.toHaveBeenCalled(); expect(h.secrets.resolve).not.toHaveBeenCalled();
  });
  it("never even loads a non-public support JSON value", async () => {
    let privateValueReads = 0;
    const privateRow = { key: "support", public: false, get value() {
      privateValueReads++;
      return { internalNote: "SYSTEM-QA-private-only", configured: true };
    } };
    const h = harness([privateRow]);
    expect(await h.service.supportConfig()).toEqual(unavailable);
    expect(privateValueReads).toBe(0);
  });
  it("preserves the published support contract", async () => {
    const value = { configured: true, message: "SYSTEM-QA-public-help", serviceHours: "SYSTEM-QA" };
    const h = harness([{ key: "support", public: true, value }]);
    expect(await h.service.supportConfig()).toEqual(value);
  });
  it("does not return another setting even when that setting is public", async () => {
    const h = harness([{ key: "another-setting", public: true, value: { internalNote: "SYSTEM-QA-other-setting" } }]);
    expect(await h.service.supportConfig()).toEqual(unavailable);
  });
  it("fails closed to the normal unavailable value for a null published payload", async () => {
    const h = harness([{ key: "support", public: true, value: null }]);
    expect(await h.service.supportConfig()).toEqual(unavailable);
  });
});
