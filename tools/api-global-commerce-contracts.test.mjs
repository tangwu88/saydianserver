import assert from "node:assert/strict";
import { test } from "node:test";
import { fieldContracts } from "./api-field-contracts.mjs";

test("international markets document supported CN/CNY without claiming real payment readiness", () => {
  const contract = fieldContracts["CommerceController.markets"];
  assert.deepEqual(contract.responseExample, { markets: [{ countryCode: "CN", currency: "CNY", currencyExponent: 2, commerceEnabled: true, paymentChannels: [] }] });
  const fields = contract.responseSchema.properties.markets.items.properties;
  assert.deepEqual(fields.commerceEnabled, { type: "boolean" });
  assert.equal(fields.currencyExponent.type, "integer");
  assert.equal(fields.paymentChannels.type, "array");
});
