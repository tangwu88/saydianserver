import { describe, expect, it } from "vitest";
import { assertAfterSaleTransition, expectedVersion, merchandiseAllocations, pointFaceValueCents, requireCommerceOwner } from "./commerce-policy";

describe("commerce action and amount rules", () => {
  it("does not allow terminal refunds to be reopened by the audit form", () => {
    expect(() => assertAfterSaleTransition("COMPLETED", "APPROVED")).toThrow();
    expect(() => assertAfterSaleTransition("APPLIED", "RETURNED")).toThrow();
    expect(() => assertAfterSaleTransition("APPLIED", "APPROVED")).not.toThrow();
    expect(() => assertAfterSaleTransition("WAITING_RETURN", "RETURNED")).not.toThrow();
  });
  it("requires a record version and completed takeover", () => {
    expect(() => expectedVersion(undefined)).toThrow();
    expect(() => expectedVersion(null)).toThrow();
    expect(() => expectedVersion(true)).toThrow();
    expect(expectedVersion(0)).toBe(0);
    expect(() => requireCommerceOwner("LEGACY_SYSTEM")).toThrow();
  });
  it("converts legacy face-value points exactly and rejects hidden fractional cents", () => {
    expect(pointFaceValueCents("19.99")).toBe(1999);
    expect(pointFaceValueCents(0.29)).toBe(29);
    expect(() => pointFaceValueCents("0.001")).toThrow();
    expect(() => pointFaceValueCents("1e3")).toThrow();
  });
  it("allocates discounts without losing cents or refunding list prices", () => {
    const values = merchandiseAllocations([{ id: "a", totalCents: 100 }, { id: "b", totalCents: 100 }, { id: "c", totalCents: 100 }], 100);
    expect([...values.values()]).toEqual([33, 33, 34]);
    expect([...values.values()].reduce((sum, amount) => sum + amount, 0)).toBe(100);
  });
});
