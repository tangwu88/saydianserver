import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  AfterSaleStatus,
  AfterSaleType,
  CommerceOrderStatus,
  CouponStatus,
  Prisma,
  ProductStatus,
} from "@prisma/client";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../common/prisma.service";
import { safeObject } from "../common/crypto";

type CreateOrderInput = {
  addressId: string;
  items: Array<{ skuId: string; quantity: number }>;
  couponClaimId?: string;
  buyerRemark?: string;
  invoice?: Record<string, unknown>;
  idempotencyKey: string;
};

@Injectable()
export class CommerceStoreService {
  constructor(private readonly prisma: PrismaService) {}

  async bootstrap(referralCode?: string) {
    const [banners, categories, featured, configs, employee] = await Promise.all([
      this.prisma.commerceBanner.findMany({
        where: { enabled: true },
        orderBy: { sort: "desc" },
      }),
      this.prisma.commerceCategory.findMany({
        where: { enabled: true, parentId: null },
        orderBy: { sort: "desc" },
      }),
      this.prisma.commerceProduct.findMany({
        where: {
          status: ProductStatus.PUBLISHED,
          localArchived: false,
          featured: true,
          skus: { some: { enabled: true, stock: { gt: 0 } } },
        },
        include: {
          skus: {
            where: { enabled: true },
            orderBy: { salePriceCents: "asc" },
          },
        },
        orderBy: [{ sort: "desc" }, { updatedAt: "desc" }],
        take: 12,
      }),
      this.prisma.commerceBusinessConfig.findMany({
        where: {
          key: {
            in: ["store.name", "store.notice", "customer.service", "policies"],
          },
        },
      }),
      referralCode
        ? this.prisma.commerceEmployee.findFirst({
            where: { referralCode, active: true },
            select: { name: true, referralCode: true },
          })
        : null,
    ]);
    return {
      banners,
      categories,
      featured: featured.map(productCard),
      configs: Object.fromEntries(configs.map((item) => [item.key, item])),
      referral: employee,
    };
  }

