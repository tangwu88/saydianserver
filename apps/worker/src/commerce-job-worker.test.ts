import { describe, expect, it } from "vitest";
import { jstSign, mapJstProduct } from "./commerce-job-worker";

describe("integrated Jushuitan adapter", () => {
  it("uses the migrated deterministic signature algorithm", () => {
    expect(jstSign({ app_key: "app", timestamp: "1", biz: "{}" }, "secret"))
      .toMatch(/^[0-9a-f]{32}$/);
    expect(jstSign({ timestamp: "1", biz: "{}", app_key: "app" }, "secret"))
      .toBe(jstSign({ app_key: "app", timestamp: "1", biz: "{}" }, "secret"));
  });

  it("requires stable ERP ids and keeps unknown amounts at zero only for product prices", () => {
    expect(() => mapJstProduct({ name: "watch" })).toThrow(/identifiers/);
    expect(mapJstProduct({ i_id: "I1", sku_id: "S1", sale_price: "99.90" }))
      .toMatchObject({ erpItemId: "I1", erpSkuId: "S1", salePriceCents: 9990 });
  });
});
