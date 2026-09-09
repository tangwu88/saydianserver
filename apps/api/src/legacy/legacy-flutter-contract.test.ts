import "reflect-metadata";
import { RequestMethod } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { LegacyCartController, LegacyOrderController } from "./legacy-commerce.controller";
import { LegacyCommerceMapper } from "./legacy-commerce-mapper.service";
import { LegacyMemberController } from "./legacy-member.controller";
import { LegacySiteController } from "./legacy-site.controller";
import { LegacyModule } from "./legacy.module";
import { canonicalToLegacyWarnings, legacyWarningsToCanonical } from "./legacy-warning-mapper";
import { parseLegacyAppUpdate, selectLegacyAppUpdate } from "./legacy-update-contract";
import { canonicalToLegacyComposition, legacyCompositionToCanonical, legacyDailyToCanonical } from "./legacy-health-mapper";
import { buildHealthEvidence } from "../health/health-evidence";

function commerceFixture() {
  const mappings = new Map<string, number>();
  const reverse = new Map<string, string>();
  const mapper = new LegacyCommerceMapper({
    compatibilityId: async (type: string, id: string) => {
      const key = `${type}:${id}`;
      if (!mappings.has(key)) {
        mappings.set(key, mappings.size + 100);
        reverse.set(`${type}:${mappings.get(key)}`, id);
      }
      return mappings.get(key)!;
    },
    externalIdIfMapped: async (type: string, id: string) => reverse.get(`${type}:${id}`) ?? null,
  } as never);
  const cart = {
    items: ["black", "white"].map((color, i) => ({
      id: `cart-${color}`, skuId: `sku-${color}`, quantity: i + 1, available: true, selected: true,
      sku: { id: `sku-${color}`, productId: "product-watch", specification: color,
        salePriceCents: 19900, stock: 8,
        product: { id: "product-watch", name: "手表", coverImage: "https://cdn.example/watch.png" } },
    })),
  };
  const commerce = { forUser: vi.fn(async () => cart as unknown) };
  const user = { id: "member-a", sessionId: "session-a" };
  return { mapper, cart, commerce, user, controller: new LegacyCartController(commerce as never, mapper) };
}

