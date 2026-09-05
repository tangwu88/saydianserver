import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptIntegrationSecrets,
  encryptIntegrationSecrets,
} from "./integration-secrets.service";

describe("integration secret encryption", () => {
  it("round-trips values without storing plaintext", () => {
    const key = randomBytes(32);
    const encrypted = encryptIntegrationSecrets(
      "wechat_pay",
      { merchantId: "1900000001", privateKeyPem: "private-value" },
      key,
    );
    expect(encrypted.ciphertext).not.toContain("private-value");
    expect(decryptIntegrationSecrets("wechat_pay", encrypted, key)).toEqual({
      merchantId: "1900000001",
      privateKeyPem: "private-value",
    });
  });

  it("binds ciphertext to its integration key", () => {
    const key = randomBytes(32);
    const encrypted = encryptIntegrationSecrets("alipay", { secret: "value" }, key);
    expect(() => decryptIntegrationSecrets("wechat_pay", encrypted, key)).toThrow();
  });
});
