import { describe, expect, it } from "vitest";
import { globalAddress, globalMarkets } from "./global-commerce-policy";

describe("global delivery and currency boundaries", () => {
  it("accepts international contacts without requiring Chinese province and district", () => {
    expect(globalAddress({ countryCode: "us", name: "Synthetic Recipient", phone: "+1 202 555 0123", addressLine1: "123 Test Street", postalCode: "20001" })).toMatchObject({ countryCode: "US", mobile: "+12025550123", province: "", city: "", district: "", postalCode: "20001" });
  });
  it("does not accept a domestic-format phone or guessed country", () => {
    expect(() => globalAddress({ countryCode: "ZZ", name: "Test", phone: "+12025550123", detail: "Test" })).toThrow("country");
    expect(() => globalAddress({ countryCode: "US", name: "Test", phone: "13800138000", detail: "Test" })).toThrow("international");
  });
  it("preserves currency exponents rather than dividing every amount by 100", () => {
    expect(globalMarkets({ markets: [{ countryCode: "JP", currency: "JPY", enabled: true }, { countryCode: "KW", currency: "KWD", enabled: true }, { countryCode: "US", currency: "USD", enabled: true }] }).map(item => [item.currency, item.currencyExponent])).toEqual([["JPY", 0], ["KWD", 3], ["USD", 2]]);
  });
  it("never advertises unimplemented market checkout or duplicate/disabled/invalid markets", () => {
    const result = globalMarkets({ markets: [{ countryCode: "US", currency: "USD", enabled: true, commerceEnabled: true, paymentChannels: ["card"] }, { countryCode: "US", currency: "CNY", enabled: true }, { countryCode: "DE", currency: "EUR", enabled: false }, { countryCode: "JP", currency: "ZZZ", enabled: true }] });
    expect(result).toEqual([{ countryCode: "US", currency: "USD", currencyExponent: 2, commerceEnabled: false, paymentChannels: [] }]);
  });
});
