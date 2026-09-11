import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommerceStoreService } from "./commerce-store.service";

beforeEach(() => vi.stubEnv("APP_REALM", "global"));
afterEach(() => vi.unstubAllEnvs());
function fixture() {
  const input = { addressId: "address", items: [{ skuId: "sku", quantity: 2 }], pointCents: 100, idempotencyKey: "global-cny-order" };
  const address = { id: "address", countryCode: "CN", name: "Synthetic", mobile: "+8613800138000", province: "广东省", city: "深圳市", district: "南山区", detail: "合成收货地址", postalCode: null };
  const sku = { id: "sku", productId: "product", enabled: true, stock: 10, salePriceCents: 1001, product: { id: "product", name: "Synthetic", status: "PUBLISHED", localArchived: false } };
  let config: any = null, saved: any;
  const db: any = {
    $queryRaw: vi.fn().mockResolvedValue([{ acquired: true }]),
    user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "member" }) },
    commerceAddress: { findFirst: vi.fn().mockResolvedValue(address) },
    commerceSku: { findMany: vi.fn().mockResolvedValue([sku]), update: vi.fn() },
    commerceBusinessConfig: { findUnique: vi.fn(async ({ where }: any) => where.key === "global.markets" ? config : { enabled: true, value: { amountCents: 50 } }) },
    commercePointAccount: { findUnique: vi.fn().mockResolvedValue({ balanceCents: 1000 }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    commercePointLedger: { create: vi.fn() },
    commerceCart: { findUnique: vi.fn().mockResolvedValue({ id: "cart" }) },
    commerceCartItem: { deleteMany: vi.fn() },
    commerceOrder: { findUnique: vi.fn(async () => saved ?? null), create: vi.fn(async ({ data }: any) => saved = { id: "order", ...data }) },
  };
  db.$transaction = vi.fn(async (run: any) => run(db));
  const writes = [db.commerceSku.update, db.commercePointAccount.updateMany, db.commercePointLedger.create, db.commerceCartItem.deleteMany, db.commerceOrder.create];
  return { service: new CommerceStoreService(db), db, writes, input, address, sku, setConfig(value: any) { config = value; } };
}
describe("global CN/CNY checkout", () => {
  it("quotes integer cents and creates explicit CN/CNY snapshots; replay stays first", async () => {
    const h = fixture(), preview = await h.service.previewOrder("member", h.input);
    expect(preview.quote).toMatchObject({ subtotalCents: 2002, pointDiscountCents: 100, shippingCents: 50, payableCents: 1952 });
    const input = { ...h.input, expectedQuote: preview.quote.fingerprint };
    expect(await h.service.createOrder("member", input)).toMatchObject({ currency: "CNY", countryCode: "CN", payableCents: 1952 });
    h.address.countryCode = "US"; h.setConfig({ enabled: false, value: {} });
    expect((await h.service.createOrder("member", input)).id).toBe("order");
    for (const write of h.writes) expect(write).toHaveBeenCalledOnce();
  });
  it.each(["US", "", "cn"])("rejects unsupported/unknown persisted country %s before any assets", async country => {
    const h = fixture(); h.address.countryCode = country;
    await expect(h.service.previewOrder("member", h.input)).rejects.toMatchObject({ status: 400, response: { errorKey: "delivery_country_unsupported" } });
    await expect(h.service.createOrder("member", h.input)).rejects.toMatchObject({ status: 400, response: { errorKey: "delivery_country_unsupported" } });
    for (const write of h.writes) expect(write).not.toHaveBeenCalled();
  });
  it.each([{ enabled: false, value: {} }, { enabled: true, value: { markets: [{ countryCode: "US", currency: "USD", enabled: true }] } }])("respects explicit unavailable market configuration %j", async config => {
    const h = fixture(); h.setConfig(config);
    expect((await h.service.markets()).markets.every(market => !market.commerceEnabled)).toBe(true);
    await expect(h.service.createOrder("member", h.input)).rejects.toMatchObject({ status: 503, response: { errorKey: "market_checkout_unavailable" } });
    for (const write of h.writes) expect(write).not.toHaveBeenCalled();
  });
  it("does not infer a country or waive current stock and expectedQuote validation", async () => {
    const h = fixture(), preview = await h.service.previewOrder("member", h.input);
    h.sku.salePriceCents++;
    await expect(h.service.createOrder("member", { ...h.input, expectedQuote: preview.quote.fingerprint })).rejects.toMatchObject({ status: 409, response: { errorKey: "quote_changed" } });
    h.sku.stock = 0;
    await expect(h.service.createOrder("member", h.input)).rejects.toThrow();
    h.db.commerceAddress.findFirst.mockResolvedValue(null);
    await expect(h.service.previewOrder("member", { ...h.input, addressId: "" })).rejects.toMatchObject({ status: 400, response: { errorKey: "delivery_address_required" } });
    for (const write of h.writes) expect(write).not.toHaveBeenCalled();
  });
});
