import { describe, expect, it, vi } from "vitest";
import { CommerceController } from "./commerce.controller";
import { CommerceService } from "./commerce.service";

describe("international App V2 commerce", () => {
  it("adds only configured open-market currency metadata to catalog prices", async () => {
    const store = {
      markets: vi.fn().mockResolvedValue({
        markets: [
          {
            countryCode: "CN",
            currency: "CNY",
            currencyExponent: 2,
            commerceEnabled: true,
          },
        ],
      }),
      listProducts: vi.fn().mockResolvedValue({
        items: [{ id: "product", priceCents: 12345 }],
        total: 1,
        page: 1,
        pageSize: 20,
      }),
      product: vi.fn().mockResolvedValue({
        id: "product",
        skus: [{ id: "sku", salePriceCents: 12345 }],
      }),
      bootstrap: vi.fn(),
    };
    const service = new CommerceService(
      {} as never,
      store as never,
      {} as never,
    );

    await expect(
      service.publicGet("/storefront/products?page=1"),
    ).resolves.toMatchObject({
      items: [
        {
          id: "product",
          priceCents: 12345,
          currency: "CNY",
          currencyExponent: 2,
          countryCode: "CN",
        },
      ],
    });
    await expect(
      service.publicGet("/storefront/products/product"),
    ).resolves.toMatchObject({
      id: "product",
      priceCents: 12345,
      currency: "CNY",
      currencyExponent: 2,
      skus: [
        {
          id: "sku",
          salePriceCents: 12345,
          currency: "CNY",
          currencyExponent: 2,
        },
      ],
    });
  });

  it("does not invent catalog currency while no market is open", async () => {
    const store = {
      markets: vi.fn().mockResolvedValue({ markets: [] }),
      listProducts: vi.fn().mockResolvedValue({
        items: [{ id: "product", priceCents: 12345 }],
        total: 1,
      }),
    };
    const service = new CommerceService(
      {} as never,
      store as never,
      {} as never,
    );
    const result = (await service.publicGet("/storefront/products")) as {
      items: Array<Record<string, unknown>>;
    };
    expect(result.items[0]).not.toHaveProperty("currency");
    expect(result.items[0]).not.toHaveProperty("currencyExponent");
  });

  it("routes the remaining H5 shopper capabilities through authenticated App V2 paths", async () => {
    const commerce = {
      forUser: vi.fn().mockResolvedValue({ ok: true }),
      availableCoupons: vi.fn().mockResolvedValue([]),
      claimCouponByCode: vi.fn().mockResolvedValue({ claimed: true }),
      points: vi.fn().mockResolvedValue({ items: [] }),
    };
    const capabilities = {
      publicCapabilities: vi.fn().mockResolvedValue({ realm: "global" }),
    };
    const controller = new CommerceController(
      commerce as never,
      capabilities as never,
    );
    const user = { id: "user" } as never;

    await expect(controller.capabilitiesForApp("en")).resolves.toEqual({
      realm: "global",
    });
    expect(capabilities.publicCapabilities).toHaveBeenCalledWith("en", "app");
    await controller.previewAfterSale(user, "order/unsafe", { items: [] });
    await controller.returnLogistics(user, "order", "sale/unsafe", {
      carrier: "test",
    });
    await controller.availableCoupons(user, "2");
    await controller.claimCouponByCode(user, { code: "TEST" });
    await controller.points(user, "3");

    expect(commerce.forUser).toHaveBeenNthCalledWith(
      1,
      "user",
      "POST",
      "/orders/order%2Funsafe/after-sales/preview",
      { items: [] },
    );
    expect(commerce.forUser).toHaveBeenNthCalledWith(
      2,
      "user",
      "POST",
      "/orders/order/after-sales/sale%2Funsafe/return-logistics",
      { carrier: "test" },
    );
    expect(commerce.availableCoupons).toHaveBeenCalledWith("user", 2);
    expect(commerce.claimCouponByCode).toHaveBeenCalledWith("user", {
      code: "TEST",
    });
    expect(commerce.points).toHaveBeenCalledWith("user", 3);
  });
});
