import {
  AfterSaleStatus,
  AfterSaleType,
  BusinessType,
  CommerceOrderStatus,
  CouponStatus,
  CouponType,
  PaymentChannel,
  PaymentStatus,
  Prisma,
  PrismaClient,
  ProductStatus,
  RefundStatus,
} from "@prisma/client";
import type { Pool } from "pg";

type SourceRow = Record<string, unknown>;
type EntityCounter = { imported: number; skipped: number; conflicted: number };

const sourceCommit = "09963c49f255c146ffab2bfd17b8d0961c655ebd";

export class MallMigrator {
  constructor(
    private readonly source: Pool,
    private readonly target: PrismaClient,
  ) {}

  async inspect() {
    const [tables, counts] = await Promise.all([
      this.source.query(
        "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
      ),
      this.source.query(
        "SELECT relname AS name, n_live_tup::bigint AS estimated_rows FROM pg_stat_user_tables ORDER BY relname",
      ),
    ]);
    return {
      sourceLabel: `saydian-mall@${sourceCommit}`,
      tables: tables.rows,
      estimatedCounts: counts.rows,
      inspectedAt: new Date().toISOString(),
      note: "只读取商城结构和估算数量，不读取密钥、会话或短信验证码",
    };
  }

  async migrate() {
    const run = await this.target.migrationRun.create({
      data: {
        sourceLabel: `saydian-mall@${sourceCommit}`,
        sourceDigest: sourceCommit,
        status: "RUNNING",
        startedAt: new Date(),
      },
    });
    const report: Record<string, EntityCounter> = {};
    try {
      report.categories = await this.categories(run.id);
      report.products = await this.products(run.id);
      report.skus = await this.skus(run.id);
      report.employees = await this.employees(run.id);
      report.users = await this.users(run.id);
      report.addresses = await this.addresses(run.id);
      report.carts = await this.carts(run.id);
      report.cartItems = await this.cartItems(run.id);
      report.favorites = await this.favorites(run.id);
      report.orders = await this.orders(run.id);
      report.orderItems = await this.orderItems(run.id);
      report.payments = await this.payments(run.id);
      report.shipments = await this.shipments(run.id);
      report.afterSales = await this.afterSales(run.id);
      report.refunds = await this.refunds(run.id);
      report.reviews = await this.reviews(run.id);
      report.coupons = await this.coupons(run.id);
      report.couponClaims = await this.couponClaims(run.id);
      report.commission = await this.commission(run.id);
      report.configuration = await this.configuration(run.id);
      report.financeArchive = await this.financeArchive(run.id);
      await this.target.migrationRun.update({
        where: { id: run.id },
        data: {
          status: "VERIFYING",
          report: json(report),
        },
      });
      return { runId: run.id, sourceCommit, report };
    } catch (error) {
      await this.target.migrationRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          report: json({ report, error: cleanError(error) }),
        },
      });
      throw error;
    }
  }

  async verify(runId?: string) {
    const run = runId
      ? await this.target.migrationRun.findUniqueOrThrow({ where: { id: runId } })
      : await this.target.migrationRun.findFirstOrThrow({
          where: { sourceLabel: `saydian-mall@${sourceCommit}` },
          orderBy: { createdAt: "desc" },
        });
    const sourceOrder = await this.source.query(
      'SELECT COUNT(*)::int AS count, COALESCE(SUM("payableCents"),0)::bigint AS amount FROM "Order"',
    );
    const [mappedOrders, targetAmount, conflicts] = await Promise.all([
      this.target.legacyIdMap.count({ where: { runId: run.id, entityType: "mall_order" } }),
      this.target.commerceOrder.aggregate({
        where: { legacyId: { not: null } },
        _sum: { payableCents: true },
      }),
      this.target.migrationConflict.count({ where: { runId: run.id } }),
    ]);
    const expectedOrders = Number(sourceOrder.rows[0]?.count ?? 0);
    const expectedAmount = Number(sourceOrder.rows[0]?.amount ?? 0);
    const actualAmount = targetAmount._sum.payableCents ?? 0;
    const matched = mappedOrders === expectedOrders && actualAmount === expectedAmount;
    const report = {
      runId: run.id,
      sourceCommit,
      orders: { expected: expectedOrders, mapped: mappedOrders },
      orderAmountCents: { expected: expectedAmount, actual: actualAmount },
      conflicts,
      matched,
      verifiedAt: new Date().toISOString(),
    };
    await this.target.migrationRun.update({
      where: { id: run.id },
      data: {
        status: matched ? "COMPLETED" : "FAILED",
        completedAt: new Date(),
        report: json(report),
      },
    });
    return report;
  }

  private async categories(runId: string) {
    const counter = emptyCounter();
    const rows = await this.read("Category");
    for (const row of rows) {
      const legacyId = text(row.id);
      const saved = await this.target.commerceCategory.upsert({
        where: { legacyId },
        create: {
          legacyId,
          name: text(row.name),
          iconUrl: nullable(row.iconUrl),
          sort: integer(row.sort),
          enabled: row.enabled !== false,
        },
        update: {},
      });
      await this.map(runId, "mall_category", legacyId, saved.id, "Category");
      counter.imported += 1;
    }
    for (const row of rows) {
      if (!row.parentId) continue;
      const [saved, parent] = await Promise.all([
        this.target.commerceCategory.findUnique({ where: { legacyId: text(row.id) } }),
        this.target.commerceCategory.findUnique({ where: { legacyId: text(row.parentId) } }),
      ]);
      if (saved && parent) {
        await this.target.commerceCategory.update({ where: { id: saved.id }, data: { parentId: parent.id } });
      }
    }
    return counter;
  }

  private async products(runId: string) {
    const counter = emptyCounter();
    for (const row of await this.read("Product")) {
      const legacyId = text(row.id);
      const categoryId = row.categoryId
        ? await this.targetId("mall_category", text(row.categoryId))
        : null;
      const saved = await this.target.commerceProduct.upsert({
        where: { erpItemId: text(row.erpItemId) },
        create: {
          legacyId,
          erpItemId: text(row.erpItemId),
          source: text(row.source) || "ERP",
          localArchived: row.localArchived === true,
          name: text(row.name),
          displayName: nullable(row.displayName),
          subtitle: nullable(row.subtitle),
          brand: nullable(row.brand),
          coverImage: nullable(row.coverImage),
          gallery: strings(row.gallery),
          detailHtml: nullable(row.detailHtml),
          tags: strings(row.tags),
          categoryId,
          status: productStatus(row.status),
          featured: row.featured === true,
          sort: integer(row.sort),
          sales: integer(row.sales),
          erpModifiedAt: date(row.erpModifiedAt),
        },
        update: {},
      });
      await this.map(runId, "mall_product", legacyId, saved.id, "Product");
      counter.imported += 1;
    }
    return counter;
  }

  private async skus(runId: string) {
    const counter = emptyCounter();
    for (const row of await this.read("Sku")) {
      const productId = await this.targetId("mall_product", text(row.productId));
      if (!productId) {
        await this.conflict(runId, "mall_sku", text(row.id), "商品映射缺失", "Sku");
        counter.conflicted += 1;
        continue;
      }
      const legacyId = text(row.id);
      const saved = await this.target.commerceSku.upsert({
        where: { erpSkuId: text(row.erpSkuId) },
        create: {
          legacyId,
          erpSkuId: text(row.erpSkuId),
          erpItemId: text(row.erpItemId),
          productId,
          specification: nullable(row.specification),
          barcode: nullable(row.barcode),
          image: nullable(row.image),
          salePriceCents: integer(row.salePriceCents),
          marketPriceCents: nullableInteger(row.marketPriceCents),
          costPriceCents: nullableInteger(row.costPriceCents),
          stock: Math.max(0, integer(row.stock)),
          weightGrams: nullableInteger(row.weightGrams),
          enabled: row.enabled !== false,
          erpModifiedAt: date(row.erpModifiedAt),
        },
        update: {},
      });
      await this.map(runId, "mall_sku", legacyId, saved.id, "Sku");
      counter.imported += 1;
    }
    return counter;
  }

  private async employees(runId: string) {
    const counter = emptyCounter();
    for (const row of await this.read("Employee")) {
      const legacyId = text(row.id);
      const saved = await this.target.commerceEmployee.upsert({
        where: { wecomUserId: text(row.wecomUserId) },
        create: {
          legacyId,
          wecomUserId: text(row.wecomUserId),
          name: text(row.name),
          mobile: nullable(row.mobile),
          departmentNames: strings(row.departmentNames),
          referralCode: text(row.referralCode),
          avatarUrl: nullable(row.avatarUrl),
          active: row.active !== false,
        },
        update: {},
      });
      await this.map(runId, "mall_employee", legacyId, saved.id, "Employee");
      counter.imported += 1;
    }
    return counter;
  }

  private async users(runId: string) {
    const counter = emptyCounter();
    const rows = await this.source.query(
      'SELECT u.*, i."externalUserId" FROM "User" u LEFT JOIN "AppUserIdentity" i ON i."userId" = u.id ORDER BY u.id',
    );
    for (const row of rows.rows as SourceRow[]) {
      const legacyId = text(row.id);
      const explicitId = text(row.externalUserId);
      const user = explicitId
        ? await this.target.user.findUnique({ where: { id: explicitId } }).catch(() => null)
        : null;
      if (!user) {
        await this.conflict(
          runId,
          "mall_user",
          legacyId,
          "缺少可验证的App会员UUID，禁止按手机号自动合并",
          "User",
          { hasMobile: Boolean(row.mobile), hasUnionId: Boolean(row.wechatUnionId) },
        );
        counter.conflicted += 1;
        continue;
      }
      const referralEmployeeId = row.referralEmployeeId
        ? await this.targetId("mall_employee", text(row.referralEmployeeId))
        : null;
      if (referralEmployeeId && !user.referralEmployeeId) {
        await this.target.user.update({ where: { id: user.id }, data: { referralEmployeeId } });
      }
      await this.map(runId, "mall_user", legacyId, user.id, "User");
      counter.imported += 1;
    }
    return counter;
  }

  private async addresses(runId: string) {
    return this.importUserOwned(runId, "Address", "mall_address", async (row, userId) => {
      const saved = await this.target.commerceAddress.create({
        data: {
          userId,
          name: text(row.name), mobile: text(row.mobile), province: text(row.province),
          provinceCode: nullable(row.provinceCode), city: text(row.city), cityCode: nullable(row.cityCode),
          district: text(row.district), districtCode: nullable(row.districtCode), detail: text(row.detail),
          postalCode: nullable(row.postalCode), isDefault: row.isDefault === true,
          createdAt: date(row.createdAt) ?? new Date(), updatedAt: date(row.updatedAt) ?? new Date(),
        },
      });
      return saved.id;
    });
  }

  private async carts(runId: string) {
    return this.importUserOwned(runId, "Cart", "mall_cart", async (row, userId) => {
      const saved = await this.target.commerceCart.upsert({
        where: { userId }, create: { userId }, update: {},
      });
      return saved.id;
    });
  }

  private async cartItems(runId: string) {
    const counter = emptyCounter();
    for (const row of await this.read("CartItem")) {
      const cartId = await this.targetId("mall_cart", text(row.cartId));
      const skuId = await this.targetId("mall_sku", text(row.skuId));
      if (!cartId || !skuId) { counter.conflicted += 1; continue; }
      const saved = await this.target.commerceCartItem.upsert({
        where: { cartId_skuId: { cartId, skuId } },
        create: { cartId, skuId, quantity: Math.max(1, integer(row.quantity)), selected: row.selected !== false },
        update: {},
      });
      await this.map(runId, "mall_cart_item", text(row.id), saved.id, "CartItem");
      counter.imported += 1;
    }
    return counter;
  }

  private async favorites(runId: string) {
    const counter = emptyCounter();
    for (const row of await this.read("Favorite")) {
      const userId = await this.targetId("mall_user", text(row.userId));
      const productId = await this.targetId("mall_product", text(row.productId));
      if (!userId || !productId) { counter.conflicted += 1; continue; }
      await this.target.commerceFavorite.upsert({
        where: { userId_productId: { userId, productId } },
        create: { userId, productId, createdAt: date(row.createdAt) ?? new Date() }, update: {},
      });
      counter.imported += 1;
    }
    return counter;
  }

  private async orders(runId: string) {
    const counter = emptyCounter();
    for (const row of await this.read("Order")) {
      const userId = await this.targetId("mall_user", text(row.userId));
      if (!userId) {
        await this.conflict(runId, "mall_order", text(row.id), "会员映射缺失", "Order");
        counter.conflicted += 1; continue;
      }
      const employeeId = row.referralEmployeeId ? await this.targetId("mall_employee", text(row.referralEmployeeId)) : null;
      const legacyId = text(row.id);
      const saved = await this.target.commerceOrder.upsert({
        where: { orderNo: text(row.orderNo) },
        create: {
          legacyId, orderNo: text(row.orderNo), userId, status: orderStatus(row.status),
          referralEmployeeId: employeeId, referralCodeSnapshot: nullable(row.referralCodeSnapshot),
          subtotalCents: integer(row.subtotalCents), discountCents: integer(row.discountCents),
          shippingCents: integer(row.shippingCents), payableCents: integer(row.payableCents),
          recipientName: text(row.recipientName), recipientMobile: text(row.recipientMobile),
          province: text(row.province), city: text(row.city), district: text(row.district),
          addressDetail: text(row.addressDetail), buyerRemark: nullable(row.buyerRemark), adminRemark: nullable(row.adminRemark),
          invoiceJson: row.invoiceJson ? json(row.invoiceJson) : Prisma.JsonNull,
          erpShopId: nullable(row.erpShopId), erpOrderId: nullable(row.erpOrderId), erpStatus: nullable(row.erpStatus),
          idempotencyKey: `mall-order:${legacyId}`, paidAt: date(row.paidAt), shippedAt: date(row.shippedAt),
          receivedAt: date(row.receivedAt), cancelledAt: date(row.cancelledAt),
          createdAt: date(row.createdAt) ?? new Date(), updatedAt: date(row.updatedAt) ?? new Date(),
        }, update: {},
      });
      await this.map(runId, "mall_order", legacyId, saved.id, "Order");
      counter.imported += 1;
    }
    return counter;
  }

  private async orderItems(runId: string) {
    const counter = emptyCounter();
    for (const row of await this.read("OrderItem")) {
      const orderId = await this.targetId("mall_order", text(row.orderId));
      const productId = await this.targetId("mall_product", text(row.productId));
      const skuId = await this.targetId("mall_sku", text(row.skuId));
      if (!orderId || !productId || !skuId) { counter.conflicted += 1; continue; }
      const existing = await this.targetId("mall_order_item", text(row.id));
      const saved = existing ? { id: existing } : await this.target.commerceOrderItem.create({
        data: {
          orderId, productId, skuId, erpSkuIdSnapshot: text(row.erpSkuIdSnapshot),
          nameSnapshot: text(row.nameSnapshot), specificationSnapshot: nullable(row.specificationSnapshot),
          imageSnapshot: nullable(row.imageSnapshot), unitPriceCents: integer(row.unitPriceCents),
          quantity: integer(row.quantity), totalCents: integer(row.totalCents),
        },
      });
      await this.map(runId, "mall_order_item", text(row.id), saved.id, "OrderItem");
      counter.imported += 1;
    }
    return counter;
  }

  private async payments(runId: string) {
    const counter = emptyCounter();
    for (const row of await this.read("Payment")) {
      const orderId = await this.targetId("mall_order", text(row.orderId));
      const order = orderId ? await this.target.commerceOrder.findUnique({ where: { id: orderId } }) : null;
      if (!order) { counter.conflicted += 1; continue; }
      const legacyId = text(row.id);
      const saved = await this.target.paymentIntent.upsert({
        where: { paymentNo: text(row.paymentNo) },
        create: {
          paymentNo: text(row.paymentNo), userId: order.userId, businessType: BusinessType.COMMERCE_ORDER,
          businessId: order.id, commerceOrderId: order.id, channel: paymentChannel(row.channel),
          status: paymentStatus(row.status), amountCents: integer(row.amountCents),
          description: `迁移商城订单 ${order.orderNo}`, idempotencyKey: `mall-payment:${legacyId}`,
          providerTransactionId: nullable(row.providerTransactionId),
          providerPayload: row.providerPayload ? json(row.providerPayload) : Prisma.JsonNull,
          paidAt: date(row.paidAt), createdAt: date(row.createdAt) ?? new Date(), updatedAt: date(row.updatedAt) ?? new Date(),
        }, update: {},
      });
      await this.map(runId, "mall_payment", legacyId, saved.id, "Payment");
      counter.imported += 1;
    }
    return counter;
  }

  private async shipments(runId: string) {
    const counter = emptyCounter();
    for (const row of await this.read("Shipment")) {
      const orderId = await this.targetId("mall_order", text(row.orderId));
      if (!orderId) { counter.conflicted += 1; continue; }
      const saved = await this.target.commerceShipment.upsert({
        where: { orderId_trackingNo: { orderId, trackingNo: text(row.trackingNo) } },
        create: {
          orderId, logisticsCompany: text(row.logisticsCompany), logisticsCode: nullable(row.logisticsCode),
          trackingNo: text(row.trackingNo), traceJson: row.traceJson ? json(row.traceJson) : Prisma.JsonNull,
          shippedAt: date(row.shippedAt), deliveredAt: date(row.deliveredAt),
        }, update: {},
      });
      await this.map(runId, "mall_shipment", text(row.id), saved.id, "Shipment");
      counter.imported += 1;
    }
    return counter;
  }

  private async afterSales(runId: string) {
    const counter = emptyCounter();
    for (const row of await this.read("AfterSale")) {
      const orderId = await this.targetId("mall_order", text(row.orderId));
      if (!orderId) { counter.conflicted += 1; continue; }
      const legacyId = text(row.id);
      const saved = await this.target.commerceAfterSale.upsert({
        where: { afterSaleNo: text(row.afterSaleNo) },
        create: {
          legacyId, afterSaleNo: text(row.afterSaleNo), orderId, type: afterSaleType(row.type),
          status: afterSaleStatus(row.status), reason: text(row.reason), description: nullable(row.description),
          evidenceImages: strings(row.evidenceImages), requestedCents: integer(row.requestedCents),
          erpAfterSaleId: nullable(row.erpAfterSaleId), erpStatus: nullable(row.erpStatus),
          returnLogisticsCompany: nullable(row.returnLogisticsCompany), returnTrackingNo: nullable(row.returnTrackingNo),
          createdAt: date(row.createdAt) ?? new Date(), updatedAt: date(row.updatedAt) ?? new Date(),
        }, update: {},
      });
      await this.map(runId, "mall_after_sale", legacyId, saved.id, "AfterSale");
      counter.imported += 1;
    }
    return counter;
  }

  private async refunds(runId: string) {
    const counter = emptyCounter();
    for (const row of await this.read("Refund")) {
      const paymentIntentId = await this.targetId("mall_payment", text(row.paymentId));
      const afterSaleId = row.afterSaleId ? await this.targetId("mall_after_sale", text(row.afterSaleId)) : null;
      if (!paymentIntentId) { counter.conflicted += 1; continue; }
      const legacyId = text(row.id);
      const saved = await this.target.paymentRefund.upsert({
        where: { refundNo: text(row.refundNo) },
        create: {
          refundNo: text(row.refundNo), paymentIntentId, afterSaleId, status: refundStatus(row.status),
          amountCents: integer(row.amountCents), reason: text(row.reason), idempotencyKey: `mall-refund:${legacyId}`,
          providerRefundId: nullable(row.providerRefundId),
          providerPayload: row.providerPayload ? json(row.providerPayload) : Prisma.JsonNull,
          completedAt: date(row.completedAt), createdAt: date(row.createdAt) ?? new Date(), updatedAt: date(row.updatedAt) ?? new Date(),
        }, update: {},
      });
      await this.map(runId, "mall_refund", legacyId, saved.id, "Refund");
      counter.imported += 1;
    }
    return counter;
  }

  private async reviews(runId: string) {
    const counter = emptyCounter();
    for (const row of await this.read("Review")) {
      const userId = await this.targetId("mall_user", text(row.userId));
      const productId = await this.targetId("mall_product", text(row.productId));
      const orderItemId = await this.targetId("mall_order_item", text(row.orderItemId));
      if (!userId || !productId || !orderItemId) { counter.conflicted += 1; continue; }
      const saved = await this.target.commerceReview.upsert({
        where: { orderItemId },
        create: { userId, productId, orderItemId, rating: integer(row.rating), content: text(row.content), images: strings(row.images), published: row.published !== false },
        update: {},
      });
      await this.map(runId, "mall_review", text(row.id), saved.id, "Review");
      counter.imported += 1;
    }
    return counter;
  }

  private async coupons(runId: string) {
    const counter = emptyCounter();
    for (const row of await this.read("Coupon")) {
      if (text(row.type).toUpperCase() !== "FIXED") {
        await this.conflict(runId, "mall_coupon", text(row.id), "折扣券暂不转换为定额券", "Coupon");
        counter.conflicted += 1; continue;
      }
      const existingId = await this.targetId("mall_coupon", text(row.id));
      const saved = existingId ? { id: existingId } : await this.target.commerceCoupon.create({
        data: {
          name: text(row.name), type: CouponType.CASH, status: couponStatus(row.status), value: integer(row.value),
          minimumSpendCents: integer(row.minimumSpendCents), totalQuantity: nullableInteger(row.totalQuantity),
          claimedQuantity: integer(row.claimedQuantity), employeeDistributable: row.employeeDistributable === true,
          perEmployeeLimit: integer(row.perEmployeeLimit), validFrom: date(row.validFrom) ?? new Date(),
          validUntil: date(row.validUntil) ?? new Date(), createdAt: date(row.createdAt) ?? new Date(),
          updatedAt: date(row.updatedAt) ?? new Date(),
        },
      });
      await this.map(runId, "mall_coupon", text(row.id), saved.id, "Coupon");
      counter.imported += 1;
    }
    return counter;
  }

  private async couponClaims(runId: string) {
    const counter = emptyCounter();
    for (const row of await this.read("CouponClaim")) {
      const couponId = await this.targetId("mall_coupon", text(row.couponId));
      const userId = await this.targetId("mall_user", text(row.userId));
      if (!couponId || !userId) { counter.conflicted += 1; continue; }
      const orderId = row.orderId ? await this.targetId("mall_order", text(row.orderId)) : null;
      const sourceEmployeeId = row.sourceEmployeeId ? await this.targetId("mall_employee", text(row.sourceEmployeeId)) : null;
      const saved = await this.target.commerceCouponClaim.upsert({
        where: { couponId_userId: { couponId, userId } },
        create: { couponId, userId, orderId, claimedAt: date(row.claimedAt) ?? new Date(), usedAt: date(row.usedAt), sourceEmployeeId, sourceGiftId: nullable(row.sourceGiftId) },
        update: {},
      });
      await this.map(runId, "mall_coupon_claim", text(row.id), saved.id, "CouponClaim");
      counter.imported += 1;
    }
    return counter;
  }

  private async commission(runId: string) {
    const counter = emptyCounter();
    const plans = await this.read("CommissionPlan");
    for (const row of plans) {
      await this.target.commerceCommissionPlan.upsert({
        where: { id: "default" },
        create: { id: "default", enabled: row.enabled === true, rateBps: integer(row.rateBps), settlementDays: integer(row.settlementDays) || 7, enabledAt: date(row.enabledAt) },
        update: {},
      });
      counter.imported += 1;
    }
    for (const row of await this.read("EmployeeWallet")) {
      const employeeId = await this.targetId("mall_employee", text(row.employeeId));
      if (!employeeId) { counter.conflicted += 1; continue; }
      await this.target.commerceEmployeeWallet.upsert({
        where: { employeeId },
        create: { employeeId, frozenCents: integer(row.frozenCents), availableCents: integer(row.availableCents), withdrawingCents: integer(row.withdrawingCents), debtCents: integer(row.debtCents), totalPaidCents: integer(row.totalPaidCents) },
        update: {},
      });
      counter.imported += 1;
    }
    for (const row of await this.read("CommissionAccrual")) {
      const employeeId = await this.targetId("mall_employee", text(row.employeeId));
      const orderId = await this.targetId("mall_order", text(row.orderId));
      if (!employeeId || !orderId) { counter.conflicted += 1; continue; }
      await this.target.commerceCommissionAccrual.upsert({
        where: { orderId },
        create: { employeeId, orderId, baseCents: integer(row.baseCents), refundedBaseCents: integer(row.refundedBaseCents), rateBps: integer(row.rateBps), grossBonusCents: integer(row.grossBonusCents), reversedBonusCents: integer(row.reversedBonusCents), status: text(row.status), availableAt: date(row.availableAt), settledAt: date(row.settledAt) },
        update: {},
      });
      counter.imported += 1;
    }
    for (const row of await this.read("CommissionLedger")) {
      const employeeId = await this.targetId("mall_employee", text(row.employeeId));
      if (!employeeId) { counter.conflicted += 1; continue; }
      const orderId = row.orderId ? await this.targetId("mall_order", text(row.orderId)) : null;
      await this.target.commerceCommissionLedger.upsert({
        where: { idempotencyKey: text(row.idempotencyKey) },
        create: { employeeId, orderId, refundId: nullable(row.refundId), type: text(row.type), frozenDeltaCents: integer(row.frozenDeltaCents), availableDeltaCents: integer(row.availableDeltaCents), debtDeltaCents: integer(row.debtDeltaCents), idempotencyKey: text(row.idempotencyKey), memo: nullable(row.memo), createdAt: date(row.createdAt) ?? new Date() },
        update: {},
      });
      counter.imported += 1;
    }
    return counter;
  }

  private async configuration(runId: string) {
    const counter = emptyCounter();
    for (const row of await this.read("BusinessConfig")) {
      await this.target.commerceBusinessConfig.upsert({
        where: { key: text(row.key) },
        create: { key: text(row.key), label: text(row.label), value: row.value ? json(row.value) : Prisma.JsonNull, enabled: row.enabled === true },
        update: {},
      });
      counter.imported += 1;
    }
    for (const row of await this.read("Banner")) {
      const saved = await this.target.commerceBanner.upsert({
        where: { legacyId: text(row.id) },
        create: { legacyId: text(row.id), title: text(row.title), imageUrl: text(row.imageUrl), targetUrl: nullable(row.targetUrl), sort: integer(row.sort), enabled: row.enabled !== false },
        update: {},
      });
      await this.map(runId, "mall_banner", text(row.id), saved.id, "Banner");
      counter.imported += 1;
    }
    return counter;
  }

  private async financeArchive(runId: string) {
    const counter = emptyCounter();
    for (const table of ["Withdrawal", "EmployeePayoutIdentity", "EmployeeCouponGrant", "CouponGift"] as const) {
      for (const row of await this.read(table)) {
        const employeeLegacyId = text(row.employeeId);
        const employeeId = employeeLegacyId ? await this.targetId("mall_employee", employeeLegacyId) : null;
        await this.target.legacyCommerceFinanceProjection.upsert({
          where: { sourceType_legacyId: { sourceType: `mall_${table.toLowerCase()}`, legacyId: text(row.id ?? row.employeeId) } },
          create: { employeeId, sourceType: `mall_${table.toLowerCase()}`, legacyId: text(row.id ?? row.employeeId), snapshot: json(row), occurredAt: date(row.createdAt) },
          update: {},
        });
        counter.imported += 1;
      }
    }
    return counter;
  }

  private async importUserOwned(
    runId: string,
    table: string,
    entityType: string,
    create: (row: SourceRow, userId: string) => Promise<string>,
  ) {
    const counter = emptyCounter();
    for (const row of await this.read(table)) {
      const legacyId = text(row.id);
      const existing = await this.targetId(entityType, legacyId);
      if (existing) { counter.skipped += 1; continue; }
      const userId = await this.targetId("mall_user", text(row.userId));
      if (!userId) {
        await this.conflict(runId, entityType, legacyId, "会员映射缺失", table);
        counter.conflicted += 1; continue;
      }
      const targetId = await create(row, userId);
      await this.map(runId, entityType, legacyId, targetId, table);
      counter.imported += 1;
    }
    return counter;
  }

  private async read(table: string): Promise<SourceRow[]> {
    const allowed = new Set([
      "Address", "AfterSale", "Banner", "BusinessConfig", "Cart", "CartItem", "Category",
      "CommissionAccrual", "CommissionLedger", "CommissionPlan", "Coupon", "CouponClaim",
      "CouponGift", "Employee", "EmployeeCouponGrant", "EmployeePayoutIdentity", "EmployeeWallet",
      "Favorite", "Order", "OrderItem", "Payment", "Product", "Refund", "Review", "Shipment", "Sku", "Withdrawal",
    ]);
    if (!allowed.has(table)) throw new Error(`Unsupported source table: ${table}`);
    return (await this.source.query(`SELECT * FROM "${table}" ORDER BY 1`)).rows as SourceRow[];
  }

  private async map(runId: string, entityType: string, legacyId: string, targetId: string, sourceTable: string) {
    await this.target.legacyIdMap.upsert({
      where: { entityType_legacyId: { entityType, legacyId } },
      create: { entityType, legacyId, targetId, sourceTable, runId },
      update: {},
    });
  }

  private async targetId(entityType: string, legacyId: string) {
    if (!legacyId) return null;
    return (await this.target.legacyIdMap.findUnique({
      where: { entityType_legacyId: { entityType, legacyId } },
      select: { targetId: true },
    }))?.targetId ?? null;
  }

  private async conflict(runId: string, entityType: string, legacyId: string, reason: string, sourceTable: string, snapshot: Record<string, unknown> = {}) {
    await this.target.migrationConflict.upsert({
      where: { runId_entityType_legacyId: { runId, entityType, legacyId } },
      create: { runId, entityType, legacyId, reason, snapshot: json({ sourceTable, ...snapshot }) },
      update: { reason, snapshot: json({ sourceTable, ...snapshot }) },
    });
  }
}