  async listProducts(input: {
    keyword?: string;
    categoryId?: string;
    page?: number;
    pageSize?: number;
    sort?: string;
  }) {
    const page = finiteInteger(input.page, 1, 1, 10_000);
    const pageSize = finiteInteger(input.pageSize, 20, 1, 60);
    const where: Prisma.CommerceProductWhereInput = {
      status: ProductStatus.PUBLISHED,
      localArchived: false,
      ...(input.categoryId ? { categoryId: input.categoryId } : {}),
      ...(input.keyword
        ? {
            OR: [
              { displayName: { contains: input.keyword, mode: "insensitive" } },
              { name: { contains: input.keyword, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const orderBy: Prisma.CommerceProductOrderByWithRelationInput[] =
      input.sort === "sales"
        ? [{ sales: "desc" }, { updatedAt: "desc" }]
        : [{ sort: "desc" }, { updatedAt: "desc" }];
    const [items, total] = await this.prisma.$transaction([
      this.prisma.commerceProduct.findMany({
        where,
        include: {
          skus: {
            where: { enabled: true },
            orderBy: { salePriceCents: "asc" },
          },
        },
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.commerceProduct.count({ where }),
    ]);
    const cards = items.map(productCard);
    if (input.sort === "price") {
      cards.sort((left, right) => left.priceCents - right.priceCents);
    }
    return { items: cards, total, page, pageSize };
  }

  async product(id: string, userId?: string) {
    const row = await this.prisma.commerceProduct.findFirst({
      where: { id, status: ProductStatus.PUBLISHED, localArchived: false },
      include: {
        skus: { where: { enabled: true }, orderBy: { salePriceCents: "asc" } },
        category: true,
        reviews: {
          where: { published: true },
          include: {
            user: { select: { id: true, nickname: true, avatarUrl: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 20,
        },
      },
    });
    if (!row) throw new NotFoundException("商品不存在或已下架");
    const favorite = userId
      ? Boolean(
          await this.prisma.commerceFavorite.findUnique({
            where: { userId_productId: { userId, productId: id } },
          }),
        )
      : false;
    return { ...row, favorite };
  }

  async cart(userId: string) {
    const cart = await this.prisma.commerceCart.upsert({
      where: { userId },
      create: { userId },
      update: {},
      include: {
        items: {
          include: { sku: { include: { product: true } } },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    return {
      ...cart,
      items: cart.items.map((item) => ({
        ...item,
        available:
          item.sku.enabled &&
          !item.sku.product.localArchived &&
          item.sku.product.status === ProductStatus.PUBLISHED &&
          item.sku.stock >= item.quantity,
      })),
    };
  }

  async putCartItem(
    userId: string,
    skuId: string,
    quantity: number,
    selected = true,
  ) {
    quantity = clampQuantity(quantity);
    const sku = await this.prisma.commerceSku.findFirst({
      where: {
        id: skuId,
        enabled: true,
        product: { status: ProductStatus.PUBLISHED, localArchived: false },
      },
    });
    if (!sku) throw new NotFoundException("商品规格不存在或已下架");
    const cart = await this.prisma.commerceCart.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
    await this.prisma.commerceCartItem.upsert({
      where: { cartId_skuId: { cartId: cart.id, skuId } },
      create: { cartId: cart.id, skuId, quantity, selected },
      update: { quantity, selected },
    });
    return this.cart(userId);
  }

  async deleteCartItem(userId: string, id: string) {
    await this.prisma.commerceCartItem.deleteMany({
      where: { id, cart: { userId } },
    });
    return this.cart(userId);
  }

  async listAddresses(userId: string) {
    return this.prisma.commerceAddress.findMany({
      where: { userId },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    });
  }

  async address(userId: string, id: string) {
    const address = await this.prisma.commerceAddress.findFirst({
      where: { id, userId },
    });
    if (!address) throw new NotFoundException("地址不存在");
    return address;
  }

  async saveAddress(userId: string, input: unknown, forcedId?: string) {
    const body = safeObject(input);
    const id = forcedId || String(body.id ?? "").trim();
    const data = {
      name: required(body.name, "收货人"),
      mobile: required(body.mobile, "手机号"),
      province: required(body.province, "省份"),
      provinceCode: optional(body.provinceCode),
      city: required(body.city, "城市"),
      cityCode: optional(body.cityCode),
      district: required(body.district, "区县"),
      districtCode: optional(body.districtCode),
      detail: required(body.detail, "详细地址"),
      postalCode: optional(body.postalCode),
      isDefault: body.isDefault === true || String(body.is_default ?? "") === "1",
    };
    return this.prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.commerceAddress.updateMany({
          where: { userId },
          data: { isDefault: false },
        });
      }
      if (id) {
        const changed = await tx.commerceAddress.updateMany({
          where: { id, userId },
          data,
        });
        if (!changed.count) throw new NotFoundException("地址不存在");
        return tx.commerceAddress.findUniqueOrThrow({ where: { id } });
      }
      return tx.commerceAddress.create({ data: { userId, ...data } });
    });
  }

  async deleteAddress(userId: string, id: string) {
    await this.prisma.commerceAddress.deleteMany({ where: { id, userId } });
    return null;
  }

  async previewOrder(
    userId: string,
    input: Pick<CreateOrderInput, "addressId" | "items">,
  ) {
    const normalized = normalizeItems(input.items);
    const [skus, address, shippingConfig] = await Promise.all([
      this.prisma.commerceSku.findMany({
        where: { id: { in: [...normalized.keys()] } },
        include: { product: true },
      }),
      input.addressId
        ? this.prisma.commerceAddress.findFirst({
            where: { id: input.addressId, userId },
          })
        : this.prisma.commerceAddress.findFirst({
            where: { userId },
            orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
          }),
      this.prisma.commerceBusinessConfig.findUnique({
        where: { key: "shipping.default" },
      }),
    ]);
    validateSkus(skus, normalized);
    const productCents = skus.reduce(
      (sum, sku) => sum + sku.salePriceCents * normalized.get(sku.id)!,
      0,
    );
    const shipping = safeObject(shippingConfig?.value);
    const shippingCents = shippingConfig?.enabled
      ? Math.max(0, Number(shipping.amountCents ?? 0))
      : 0;
    return {
      address,
      products: skus.map((sku) => ({
        id: sku.product.id,
        product_id: sku.product.id,
        sku_id: sku.id,
        name: sku.product.displayName ?? sku.product.name,
        image: sku.image ?? sku.product.coverImage,
        specification: sku.specification,
        price: sku.salePriceCents / 100,
        num: normalized.get(sku.id),
      })),
      preview: {
        product_money: productCents / 100,
        shipping_money: shippingCents / 100,
        payable_money: (productCents + shippingCents) / 100,
      },
    };
  }

  async createOrder(userId: string, input: CreateOrderInput) {
    if (input.idempotencyKey.length < 8) {
      throw new BadRequestException("缺少有效的订单请求编号");
    }
    const normalized = normalizeItems(input.items);
    const existing = await this.prisma.commerceOrder.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { items: true },
    });
    if (existing) {
      if (existing.userId !== userId) throw new ConflictException("订单请求编号已被使用");
      return existing;
    }
    return this.prisma.$transaction(
      async (tx) => {
        const [user, address, skus, shippingConfig] = await Promise.all([
          tx.user.findUniqueOrThrow({
            where: { id: userId },
            include: { referralEmployee: true },
          }),
          tx.commerceAddress.findFirst({ where: { id: input.addressId, userId } }),
          tx.commerceSku.findMany({
            where: { id: { in: [...normalized.keys()] } },
            include: { product: true },
          }),
          tx.commerceBusinessConfig.findUnique({
            where: { key: "shipping.default" },
          }),
        ]);
        if (!address) throw new BadRequestException("收货地址不存在");
        validateSkus(skus, normalized);
        const subtotalCents = skus.reduce(
          (sum, sku) => sum + sku.salePriceCents * normalized.get(sku.id)!,
          0,
        );
        let discountCents = 0;
        let couponClaimId: string | undefined;
        if (input.couponClaimId) {
          const claim = await tx.commerceCouponClaim.findFirst({
            where: { id: input.couponClaimId, userId, usedAt: null },
            include: { coupon: true },
          });
          if (
            !claim ||
            claim.coupon.status !== CouponStatus.ACTIVE ||
            claim.coupon.validFrom > new Date() ||
            claim.coupon.validUntil < new Date() ||
            subtotalCents < claim.coupon.minimumSpendCents
          ) {
            throw new BadRequestException("优惠券不可用");
          }
          discountCents = Math.min(subtotalCents, claim.coupon.value);
          couponClaimId = claim.id;
        }
        const shipping = safeObject(shippingConfig?.value);
        const shippingCents = shippingConfig?.enabled
          ? Math.max(0, Number(shipping.amountCents ?? 0))
          : 0;
        const order = await tx.commerceOrder.create({
          data: {
            orderNo: commerceNumber("SD"),
            userId,
            referralEmployeeId: user.referralEmployeeId,
            referralCodeSnapshot: user.referralEmployee?.referralCode ?? null,
            subtotalCents,
            discountCents,
            shippingCents,
            payableCents: subtotalCents - discountCents + shippingCents,
            recipientName: address.name,
            recipientMobile: address.mobile,
            province: address.province,
            city: address.city,
            district: address.district,
            addressDetail: address.detail,
            buyerRemark: optional(input.buyerRemark),
            ...(input.invoice
              ? { invoiceJson: input.invoice as Prisma.InputJsonValue }
              : {}),
            idempotencyKey: input.idempotencyKey,
            items: {
              create: skus.map((sku) => ({
                productId: sku.productId,
                skuId: sku.id,
                erpSkuIdSnapshot: sku.erpSkuId,
                nameSnapshot: sku.product.displayName ?? sku.product.name,
                specificationSnapshot: sku.specification,
                imageSnapshot: sku.image ?? sku.product.coverImage,
                unitPriceCents: sku.salePriceCents,
                quantity: normalized.get(sku.id)!,
                totalCents: sku.salePriceCents * normalized.get(sku.id)!,
              })),
            },
          },
          include: { items: true },
        });
        for (const sku of skus) {
          await tx.commerceSku.update({
            where: { id: sku.id },
            data: { stock: { decrement: normalized.get(sku.id)! } },
          });
        }
        if (couponClaimId) {
          await tx.commerceCouponClaim.update({
            where: { id: couponClaimId },
            data: { orderId: order.id, usedAt: new Date() },
          });
        }
        const cart = await tx.commerceCart.findUnique({ where: { userId } });
        if (cart) {
          await tx.commerceCartItem.deleteMany({
            where: { cartId: cart.id, skuId: { in: [...normalized.keys()] } },
          });
        }
        return order;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async listOrders(userId: string, statusInput?: string) {
    const status = statusInput
      ? parseEnum(CommerceOrderStatus, statusInput, "订单状态")
      : undefined;
    return this.prisma.commerceOrder.findMany({
      where: { userId, ...(status ? { status } : {}) },
      include: {
        items: true,
        paymentIntents: true,
        shipments: true,
        afterSales: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async order(userId: string, id: string) {
    const order = await this.prisma.commerceOrder.findFirst({
      where: { id, userId },
      include: {
        items: true,
        paymentIntents: true,
        shipments: true,
        afterSales: { include: { refunds: true } },
      },
    });
    if (!order) throw new NotFoundException("订单不存在");
    return order;
  }

  async cancelOrder(userId: string, id: string) {
    const order = await this.prisma.commerceOrder.findFirst({
      where: { id, userId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException("订单不存在");
    if (order.status !== CommerceOrderStatus.PENDING_PAYMENT) {
      throw new ConflictException("当前订单不可取消");
    }
    await this.prisma.$transaction([
      this.prisma.commerceOrder.update({
        where: { id },
        data: { status: CommerceOrderStatus.CANCELLED, cancelledAt: new Date() },
      }),
      ...order.items.map((item) =>
        this.prisma.commerceSku.update({
          where: { id: item.skuId },
          data: { stock: { increment: item.quantity } },
        }),
      ),
      this.prisma.commerceCouponClaim.updateMany({
        where: { orderId: id },
        data: { orderId: null, usedAt: null },
      }),
    ]);
    return null;
  }

  async confirmReceipt(userId: string, id: string) {
    const receivedAt = new Date();
    const changed = await this.prisma.commerceOrder.updateMany({
      where: { id, userId, status: CommerceOrderStatus.SHIPPED },
      data: { status: CommerceOrderStatus.RECEIVED, receivedAt },
    });
    if (!changed.count) throw new ConflictException("当前订单不可确认收货");
    await this.createCommissionAccrual(id, receivedAt);
    return null;
  }

  async createAfterSale(userId: string, orderId: string, input: unknown) {
    const body = safeObject(input);
    const order = await this.prisma.commerceOrder.findFirst({
      where: { id: orderId, userId },
      include: { afterSales: true },
    });
    if (!order) throw new NotFoundException("订单不存在");
    if (
      !([
        CommerceOrderStatus.PAID,
        CommerceOrderStatus.WAITING_FULFILLMENT,
        CommerceOrderStatus.SHIPPED,
        CommerceOrderStatus.RECEIVED,
      ] as CommerceOrderStatus[]).includes(order.status)
    ) {
      throw new ConflictException("当前订单不可申请售后");
    }
    if (
      order.afterSales.some(
        (item) =>
          !([
            AfterSaleStatus.COMPLETED,
            AfterSaleStatus.CANCELLED,
            AfterSaleStatus.REJECTED,
          ] as AfterSaleStatus[]).includes(item.status),
      )
    ) {
      throw new ConflictException("已有进行中的售后单");
    }
    const type = parseEnum(AfterSaleType, body.type, "售后类型");
    const requestedCents = Math.min(
      order.payableCents,
      Math.max(1, Number(body.requestedCents ?? order.payableCents)),
    );
    return this.prisma.$transaction(async (tx) => {
      const afterSale = await tx.commerceAfterSale.create({
        data: {
          afterSaleNo: commerceNumber("AS"),
          orderId,
          type,
          reason: required(body.reason, "售后原因"),
          description: optional(body.description),
          evidenceImages: Array.isArray(body.evidenceImages)
            ? body.evidenceImages.map(String).slice(0, 9)
            : [],
          requestedCents,
        },
      });
      await tx.commerceOrder.update({
        where: { id: orderId },
        data: { status: CommerceOrderStatus.AFTER_SALE },
      });
      await tx.commerceIntegrationJob.create({
        data: {
          type: "JUSHUITAN_AFTER_SALE_PUSH",
          idempotencyKey: `jushuitan-after-sale:${afterSale.id}`,
          aggregateType: "commerce_after_sale",
          aggregateId: afterSale.id,
          payload: { afterSaleId: afterSale.id },
        },
      });
      return afterSale;
    });
  }

  async createAfterSaleFromOrderItem(userId: string, orderItemId: string, input: unknown) {
    const item = await this.prisma.commerceOrderItem.findFirst({
      where: { id: orderItemId, order: { userId } },
    });
    if (!item) throw new NotFoundException("订单商品不存在");
    return this.createAfterSale(userId, item.orderId, input);
  }

  async logistics(userId: string, orderId: string) {
    await this.order(userId, orderId);
    return this.prisma.commerceShipment.findMany({
      where: { orderId },
      orderBy: { createdAt: "desc" },
    });
  }

  async favorite(userId: string, productId: string, enabled: boolean) {
    if (enabled) {
      await this.prisma.commerceFavorite.upsert({
        where: { userId_productId: { userId, productId } },
        create: { userId, productId },
        update: {},
      });
    } else {
      await this.prisma.commerceFavorite.deleteMany({ where: { userId, productId } });
    }
    return null;
  }

  async favorites(userId: string) {
    const rows = await this.prisma.commerceFavorite.findMany({
      where: {
        userId,
        product: { status: ProductStatus.PUBLISHED, localArchived: false },
      },
      include: {
        product: {
          include: {
            skus: { where: { enabled: true }, orderBy: { salePriceCents: "asc" } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => productCard(row.product));
  }

  async coupons(userId: string) {
    return this.prisma.commerceCouponClaim.findMany({
      where: { userId },
      include: { coupon: true },
      orderBy: { claimedAt: "desc" },
    });
  }

  async claimCoupon(userId: string, couponId: string) {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const coupon = await tx.commerceCoupon.findFirst({
        where: {
          id: couponId,
          status: CouponStatus.ACTIVE,
          validFrom: { lte: now },
          validUntil: { gte: now },
        },
      });
      if (
        !coupon ||
        (coupon.totalQuantity !== null && coupon.claimedQuantity >= coupon.totalQuantity)
      ) {
        throw new BadRequestException("优惠券已领完或不可用");
      }
      const existing = await tx.commerceCouponClaim.findUnique({
        where: { couponId_userId: { couponId, userId } },
      });
      if (existing) return existing;
      const claim = await tx.commerceCouponClaim.create({ data: { couponId, userId } });
      await tx.commerceCoupon.update({
        where: { id: couponId },
        data: { claimedQuantity: { increment: 1 } },
      });
      return claim;
    });
  }

  async createReview(userId: string, input: unknown) {
    const body = safeObject(input);
    const orderItemId = required(body.orderItemId, "订单商品");
    const item = await this.prisma.commerceOrderItem.findFirst({
      where: {
        id: orderItemId,
        order: {
          userId,
          status: { in: [CommerceOrderStatus.RECEIVED, CommerceOrderStatus.CLOSED] },
        },
      },
    });
    if (!item) throw new BadRequestException("订单商品不可评价");
    return this.prisma.commerceReview.create({
      data: {
        userId,
        productId: item.productId,
        orderItemId,
        rating: finiteInteger(Number(body.rating), 5, 1, 5),
        content: required(body.content, "评价内容"),
        images: Array.isArray(body.images) ? body.images.map(String).slice(0, 9) : [],
      },
    });
  }

  private async createCommissionAccrual(orderId: string, receivedAt: Date) {
    const [order, plan] = await Promise.all([
      this.prisma.commerceOrder.findUnique({ where: { id: orderId } }),
      this.prisma.commerceCommissionPlan.findUnique({ where: { id: "default" } }),
    ]);
    if (!order?.referralEmployeeId || !plan?.enabled || plan.rateBps <= 0) return;
    const bonus = Math.floor((order.payableCents * plan.rateBps) / 10_000);
    if (bonus <= 0) return;
    const availableAt = new Date(receivedAt.valueOf() + plan.settlementDays * 86_400_000);
    await this.prisma.commerceCommissionAccrual.upsert({
      where: { orderId },
      create: {
        employeeId: order.referralEmployeeId,
        orderId,
        baseCents: order.payableCents,
        rateBps: plan.rateBps,
        grossBonusCents: bonus,
        availableAt,
      },
      update: {},
    });
  }
}

function normalizeItems(items: Array<{ skuId: string; quantity: number }> | undefined) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new BadRequestException("请选择商品");
  }
  const normalized = new Map<string, number>();
  for (const item of items) {
    const skuId = String(item?.skuId ?? "").trim();
    if (!skuId) throw new BadRequestException("商品规格不正确");
    normalized.set(skuId, (normalized.get(skuId) ?? 0) + clampQuantity(item.quantity));
  }
  return normalized;
}

function validateSkus(
  skus: Array<{
    id: string;
    enabled: boolean;
    stock: number;
    product: { localArchived: boolean; status: ProductStatus; name: string; displayName: string | null };
  }>,
  normalized: Map<string, number>,
) {
  if (skus.length !== normalized.size) throw new BadRequestException("部分商品规格不存在");
  for (const sku of skus) {
    if (
      !sku.enabled ||
      sku.product.localArchived ||
      sku.product.status !== ProductStatus.PUBLISHED
    ) {
      throw new BadRequestException(`${sku.product.displayName ?? sku.product.name} 已下架`);
    }
    if (sku.stock < normalized.get(sku.id)!) {
      throw new BadRequestException(`${sku.product.displayName ?? sku.product.name} 库存不足`);
    }
  }
}

function productCard(product: {
  id: string;
  categoryId: string | null;
  name: string;
  displayName: string | null;
  subtitle: string | null;
  coverImage: string | null;
  tags: string[];
  sales: number;
  skus: Array<{
    id: string;
    erpSkuId: string;
    specification: string | null;
    image: string | null;
    salePriceCents: number;
    marketPriceCents: number | null;
    stock: number;
    enabled: boolean;
  }>;
}) {
  const available = product.skus.filter((sku) => sku.enabled);
  return {
    id: product.id,
    categoryId: product.categoryId,
    name: product.displayName ?? product.name,
    subtitle: product.subtitle,
    coverImage: product.coverImage,
    tags: product.tags,
    sales: product.sales,
    priceCents: available[0]?.salePriceCents ?? 0,
    marketPriceCents: available[0]?.marketPriceCents ?? null,
    stock: available.reduce((sum, sku) => sum + sku.stock, 0),
    defaultSku: available[0] ?? null,
  };
}

function parseEnum<T extends Record<string, string>>(
  values: T,
  input: unknown,
  label: string,
): T[keyof T] {
  const value = String(input ?? "").trim().toUpperCase();
  if (!Object.values(values).includes(value)) {
    throw new BadRequestException(`${label}不正确`);
  }
  return value as T[keyof T];
}

function finiteInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(number)));
}

function clampQuantity(value: unknown) {
  return finiteInteger(value, 1, 1, 99);
}

function required(value: unknown, label: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new BadRequestException(`${label}不能为空`);
  return text;
}

function optional(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function commerceNumber(prefix: string) {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `${prefix}${stamp}${randomBytes(4).toString("hex").toUpperCase()}`;
}