describe("released Flutter fa79aa3 legacy contracts", () => {
  it("registers all eight formerly missing routes with their released methods", () => {
    const expected: Array<[Function, string, RequestMethod, string]> = [
      [LegacyCartController, "index", RequestMethod.GET, "api/inv-shop/v1/member/cart-item/index"],
      [LegacyCartController, "create", RequestMethod.POST, "api/inv-shop/v1/member/cart-item/create"],
      [LegacyCartController, "updateNumber", RequestMethod.POST, "api/inv-shop/v1/member/cart-item/update-num"],
      [LegacyCartController, "deleteIds", RequestMethod.POST, "api/inv-shop/v1/member/cart-item/delete-ids"],
      [LegacyMemberController, "warningSettings", RequestMethod.GET, "api/v1/member/health-warning/preview"],
      [LegacyMemberController, "saveWarningSettings", RequestMethod.POST, "api/v1/member/health-warning"],
      [LegacyMemberController, "feedback", RequestMethod.POST, "api/v1/member/feedback"],
      [LegacySiteController, "version", RequestMethod.GET, "api/v1/site/version"],
    ];
    const controllers = Reflect.getMetadata("controllers", LegacyModule);
    for (const [controller, name, method, path] of expected) {
      expect(controllers).toContain(controller);
      expect(Reflect.getMetadata("method", controller.prototype[name])).toBe(method);
      expect(`${Reflect.getMetadata("path", controller)}/${Reflect.getMetadata("path", controller.prototype[name])}`).toBe(path);
    }
  });

  it("returns the integer cart IDs and SKU IDs that the Flutter checkout sends back", async () => {
    const { mapper, cart, controller, user } = commerceFixture();
    const response = await controller.index(user);
    expect(response.code).toBe(200);
    expect(response.data).toHaveLength(2);
    expect(response.data[0]).toMatchObject({ id: expect.any(Number), cart_item_id: response.data[0]!.id, sku_id: expect.any(Number), product_id: expect.any(Number), num: 1, quantity: 1, price: 199 });
    for (const row of response.data) for (const id of [row.id, row.sku_id, row.product_id]) expect(Number.isSafeInteger(id) && id > 0).toBe(true);
    expect(JSON.stringify(response.data)).not.toContain("sku-black");
    const normalized = await mapper.orderRequest({ type: "cart", data: response.data.map((row) => row.id).join(",") }, cart);
    expect(normalized.items).toEqual([{ skuId: "sku-black", quantity: 1 }, { skuId: "sku-white", quantity: 2 }]);
    await expect(mapper.orderRequest({ type: "cart", data: response.data[0]!.id }, { items: [] })).rejects.toThrow("不属于当前账号");
    await expect(mapper.orderRequest({ type: "cart", data: "100,,103" }, cart)).rejects.toThrow("编号不正确");
    await expect(mapper.orderRequest({ type: "cart", data: response.data[0]!.id }, { items: [{ ...cart.items[0], available: false }] })).rejects.toThrow("库存不足");
  });

  it("maps add, set and delete-by-SKU without confusing SKU and cart row IDs", async () => {
    const { mapper, cart, commerce, controller, user } = commerceFixture();
    const [first] = await mapper.cart(cart);
    await controller.create(user, { sku_id: String(first!.sku_id), num: "2" });
    expect(commerce.forUser).toHaveBeenLastCalledWith(user.id, "POST", "/cart/items", { skuId: "sku-black", quantity: 2, mode: "increment" });
    await controller.updateNumber(user, { sku_id: String(first!.sku_id), num: "3" });
    expect(commerce.forUser).toHaveBeenLastCalledWith(user.id, "POST", "/cart/items", { skuId: "sku-black", quantity: 3, mode: "set" });
    await controller.deleteIds(user, { sku_ids: String(first!.sku_id) });
    expect(commerce.forUser).toHaveBeenCalledWith(user.id, "DELETE", "/cart/items/cart-black");
    for (const num of ["0", "-1", "1.5", "1000", "", null]) {
      await expect(controller.create(user, { sku_id: first!.sku_id, num })).rejects.toThrow("商品数量");
    }
  });

  it("passes user-scoped cart rows into order preview and maps refund yuan exactly to cents", async () => {
    const { mapper, cart, commerce, user } = commerceFixture();
    const [first] = await mapper.cart(cart);
    const order = new LegacyOrderController(commerce as never, mapper);
    commerce.forUser.mockImplementation(async (_user?: unknown, _method?: unknown, path?: unknown) => path === "/cart" ? cart : { products: [] });
    await order.preview(user, { type: "cart", data: String(first!.id), is_channel: "0" });
    expect(commerce.forUser).toHaveBeenLastCalledWith(user.id, "POST", "/orders/preview", { addressId: "", items: [{ skuId: "sku-black", quantity: 1 }] });
    expect(mapper.refundRequest({ refund_type: "2", refund_require_money: "12.30", refund_reason: "申请退货" }, "item-id")).toEqual({
      type: "RETURN_REFUND", requestedCents: 1230, reason: "申请退货", orderItemId: "item-id",
    });
    for (const amount of ["0", "-1", "1.001", "1e2", "NaN"]) {
      expect(() => mapper.refundRequest({ refund_type: 1, refund_require_money: amount, refund_reason: "退款" }, "item-id")).toThrow();
    }
  });

  it("translates feedback form fields and preserves provider/storage failures", async () => {
    const support = { createFeedback: vi.fn(async () => ({ id: "feedback-id", status: "open" })) };
    const controller = new LegacyMemberController({} as never, {} as never, {} as never, {} as never, {} as never, support as never, {} as never);
    expect(await controller.feedback({ id: "member-a", sessionId: "session-a" }, { type: "device", content: "蓝牙同步发生异常", contact: "example" })).toMatchObject({ code: 200, data: { id: "feedback-id" } });
    expect(support.createFeedback).toHaveBeenCalledWith("member-a", { category: "device", content: "蓝牙同步发生异常", contact: "example", attachments: undefined });
    support.createFeedback.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(controller.feedback({ id: "member-a", sessionId: "session-a" }, {})).rejects.toThrow("database unavailable");
  });
});

