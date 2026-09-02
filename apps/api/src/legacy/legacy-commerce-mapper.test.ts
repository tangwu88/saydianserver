import { describe, expect, it } from "vitest";
import { LegacyCommerceMapper } from "./legacy-commerce-mapper.service";
import type { LegacyService } from "./legacy.service";

function mapper() {
  let nextId = 100;
  const byExternal = new Map<string, number>();
  const byCompatibility = new Map<string, string>();
  const legacy = {
    async compatibilityId(entityType: string, externalId: string) {
      const key = `${entityType}:${externalId}`;
      const id = byExternal.get(key) ?? nextId++;
      byExternal.set(key, id);
      byCompatibility.set(`${entityType}:${id}`, externalId);
      return id;
    },
    async externalIdIfMapped(entityType: string, id: unknown) {
      return byCompatibility.get(`${entityType}:${id}`) ?? null;
    },
  } as unknown as LegacyService;
  return new LegacyCommerceMapper(legacy);
}

describe("legacy commerce compatibility", () => {
  it("reconstructs the old page, product and numeric ID contract", async () => {
    const service = mapper();
    const home = await service.home(
      {
        banners: [{ imageUrl: "https://cdn.example/banner.jpg" }],
        categories: [{ id: "category-cuid", name: "健康设备" }],
        featured: [
          {
            id: "product-cuid",
            categoryId: "category-cuid",
            name: "手表",
            coverImage: "https://cdn.example/watch.jpg",
            priceCents: 39900,
          },
        ],
      },
      {
        items: [
          {
            id: "product-cuid",
            categoryId: "category-cuid",
            name: "手表",
            coverImage: "https://cdn.example/watch.jpg",
            priceCents: 39900,
          },
        ],
      },
    );
    expect(home.items).toHaveLength(2);
    expect(JSON.stringify(home)).not.toContain("product-cuid");
    expect(home).toMatchObject({
      items: [
        { type: "swiper" },
        {
          type: "tabs",
          value: [
            { name: "推荐", list: [{ id: 100, price: 399 }] },
            { name: "健康设备", list: [{ id: 100, price: 399 }] },
          ],
        },
      ],
    });
  });

  it("maps current mall orders and payment invocation to the released App", async () => {
    const service = mapper();
    const order = await service.order({
      id: "order-cuid",
      orderNo: "SD202609020001",
      status: "PENDING_PAYMENT",
      payableCents: 39900,
      subtotalCents: 39900,
      items: [
        {
          id: "item-cuid",
          productId: "product-cuid",
          skuId: "sku-cuid",
          nameSnapshot: "手表",
          specificationSnapshot: "黑色",
          unitPriceCents: 39900,
          quantity: 1,
        },
      ],
    });
    expect(order).toMatchObject({
      id: 100,
      order_sn: "SD202609020001",
      order_status: 0,
      pay_money: 399,
      product: [
        {
          id: 101,
          product_id: 102,
          sku_id: 103,
          product_name: "手表",
          price: 399,
        },
      ],
    });
    expect(JSON.stringify(order)).not.toContain("order-cuid");
    expect(JSON.stringify(order)).not.toContain("item-cuid");
    expect(JSON.stringify(order)).not.toContain("product-cuid");
    expect(JSON.stringify(order)).not.toContain("sku-cuid");
    expect(
      service.payment({
        paymentNo: "PAY-1",
        channel: "WECHAT_APP",
        invoke: { prepayid: "wx-prepay", sign: "signature" },
      }),
    ).toEqual({
      payment_no: "PAY-1",
      channel: "WECHAT_APP",
      config: { prepayid: "wx-prepay", sign: "signature" },
    });
  });

  it("resolves old numeric request IDs back to mall IDs", async () => {
    const service = mapper();
    const product = await service.productDetail({
      id: "product-cuid",
      name: "手表",
      skus: [
        {
          id: "sku-cuid",
          specification: "黑色",
          salePriceCents: 39900,
          stock: 5,
        },
      ],
    });
    expect(JSON.stringify(product)).not.toContain("product-cuid");
    expect(JSON.stringify(product)).not.toContain("sku-cuid");
    const address = await service.address({
      id: "address-cuid",
      userId: "mall-user-cuid",
      name: "赛电用户",
      mobile: "13800000000",
      province: "广东省",
      city: "深圳市",
      district: "宝安区",
      detail: "示例路 1 号",
    });
    const request = await service.orderRequest({
      address_id: address.id,
      data: JSON.stringify({ sku_id: 101, num: 2 }),
    });
    expect(request).toEqual({
      addressId: "address-cuid",
      items: [{ skuId: "sku-cuid", quantity: 2 }],
      buyerRemark: "",
    });
    expect(address).not.toHaveProperty("userId");
    expect(JSON.stringify(address)).not.toContain("mall-user-cuid");
  });

  it("keeps migrated legacy order IDs readable without replaying them", async () => {
    const service = mapper();
    const order = await service.order({
      id: "projection-uuid",
      legacyOrderId: "9527",
      orderNo: "OLD-9527",
      order_status: 3,
      pay_money: 199,
      product: [],
      readOnly: true,
    });
    expect(order).toMatchObject({
      id: 9527,
      order_id: 9527,
      order_status: 3,
      read_only: true,
    });
    await expect(service.orderExternalId(9527)).resolves.toBe("9527");
  });
});