function emptyCounter(): EntityCounter { return { imported: 0, skipped: 0, conflicted: 0 }; }
function text(value: unknown): string { return String(value ?? "").trim(); }
function nullable(value: unknown): string | null { return value === null || value === undefined || text(value) === "" ? null : text(value); }
function integer(value: unknown): number { const number = Number(value ?? 0); return Number.isFinite(number) ? Math.trunc(number) : 0; }
function nullableInteger(value: unknown): number | null { return value === null || value === undefined ? null : integer(value); }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.map(text).filter(Boolean) : []; }
function date(value: unknown): Date | null { if (!value) return null; const result = value instanceof Date ? value : new Date(String(value)); return Number.isNaN(result.valueOf()) ? null : result; }
function json(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue; }
function cleanError(error: unknown): string { return (error instanceof Error ? error.message : "mall migration failed").replace(/[\r\n]/g, " ").slice(0, 500); }

function productStatus(value: unknown): ProductStatus {
  const status = text(value).toUpperCase();
  return status === "PUBLISHED" ? ProductStatus.PUBLISHED : status === "DISABLED" ? ProductStatus.OFF_SHELF : ProductStatus.DRAFT;
}
function orderStatus(value: unknown): CommerceOrderStatus {
  const status = text(value).toUpperCase();
  if (status === "ERP_SYNCING") return CommerceOrderStatus.WAITING_FULFILLMENT;
  return Object.values(CommerceOrderStatus).includes(status as CommerceOrderStatus) ? status as CommerceOrderStatus : CommerceOrderStatus.PENDING_PAYMENT;
}
function paymentChannel(value: unknown): PaymentChannel {
  const status = text(value).toUpperCase() as PaymentChannel;
  if (!Object.values(PaymentChannel).includes(status) || status === PaymentChannel.APPLE_IAP) return PaymentChannel.WECHAT_APP;
  return status;
}
function paymentStatus(value: unknown): PaymentStatus {
  const status = text(value).toUpperCase() as PaymentStatus;
  return Object.values(PaymentStatus).includes(status) ? status : PaymentStatus.CREATED;
}
function afterSaleType(value: unknown): AfterSaleType {
  const type = text(value).toUpperCase() as AfterSaleType;
  return Object.values(AfterSaleType).includes(type) ? type : AfterSaleType.REFUND_ONLY;
}
function afterSaleStatus(value: unknown): AfterSaleStatus {
  const status = text(value).toUpperCase();
  if (status === "ERP_SYNCING" || status === "PROCESSING") return AfterSaleStatus.REVIEWING;
  if (status === "RECEIVED") return AfterSaleStatus.RETURNED;
  return Object.values(AfterSaleStatus).includes(status as AfterSaleStatus) ? status as AfterSaleStatus : AfterSaleStatus.APPLIED;
}
function refundStatus(value: unknown): RefundStatus {
  const status = text(value).toUpperCase() as RefundStatus;
  return Object.values(RefundStatus).includes(status) ? status : RefundStatus.CREATED;
}
function couponStatus(value: unknown): CouponStatus {
  const status = text(value).toUpperCase() as CouponStatus;
  return Object.values(CouponStatus).includes(status) ? status : CouponStatus.DRAFT;
}