describe("legacy warning preservation", () => {
  it("returns disabled client defaults and preserves unexposed thresholds and sharing", () => {
    expect(canonicalToLegacyWarnings([])).toEqual({ heart_auto: 0, heart_num: 120, blood_pressure_auto: 0, blood_glucose_auto: 0, body_temperature_auto: 0 });
    const previous = [{ metric: "blood_glucose", enabled: true, lowThreshold: 3.2, highThreshold: 8.1, shareWithCare: true }];
    const request = legacyWarningsToCanonical({ heart_auto: "1", heart_num: "125", blood_glucose_auto: "1" }, previous);
    expect(request.rules).toContainEqual({ metric: "blood_glucose", enabled: true, lowThreshold: 3.2, highThreshold: 8.1, secondaryHighThreshold: null, shareWithCare: true });
    expect(request.rules).toContainEqual({ metric: "heart_rate", enabled: true, lowThreshold: null, highThreshold: 125, secondaryHighThreshold: null, shareWithCare: false });
    expect(() => legacyWarningsToCanonical({ blood_glucose_auto: "1" }, [])).toThrow("先配置");
    expect(() => legacyWarningsToCanonical({ heart_num: "wrong" }, [])).toThrow("阈值");
  });
});

describe("production legacy update contract", () => {
  const input = { schemaVersion: 1, audience: "production", releases: [
    { platform: "android", version: 24, version_code: "0.1.20", lowwer: 22, force: 1, status: 1, android_type: 1, android: "/down/files/app.apk", sha256: "a".repeat(64) },
    { platform: "ios", version: 24, version_code: "0.1.20", lowwer: 20, force: 0, status: 1, ios: "https://apps.apple.com/cn/app/id123456789" },
  ] };
  it("keeps released spellings and returns null only when a valid config has no newer release", () => {
    const config = parseLegacyAppUpdate(input);
    expect(selectLegacyAppUpdate(config, "android", "21")).toMatchObject({ version: 24, version_code: "0.1.20", lowwer: 22, force: 1, android_type: 1 });
    expect(selectLegacyAppUpdate(config, "android", "24")).toBeNull();
    expect(selectLegacyAppUpdate(config, "ios", "23")).toHaveProperty("ios", "https://apps.apple.com/cn/app/id123456789");
    expect(() => selectLegacyAppUpdate(config, "android", "bad")).toThrow();
  });
  it("rejects QA downloads, unsafe links, missing hashes and impossible forced-update floors", () => {
    expect(() => parseLegacyAppUpdate({ ...input, audience: "internal_test" })).toThrow();
    for (const patch of [{ android: "http://example.com/app.apk" }, { android: "//evil.example/app.apk" }, { sha256: "" }, { lowwer: 25 }]) {
      expect(() => parseLegacyAppUpdate({ ...input, releases: [{ ...input.releases[0], ...patch }] })).toThrow();
    }
    expect(() => parseLegacyAppUpdate({ ...input, releases: [{ ...input.releases[1], ios: "https://testflight.apple.com/join/test" }] })).toThrow();
  });
});

describe("old health uploads feed the unified report evidence", () => {
  it("keeps both stored historical and newly normalized sleep/body/blood composition usable", () => {
    const [sleep] = legacyDailyToCanonical([{ date: "2026-09-03 08:00:00", sleepData: { allSleepTime: 420, deepSleepTime: 100, lowSleepTime: 320 } }], "legacy-daily");
    const body = legacyCompositionToCanonical("body_composition", { BMI: 22.3, bodyFatRate: 21.2 });
    const blood = legacyCompositionToCanonical("blood_composition", { uricAcidVal: 310, cholesterol: 4.5 });
    expect(body).toEqual({ bmi: 22.3, bodyFatPercent: 21.2 });
    expect(canonicalToLegacyComposition("body_composition", body)).toMatchObject({ BMI: 22.3, bodyFatRate: 21.2 });
    const records = [
      { metric: "SLEEP", values: { value: 420 } },
      { metric: "SLEEP", values: sleep!.values },
      { metric: "BODY_COMPOSITION", values: { BMI: 22.3 } },
      { metric: "BODY_COMPOSITION", values: body },
      { metric: "BLOOD_COMPOSITION", values: { uricAcidVal: 310 } },
      { metric: "BLOOD_COMPOSITION", values: blood },
    ].map((record, i) => ({ ...record, id: String(i), observedAt: new Date("2026-09-03T00:00:00Z"), timezoneOffsetMinutes: 480, quality: "UNKNOWN" }));
    expect(buildHealthEvidence(records).validRecordIds).toHaveLength(6);
    expect(legacyCompositionToCanonical("body_composition", { BMI: null, bodyFatRate: "" })).toEqual({ bmi: null, bodyFatPercent: null });
  });
});
