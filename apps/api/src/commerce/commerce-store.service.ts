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
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../common/prisma.service";
import { safeObject } from "../common/crypto";
import { integerCents, requireCommerceOwner } from "./commerce-policy";
import { publicSku } from "./commerce-public-sku";
import { onCommerceOrderReceived, priceOrder, quoteAfterSale, afterSaleAvailability, financialSnapshot, cents, allocateLargestRemainder } from "./commerce-finance";

type CreateOrderInput = {
  addressId: string;
  items: Array<{ skuId: string; quantity: number }>;
  couponClaimId?: string;
  buyerRemark?: string;
  invoice?: Record<string, unknown>;
  pointCents?: number;
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
    return { ...row, skus: row.skus.map(publicSku), favorite };
  }

  async cart(userId: string) {
    const cart = await this.prisma.commerceCart.findUnique({
      where: { userId },
      include: {
        items: {
          include: { sku: { include: { product: true } } },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!cart) return { id: null, userId, items: [] };
    return {
      ...cart,
      items: cart.items.map((item) => ({
        ...item,
        sku: { ...publicSku(item.sku), product: item.sku.product },
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
    mode: "set" | "increment" = "set",
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
    await this.prisma.$transaction(async (tx) => {
      const saved = await tx.commerceCartItem.upsert({
        where: { cartId_skuId: { cartId: cart.id, skuId } },
        create: { cartId: cart.id, skuId, quantity, selected },
        update: { quantity: mode === "increment" ? { increment: quantity } : quantity, selected },
      });
      if (saved.quantity > 999 || saved.quantity > sku.stock) {
        throw new ConflictException("加入购物车的数量超过库存或单项数量上限");
      }
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
    input: Omit<CreateOrderInput, "idempotencyKey">,
  ) {
    const { skus, address, normalized, quote } = await this.readQuote(this.prisma, userId, input);
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
        product_money: quote.subtotalCents / 100,
        shipping_money: quote.shippingCents / 100,
        payable_money: quote.payableCents / 100,
      },
      quote,
    };
  }

  private async readQuote(tx: Prisma.TransactionClient, userId: string, input: Omit<CreateOrderInput, "idempotencyKey">) {
    const normalized = normalizeItems(input.items);
    const [user, address, skus, shippingConfig, account, claim] = await Promise.all([
      tx.user.findUniqueOrThrow({ where: { id: userId }, include: { referralEmployee: true } }),
      input.addressId ? tx.commerceAddress.findFirst({ where: { id: input.addressId, userId } })
        : tx.commerceAddress.findFirst({ where: { userId }, orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }] }),
      tx.commerceSku.findMany({ where: { id: { in: [...normalized.keys()] } }, include: { product: true } }),
      tx.commerceBusinessConfig.findUnique({ where: { key: "shipping.default" } }),
      tx.commercePointAccount.findUnique({ where: { userId } }),
      input.couponClaimId ? tx.commerceCouponClaim.findFirst({ where: { id: input.couponClaimId, userId, usedAt: null }, include: { coupon: true } }) : null,
    ]);
    if (input.addressId && !address) throw new BadRequestException("收货地址不存在");
    validateSkus(skus, normalized);
    const subtotal = cents(skus.reduce((total, sku) => total + sku.salePriceCents * normalized.get(sku.id)!, 0));
    if (input.couponClaimId) {
      if (!claim) throw new BadRequestException('优惠券不存在、已使用或不属于当前账号');
      if (claim.coupon.status !== CouponStatus.ACTIVE) throw new BadRequestException('优惠券已停用');
      if (claim.coupon.validFrom > new Date()) throw new BadRequestException('优惠券尚未到使用时间');
      if (claim.coupon.validUntil < new Date()) throw new BadRequestException('优惠券已过期');
      if (subtotal < claim.coupon.minimumSpendCents) throw new BadRequestException('商品金额未达到优惠券使用门槛');
    }
    const shipping = safeObject(shippingConfig?.value);
    const quote = priceOrder({
      items: skus.map(sku => ({ skuId: sku.id, quantity: normalized.get(sku.id)!, unitPriceCents: sku.salePriceCents })),
      couponDiscountCents: claim ? Math.min(subtotal, cents(claim.coupon.value)) : 0,
      pointDiscountCents: integerCents(input.pointCents ?? 0, "积分抵扣"),
      shippingCents: shippingConfig?.enabled ? integerCents(shipping.amountCents ?? 0, "运费") : 0,
      availablePointCents: account ? account.balanceCents : null,
    });
    return { user, address, skus, normalized, couponClaimId: claim?.id,
      quote: { ...quote, lines: quote.lines.map(line => {
        const sku = skus.find(item => item.id === line.skuId)!;
        return { ...line, name: sku.product.displayName ?? sku.product.name, image: sku.image ?? sku.product.coverImage, specification: sku.specification };
      }) } };
  }

  async createOrder(userId: string, input: CreateOrderInput) {
    if (input.idempotencyKey.length < 8) {
      throw new BadRequestException("缺少有效的订单请求编号");
    }
    const normalized = normalizeItems(input.items);
    const requestHash = createHash("sha256").update(stableRequestJson({
      addressId: input.addressId, items: [...normalized].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
      couponClaimId: input.couponClaimId ?? null, pointCents: input.pointCents ?? 0,
      buyerRemark: input.buyerRemark ?? null, invoice: input.invoice ?? null,
    })).digest("hex");
    const existing = await this.prisma.commerceOrder.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { items: true },
    });
    if (existing) {
      if (existing.userId !== userId) throw new ConflictException("订单请求编号已被使用");
      if (existing.requestHash && existing.requestHash !== requestHash) throw new ConflictException("订单请求编号已被不同结算参数使用");
      return existing;
    }
    return this.prisma.$transaction(
      async (tx) => {
        const { user, address, skus, couponClaimId, quote } = await this.readQuote(tx, userId, input);
        if (!address) throw new BadRequestException("收货地址不存在");
        const { subtotalCents, couponDiscountCents: discountCents, pointDiscountCents, shippingCents } = quote;
        const allocations = new Map(quote.lines.map(line => [line.skuId, line]));
        if (pointDiscountCents > 0) {
          const balance = await tx.commercePointAccount.updateMany({
            where: { userId, balanceCents: { gte: pointDiscountCents } },
            data: { balanceCents: { decrement: pointDiscountCents }, version: { increment: 1 } },
          });
          if (!balance.count) throw new ConflictException("积分余额不足或尚未完成余额迁移");
        }
        const order = await tx.commerceOrder.create({
          data: {
            orderNo: commerceNumber("SD"),
            userId,
            referralEmployeeId: user.referralEmployeeId,
            referralCodeSnapshot: user.referralEmployee?.referralCode ?? null,
            subtotalCents,
            discountCents,
            pointDiscountCents,
            shippingCents,
            pricingVersion: quote.pricingVersion,
            pricingVerifiedAt: new Date(),
            requestHash,
            payableCents: subtotalCents - discountCents - pointDiscountCents + shippingCents,
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
                couponDiscountCentsSnapshot: allocations.get(sku.id)!.couponDiscountCentsSnapshot,
                pointDiscountCentsSnapshot: allocations.get(sku.id)!.pointDiscountCentsSnapshot,
                cashPaidCentsSnapshot: allocations.get(sku.id)!.cashPaidCentsSnapshot,
              })),
            },
          },
          include: { items: true },
        });
        if (pointDiscountCents > 0) {
          await tx.commercePointLedger.create({ data: {
            userId, orderId: order.id, deltaCents: -pointDiscountCents,
            type: "ORDER_REDEMPTION", idempotencyKey: `points-order:${order.id}`,
          } });
        }
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
        shipments: { include: { items: true } },
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
        shipments: { include: { items: true } },
        afterSales: { include: { refunds: true, items: true } },
      },
    });
    if (!order) throw new NotFoundException("订单不存在");
    let afterSaleEligibleItems: ReturnType<typeof afterSaleAvailability> = [], unavailableReason: string | undefined;
    try { afterSaleEligibleItems = afterSaleAvailability(order); }
    catch (error) { unavailableReason = error instanceof Error ? error.message : "售后金额尚未核验"; }
    const allowedActions: string[] = [];
    if (order.executionOwner === "NEW_SYSTEM") {
      if (order.status === "PENDING_PAYMENT") {
        allowedActions.push("PAY");
        if (!order.paymentIntents.some(payment => ["CREATED", "PENDING"].includes(payment.status))) allowedActions.push("CANCEL");
      }
      if (order.status === "SHIPPED") allowedActions.push("CONFIRM_RECEIPT");
      if (["PAID", "WAITING_FULFILLMENT", "SHIPPED", "RECEIVED", "COMPLETED", "AFTER_SALE"].includes(order.status) &&
          afterSaleEligibleItems.some(item => item.quantityRemaining > 0)) allowedActions.push("APPLY_AFTER_SALE");
    } else unavailableReason = "订单尚未完成新系统接管";
    return { ...order, afterSaleEligibleItems, allowedActions, ...(unavailableReason ? { unavailableReason } : {}) };
  }

  async cancelOrder(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CommerceOrder" WHERE id = ${id}::uuid FOR UPDATE`;
    const order = await tx.commerceOrder.findFirst({
      where: { id, userId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException("订单不存在");
    requireCommerceOwner(order.executionOwner);
    if (order.status !== CommerceOrderStatus.PENDING_PAYMENT) {
      throw new ConflictException("当前订单不可取消");
    }
    const pendingPayment = await tx.paymentIntent.count({ where: {
      commerceOrderId: id, status: { in: ["CREATED", "PENDING"] },
    } });
    if (pendingPayment) throw new ConflictException("支付结果尚未确认，请先完成支付渠道关单或查单后再取消");
    const changed = await tx.commerceOrder.updateMany({
        where: { id, status: CommerceOrderStatus.PENDING_PAYMENT, version: order.version },
        data: { status: CommerceOrderStatus.CANCELLED, cancelledAt: new Date(), version: { increment: 1 } },
      });
    if (!changed.count) throw new ConflictException("订单状态已改变，请刷新后重试");
    for (const item of order.items) {
      await tx.commerceSku.update({
          where: { id: item.skuId },
          data: { stock: { increment: item.quantity } },
        });
    }
    await tx.commerceCouponClaim.updateMany({
        where: { orderId: id },
        data: { orderId: null, usedAt: null },
      });
    if (order.pointDiscountCents > 0) {
      financialSnapshot(order);
      await tx.commercePointAccount.update({ where: { userId }, data: {
        balanceCents: { increment: order.pointDiscountCents }, version: { increment: 1 },
      } });
      await tx.commercePointLedger.create({ data: {
        userId, orderId: id, deltaCents: order.pointDiscountCents,
        type: "ORDER_CANCEL_RETURN", idempotencyKey: `points-cancel:${id}`,
      } });
    }
    return null;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async confirmReceipt(userId: string, id: string) {
    const receivedAt = new Date();
    return this.prisma.$transaction(async (tx) => {
    const changed = await tx.commerceOrder.updateMany({
      where: { id, userId, status: CommerceOrderStatus.SHIPPED, executionOwner: "NEW_SYSTEM" },
      data: { status: CommerceOrderStatus.RECEIVED, receivedAt, version: { increment: 1 } },
    });
    if (!changed.count) throw new ConflictException("当前订单不可确认收货");
    await onCommerceOrderReceived(tx, id, receivedAt);
    return null;
    });
  }

  private async readAfterSaleQuote(tx: Prisma.TransactionClient, userId: string, orderId: string, input: unknown) {
    const body = safeObject(input);
    const order = await tx.commerceOrder.findFirst({ where: { id: orderId, userId }, include: {
      items: { orderBy: { id: "asc" } }, afterSales: { include: { items: true } },
    } });
    if (!order) throw new NotFoundException("订单不存在");
    requireCommerceOwner(order.executionOwner);
    if (!["PAID", "WAITING_FULFILLMENT", "SHIPPED", "RECEIVED", "COMPLETED", "AFTER_SALE"].includes(order.status)) throw new ConflictException("当前订单不可申请售后");
    const type = parseEnum(AfterSaleType, body.type ?? "REFUND_ONLY", "售后类型");
    const raw = Array.isArray(body.items) ? body.items.map(safeObject)
      : body.orderItemId ? [{ orderItemId: body.orderItemId, quantity: body.quantity }]
      : order.items.map(item => ({ orderItemId: item.id, quantity: undefined }));
    const requested = raw.map(line => ({ orderItemId: String(line.orderItemId ?? ""),
      ...(line.quantity !== undefined ? { quantity: integerCents(line.quantity, "售后数量", 1) } : {}) }));
    const quote = quoteAfterSale(order, requested, type);
    if (body.requestedCents !== undefined && integerCents(body.requestedCents, "现金退款") !== quote.requestedCents) {
      if (quote.pricingVersion !== 0 || type === "EXCHANGE") throw new ConflictException("退款金额须按商品现金与积分快照计算，请刷新报价");
      const requestedCents = integerCents(body.requestedCents, "现金退款", 1);
      if (requestedCents > quote.requestedCents) throw new ConflictException("退款金额超过所选商品剩余额度");
      const cash = Math.min(requestedCents, quote.merchandiseRefundCents);
      const allocation = allocateLargestRemainder(cash, quote.items.map(line => ({ key: line.orderItemId, amount: line.amountCents })));
      quote.items = quote.items.map(line => ({ ...line, amountCents: allocation.get(line.orderItemId)! }));
      quote.merchandiseRefundCents = cash;
      quote.shippingRefundCents = requestedCents - cash;
      quote.requestedCents = requestedCents;
    }
    return { body, order, type, quote };
  }

  async afterSaleQuote(userId: string, orderId: string, input: unknown) {
    const { order, type, quote } = await this.readAfterSaleQuote(this.prisma, userId, orderId, input);
    return { orderId, orderVersion: order.version, type, ...quote };
  }

  async createAfterSale(userId: string, orderId: string, input: unknown) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "CommerceOrder" WHERE id = ${orderId}::uuid FOR UPDATE`;
      const { body, order, type, quote } = await this.readAfterSaleQuote(tx, userId, orderId, input);
      if (body.orderVersion !== undefined && integerCents(body.orderVersion, "订单版本") !== order.version) throw new ConflictException("订单已更新，请刷新售后报价");
      const afterSale = await tx.commerceAfterSale.create({ data: {
        afterSaleNo: commerceNumber("AS"), orderId, type, pricingVersion: quote.pricingVersion,
        requestedCents: quote.requestedCents, pointReturnCents: quote.pointReturnCents, shippingRefundCents: quote.shippingRefundCents,
        reason: required(body.reason, "售后原因"), description: optional(body.description),
        evidenceImages: Array.isArray(body.evidenceImages) ? body.evidenceImages.map(String).slice(0, 9) : [],
        items: { create: quote.items },
      }, include: { items: true } });
      const changed = await tx.commerceOrder.updateMany({ where: { id: orderId, version: order.version },
        data: { status: CommerceOrderStatus.AFTER_SALE, version: { increment: 1 } } });
      if (changed.count !== 1) throw new ConflictException("订单已更新，请刷新");
      return afterSale;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async createAfterSaleFromOrderItem(userId: string, orderItemId: string, input: unknown) {
    const item = await this.prisma.commerceOrderItem.findFirst({
      where: { id: orderItemId, order: { userId } },
    });
    if (!item) throw new NotFoundException("订单商品不存在");
    return this.createAfterSale(userId, item.orderId, { ...safeObject(input), orderItemId: item.id });
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

  async submitReturnLogistics(userId: string, orderId: string, saleId: string, input: unknown) {
    const body = safeObject(input);
    if (typeof body.logisticsCompany !== "string" || typeof body.trackingNo !== "string") throw new BadRequestException("请填写物流公司和运单号文本");
    const logisticsCompany = required(body.logisticsCompany, "退货物流公司");
    const trackingNo = required(body.trackingNo, "退货运单号");
    if (logisticsCompany.length > 80 || /[\u0000-\u001f\u007f]/.test(body.logisticsCompany)) throw new BadRequestException("物流公司须为80字以内的单行文本");
    if (trackingNo.length > 100 || /[\u0000-\u001f\u007f]/.test(body.trackingNo)) throw new BadRequestException("运单号须为100字以内且不含控制字符");
    const version = integerCents(body.version, "售后版本");
    return this.prisma.$transaction(async tx => {
      const reference = await tx.commerceAfterSale.findFirst({ where: { id: saleId, orderId, order: { userId } }, select: { orderId: true } });
      if (!reference) throw new NotFoundException("售后记录不存在");
      await tx.$queryRaw`SELECT id FROM "CommerceOrder" WHERE id = ${reference.orderId}::uuid FOR UPDATE`;
      const sale = await tx.commerceAfterSale.findFirst({ where: { id: saleId, orderId, order: { userId } }, include: { order: { select: { executionOwner: true } } } });
      if (!sale) throw new NotFoundException("售后记录不存在");
      requireCommerceOwner(sale.executionOwner); requireCommerceOwner(sale.order.executionOwner);
      if (sale.status !== AfterSaleStatus.WAITING_RETURN || !([AfterSaleType.RETURN_REFUND, AfterSaleType.EXCHANGE] as AfterSaleType[]).includes(sale.type)) throw new ConflictException("仅等待退货的退货退款或换货申请可登记物流");
      const unchanged = sale.returnLogisticsCompany === logisticsCompany && sale.returnTrackingNo === trackingNo;
      if (version !== sale.version && !(unchanged && version < sale.version)) throw new ConflictException("售后记录已更新，请刷新后重试");
      if (!unchanged) {
        const changed = await tx.commerceAfterSale.updateMany({ where: { id: saleId, orderId, version, status: AfterSaleStatus.WAITING_RETURN },
          data: { returnLogisticsCompany: logisticsCompany, returnTrackingNo: trackingNo, version: { increment: 1 } } });
        if (changed.count !== 1) throw new ConflictException("售后记录已更新，请刷新后重试");
      }
      // Submission is not proof of receipt. Only the administrator confirms RETURNED.
      return tx.commerceAfterSale.findUniqueOrThrow({ where: { id: saleId }, include: { items: true } });
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
          status: { in: [CommerceOrderStatus.RECEIVED, CommerceOrderStatus.COMPLETED, CommerceOrderStatus.CLOSED] },
        },
      },
    });
    if (!item) throw new BadRequestException("订单商品不可评价");
    const existing = await this.prisma.commerceReview.findUnique({ where: { orderItemId } });
    if (existing) {
      if (existing.userId !== userId) throw new ConflictException("该商品评价归属尚未核验");
      return existing;
    }
    try {
    return await this.prisma.commerceReview.create({
      data: {
        userId,
        productId: item.productId,
        orderItemId,
        rating: finiteInteger(Number(body.rating), 5, 1, 5),
        content: required(body.content, "评价内容"),
        images: Array.isArray(body.images) ? body.images.map(String).slice(0, 9) : [],
      },
    });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const saved = await this.prisma.commerceReview.findUnique({ where: { orderItemId } });
        if (saved?.userId === userId) return saved;
      }
      throw error;
    }
  }

}

function stableRequestJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stableRequestJson).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => JSON.stringify(key) + ":" + stableRequestJson(item)).join(",") + "}";
  return JSON.stringify(value) ?? "null";
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
    defaultSku: available[0] ? publicSku(available[0]) : null,
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
