import { describe, it, expect, vi } from "vitest";
import { CnCycleService } from "./cn-cycle.service";
import { CnCycleController } from "./cn-cycle.controller";
import { createHash } from "node:crypto";
describe("CN cycle boundaries", () => {
  it.each([true, "true", null])(
    "hidden or invalid AI flag %s prevents use of configured provider",
    async (hideAi) => {
      const integration = vi.fn(async ({ where }: any) => {
        expect(where.key).toBe("saydian_cn_cycle_ai");
        return {
          state: "CONFIGURED",
          publicConfig: {
            baseUrl: "https://api.openai.com/v1",
            cycleAiEnabled: true,
            cycleNoticeVersion: "v1",
          },
        };
      });
      const document = vi.fn(async () => [
        { locale: "zh-Hans", version: "v1" },
      ]);
      const svc = new CnCycleService(
        {
          globalLegalDocument: { findMany: document },
          consentRecord: { findFirst: async () => null },
          integrationConfig: { findUnique: integration },
          appSetting: { findFirst: async () => ({ value: { hideAi } }) },
        } as never,
        {} as never,
      );
      const result = await svc.aiAvailability("owner");
      expect(result.available).toBe(false);
      expect(document.mock.calls[0]).toBeDefined();
      expect(JSON.stringify(document.mock.calls)).toContain(
        "saydian_cn_cycle_ai_analysis",
      );
    },
  );
  it("wrong owner does not touch service on read, write, consent or erase", () => {
    const svc = {
      changes: vi.fn(),
      sync: vi.fn(),
      consent: vi.fn(),
      erase: vi.fn(),
    };
    const c = new CnCycleController(svc as never),
      u = { id: "synthetic" } as never;
    for (const op of [
      () => c.changes(u, "wrong"),
      () => c.sync(u, { ownerHash: "wrong" }),
      () => c.consent(u, { ownerHash: "wrong" }),
      () => c.erase(u, { ownerHash: "wrong", confirmed: true }),
    ])
      expect(op).toThrow();
    expect(svc.changes).not.toHaveBeenCalled();
    expect(svc.sync).not.toHaveBeenCalled();
    expect(svc.consent).not.toHaveBeenCalled();
    expect(svc.erase).not.toHaveBeenCalled();
    c.changes(
      u,
      createHash("sha256")
        .update("saydian-health-owner:member:synthetic")
        .digest("hex"),
    );
    expect(svc.changes).toHaveBeenCalledOnce();
  });
});
