import { describe, expect, it } from "vitest";
import { appleTransactionValidationError } from "./apple-iap.service";

const expected = {
  accountToken: "97ff598c-1a97-4cf7-a18d-e51b5f70710e",
  productId: "cn.saydian.health.report.single",
  amountCents: 990,
  currency: "CNY",
};

describe("Apple IAP transaction binding", () => {
  it("accepts a signed payload only when product, account and amount match", () => {
    expect(
      appleTransactionValidationError(
        {
          transactionId: "2000000123456789",
          productId: expected.productId,
          appAccountToken: expected.accountToken,
          currency: "CNY",
          price: 9900,
          quantity: 1,
        },
        expected,
      ),
    ).toBeNull();
  });

  it("rejects cross-account and cross-offer replay", () => {
    expect(
      appleTransactionValidationError(
        {
          transactionId: "2000000123456789",
          productId: "cn.saydian.health.membership",
          appAccountToken: "b3f053e7-7a30-4f21-901f-3cd04c8a5c11",
          currency: "CNY",
          price: 9900,
        },
        expected,
      ),
    ).toBe("product_mismatch");
  });

  it("rejects revoked and price-mismatched transactions", () => {
    expect(
      appleTransactionValidationError(
        {
          transactionId: "2000000123456789",
          productId: expected.productId,
          appAccountToken: expected.accountToken,
          currency: "CNY",
          price: 100,
          revocationDate: Date.now(),
        },
        expected,
      ),
    ).toBe("transaction_revoked");
    expect(
      appleTransactionValidationError(
        {
          transactionId: "2000000123456789",
          productId: expected.productId,
          appAccountToken: expected.accountToken,
          currency: "CNY",
          price: 100,
        },
        expected,
      ),
    ).toBe("price_mismatch");
  });
});
