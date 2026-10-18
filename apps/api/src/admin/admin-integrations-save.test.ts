import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminService } from "./admin.service";
import {
  IntegrationSecretsService,
  decryptIntegrationSecrets,
  encryptIntegrationSecrets,
} from "../common/integration-secrets.service";

const masterKey = Buffer.alloc(32, 9);
function harness() {
  vi.stubEnv("INTEGRATION_MASTER_KEY", masterKey.toString("hex"));
  let stored = {
    config: {
      key: "ai",
      state: "CONFIGURED",
      publicConfig: { model: "old-model" },
    },
    secret: {
      integrationKey: "ai",
      ...encryptIntegrationSecrets(
        "ai",
        { apiKey: "synthetic-old-key" },
        masterKey,
      ),
    },
  };
  const before = structuredClone(stored);
  const secretWrite = vi.fn();
  const db = {
    $transaction: vi.fn(async (run: (tx: any) => Promise<unknown>) => {
      const pending = structuredClone(stored);
      const result = await run({
        integrationConfig: {
          upsert: async ({ update }: any) =>
            (pending.config = { key: "ai", ...update }),
        },
        integrationSecret: {
          upsert: async ({ create }: any) => {
            secretWrite();
            pending.secret = create;
          },
          findUnique: async () => pending.secret,
          deleteMany: async () => {
            pending.secret = null as any;
          },
        },
      });
      stored = pending;
      return result;
    }),
  };
  const secrets = new IntegrationSecretsService(db as any);
  return {
    service: new AdminService(db as any, secrets),
    db,
    secretWrite,
    before,
    read: () => stored,
  };
}
afterEach(() => vi.unstubAllEnvs());
describe("atomic integration configuration save", () => {
  it("stores credentials, public fields and enabled state in one transaction without returning a credential", async () => {
    const h = harness();
    const result = await h.service.updateIntegration("ai", {
      state: "CONFIGURED",
      publicConfig: { model: "qwen3.8-flash" },
      secrets: { apiKey: "synthetic-new-key" },
    });
    expect(h.db.$transaction).toHaveBeenCalledTimes(1);
    expect(h.read().config).toMatchObject({
      state: "CONFIGURED",
      publicConfig: { model: "qwen3.8-flash" },
      lastCheckedAt: null,
      lastError: null,
    });
    expect(decryptIntegrationSecrets("ai", h.read().secret, masterKey)).toEqual(
      { apiKey: "synthetic-new-key" },
    );
    expect(result).toMatchObject({
      hasSecret: true,
      verificationStatus: "PENDING",
    });
    expect(JSON.stringify(result)).not.toMatch(
      /synthetic-new-key|ciphertext|authTag/,
    );
  });
  it("keeps the original credential untouched when only public parameters are edited", async () => {
    const h = harness();
    await h.service.updateIntegration("ai", {
      state: "DISABLED",
      publicConfig: { model: "qwen3.8-flash" },
    });
    expect(h.secretWrite).not.toHaveBeenCalled();
    expect(h.read().secret).toEqual(h.before.secret);
    expect(h.read().config.state).toBe("DISABLED");
  });
  it("does not commit public changes or enablement when the credential write fails", async () => {
    const h = harness();
    h.secretWrite.mockImplementationOnce(() => {
      throw new Error("synthetic persistence failure");
    });
    await expect(
      h.service.updateIntegration("ai", {
        state: "CONFIGURED",
        publicConfig: { model: "qwen3.8-flash" },
        secrets: { apiKey: "synthetic-new-key" },
      }),
    ).rejects.toThrow("synthetic persistence failure");
    expect(h.read()).toEqual(h.before);
  });
  it("rejects invalid credentials before opening a transaction", async () => {
    const h = harness();
    await expect(
      h.service.updateIntegration("ai", {
        state: "CONFIGURED",
        publicConfig: { model: "changed" },
        secrets: {},
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(h.db.$transaction).not.toHaveBeenCalled();
    expect(h.read()).toEqual(h.before);
  });
  it("fails without changing configuration when credential encryption is unavailable", async () => {
    const h = harness();
    vi.stubEnv("INTEGRATION_MASTER_KEY", "");
    await expect(
      h.service.updateIntegration("ai", {
        state: "CONFIGURED",
        secrets: { apiKey: "synthetic-new-key" },
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(h.db.$transaction).not.toHaveBeenCalled();
    expect(h.read()).toEqual(h.before);
  });
});
