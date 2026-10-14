import { describe, expect, it } from "vitest";
import {
  clearCheckout,
  readCheckout,
  saveCheckout,
  type PendingCheckout,
} from "./checkout-recovery";
function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
const pending: PendingCheckout = {
  partnerId: "partner-A",
  input: {
    idempotencyKey: "original-request",
    expectedQuote: "a".repeat(64),
    items: [{ skuId: "sku", quantity: 2 }],
    address: {
      recipientName: "合成收货人",
      recipientMobile: "19900000000",
      province: "测试省",
      city: "测试市",
      addressDetail: "测试地址",
    },
  },
  quote: {
    lines: [],
    levelId: "level",
    level: "战略合作",
    currency: "CNY",
    subtotalCents: 1200,
    shippingCents: 0,
    payableCents: 1200,
    fingerprint: "a".repeat(64),
  },
};
describe("balance checkout recovery", () => {
  it("retains one exact money request across reloads and repeated reads", () => {
    const store = storage();
    saveCheckout(store, pending);
    expect(readCheckout(store, "partner-A")).toEqual(pending);
    expect(readCheckout(store, "partner-A")?.input.idempotencyKey).toBe(
      "original-request",
    );
  });
  it("does not give a different partner the request or erase the original owner's recovery", () => {
    const store = storage();
    saveCheckout(store, pending);
    expect(readCheckout(store, "partner-B")).toBeNull();
    clearCheckout(store, "partner-B", "original-request");
    expect(readCheckout(store, "partner-A")).toEqual(pending);
  });
  it("only the completed matching request clears recovery", () => {
    const store = storage();
    saveCheckout(store, pending);
    clearCheckout(store, "partner-A", "different-request");
    expect(readCheckout(store, "partner-A")).not.toBeNull();
    clearCheckout(store, "partner-A", "original-request");
    expect(readCheckout(store, "partner-A")).toBeNull();
  });
  it("rejects a corrupted price fingerprint without reusing money input", () => {
    const store = storage();
    saveCheckout(store, {
      ...pending,
      input: { ...pending.input, expectedQuote: "b".repeat(64) },
    });
    expect(readCheckout(store, "partner-A")).toBeNull();
  });
});
