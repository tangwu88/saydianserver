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
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { rowDigest } from "./migrator";

type SourceRow = Record<string, unknown>;
type EntityCounter = { imported: number; skipped: number; conflicted: number };

const sourceCommit = "09963c49f255c146ffab2bfd17b8d0961c655ebd";

export class MallMigrator {
  constructor(
    private readonly source: Pool | PoolClient,
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
    if (process.env.MIGRATION_TARGET_WRITES_FROZEN !== "true") throw new Error("Mall migration requires an explicitly frozen target");
    if (!process.env.MIGRATION_SOURCE_SNAPSHOT_ID?.trim()) throw new Error("Mall migration requires an explicit source snapshot identifier");
    const adoptedWhere = { sourceSystem: "legacy_mall", executionOwner: "NEW_SYSTEM" };
    const adopted = await Promise.all([
      this.target.commerceOrder.count({ where: adoptedWhere }), this.target.paymentIntent.count({ where: adoptedWhere }),
      this.target.paymentRefund.count({ where: adoptedWhere }), this.target.commerceAfterSale.count({ where: adoptedWhere }),
      this.target.commerceWithdrawal.count({ where: adoptedWhere }),
    ]);
    if (adopted.some((count) => count > 0)) throw new Error("Imported transactions have been adopted; source refresh would overwrite new-system business state");
    const run = await this.target.migrationRun.create({
      data: {
        sourceLabel: `saydian-mall@${sourceCommit}`,
        sourceDigest: process.env.MIGRATION_SOURCE_SNAPSHOT_ID?.trim() || null,
        status: "RUNNING",
        startedAt: new Date(),
      },
    });
    const report: Record<string, EntityCounter> = {};
    try {
      for (const step of ["categories", "products", "skus", "employees", "users", "addresses", "carts", "cartItems", "favorites", "orders", "orderItems", "payments", "shipments", "afterSales", "refunds", "reviews", "coupons", "couponClaims", "payoutIdentities", "withdrawals", "commission", "configuration", "financeArchive"] as const) {
        report[step] = await this.target.$transaction(async (tx) => {
          const worker = new MallMigrator(this.source, tx as PrismaClient);
          const result = await worker[step](run.id);
          await tx.migrationCheckpoint.upsert({
            where: { runId_sourceTable: { runId: run.id, sourceTable: step } },
            create: { runId: run.id, sourceSystem: "legacy_mall", sourceTable: step, cursor: "complete", rowCount: result.imported },
            update: { cursor: "complete", rowCount: result.imported },
          });
          return result;
        }, { timeout: 120_000 });
      }
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
      this.target.legacyIdMap.count({ where: { sourceSystem: "legacy_mall", entityType: "mall_order" } }),
      this.target.commerceOrder.aggregate({
        where: { sourceSystem: "legacy_mall" },
        _sum: { payableCents: true },
      }),
      this.target.migrationConflict.count({ where: { runId: run.id } }),
    ]);
    const expectedOrders = Number(sourceOrder.rows[0]?.count ?? 0);
    const expectedAmount = Number(sourceOrder.rows[0]?.amount ?? 0);
    const actualAmount = targetAmount._sum.payableCents ?? 0;
    const latest = asRecord(run.report);
    const importCounters = asRecord(latest.importCounters ?? latest.report ?? latest);
    const unrecordedConflicts = Object.values(importCounters).reduce<number>((sum, value) => sum + Number(asRecord(value).conflicted ?? 0), 0);
    const unmigratedUpdates = await this.target.legacyIdMap.count({ where: { sourceSystem: "legacy_mall", sourceHash: null } });
    const entities = await this.verifyEntities(run.id);
    const archiveOnlyDomains = ["EmployeeCouponGrant", "CouponGift"];
    const unverifiedDomains: string[] = [];
    for (const table of archiveOnlyDomains) {
      const count = await this.source.query(`SELECT COUNT(*)::int AS count FROM "${table}"`);
      if (Number(count.rows[0]?.count ?? 0) > 0) unverifiedDomains.push(`${table}:archived_without_operational_takeover`);
    }
    const matched = mappedOrders === expectedOrders && actualAmount === expectedAmount && conflicts === 0 && unrecordedConflicts === 0 && unmigratedUpdates === 0 &&
      entities.every((entity) => entity.matched) && unverifiedDomains.length === 0;
    const report = {
      runId: run.id,
      sourceCommit,
      orders: { expected: expectedOrders, mapped: mappedOrders },
      orderAmountCents: { expected: expectedAmount, actual: actualAmount },
      conflicts,
      unrecordedConflicts,
      importCounters,
      rowsWithoutSourceDigest: unmigratedUpdates,
      entities,
      unverifiedDomains,
      limitation: "Source row digests and per-entity reconciliation must be complete before cutover; an order total alone is not sufficient.",
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

  private async verifyEntities(runId: string) {
    const checks: { sourceTable: string; entityType: string; sourceCount: number; mappedCount: number; changedOrMissing: number; deletedOrUnseen: number; matched: boolean }[] = [];
    for (const [sourceTable, entityType, idColumn = "id"] of [
      ["Category", "mall_category"], ["Product", "mall_product"], ["Sku", "mall_sku"], ["Employee", "mall_employee"], ["User", "mall_user"],
      ["Address", "mall_address"], ["Cart", "mall_cart"], ["CartItem", "mall_cart_item"], ["Order", "mall_order"], ["OrderItem", "mall_order_item"],
      ["Payment", "mall_payment"], ["Shipment", "mall_shipment"], ["AfterSale", "mall_after_sale"], ["Refund", "mall_refund"], ["Review", "mall_review"],
      ["Coupon", "mall_coupon"], ["CouponClaim", "mall_coupon_claim"], ["Banner", "mall_banner"],
      ["Withdrawal", "mall_withdrawal"], ["EmployeePayoutIdentity", "mall_payout_identity", "employeeId"],
      ["CommissionLedger", "mall_commission_ledger"], ["EmployeeWallet", "mall_employee_wallet", "employeeId"],
      ["CommissionPlan", "mall_commission_plan"], ["CommissionAccrual", "mall_commission_accrual"],
    ] as const) {
      const source = await this.source.query(`SELECT * FROM "${sourceTable}" ORDER BY "${idColumn}"`);
      const mappings = await this.target.legacyIdMap.findMany({ where: { sourceSystem: "legacy_mall", sourceTable, entityType } });
      const byId = new Map(mappings.map((mapping) => [mapping.legacyId, mapping]));
      let changedOrMissing = 0;
      for (const row of source.rows as SourceRow[]) {
        const mapping = byId.get(text(row[idColumn]));
        if (!mapping || mapping.sourceHash !== rowDigest(row)) changedOrMissing += 1;
      }
      const sourceIds = new Set((source.rows as SourceRow[]).map((row) => text(row[idColumn])));
      const deletedOrUnseen = mappings.filter((mapping) => !sourceIds.has(mapping.legacyId) || mapping.runId !== runId).length;
      checks.push({ sourceTable, entityType, sourceCount: source.rows.length, mappedCount: mappings.length, changedOrMissing, deletedOrUnseen,
        matched: source.rows.length === mappings.length && changedOrMissing === 0 && deletedOrUnseen === 0 });
    }
    return checks;
  }

  private async categories(runId: string) {
    const counter = emptyCounter();
    const rows = await this.read("Category");
    for (const row of rows) {
      const legacyId = text(row.id);
      const saved = await this.target.commerceCategory.upsert(sourceUpsert({
        where: { legacyId },
        create: {
          legacyId,
          name: text(row.name),
          iconUrl: nullable(row.iconUrl),
          sort: integer(row.sort),
          enabled: row.enabled !== false,
        },
        update: {},
      }));
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
      const saved = await this.target.commerceProduct.upsert(sourceUpsert({
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
      }));
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
      const saved = await this.target.commerceSku.upsert(sourceUpsert({
        where: { erpSkuId: text(row.erpSkuId) },
        create: {
          legacyId,
          erpSkuId: text(row.erpSkuId),
          erpItemId: text(row.erpItemId),
          productId,
          specification: nullable(row.specification),
          barcode: nullable(row.barcode),
          image: nullable(row.image),
          salePriceCents: sourceCents(row.salePriceCents),
          marketPriceCents: nullableInteger(row.marketPriceCents),
          costPriceCents: nullableInteger(row.costPriceCents),
          stock: Math.max(0, integer(row.stock)),
          weightGrams: nullableInteger(row.weightGrams),
          enabled: row.enabled !== false,
          erpModifiedAt: date(row.erpModifiedAt),
        },
        update: {},
      }));
      await this.map(runId, "mall_sku", legacyId, saved.id, "Sku");
      counter.imported += 1;
    }
    return counter;
  }

  private async employees(runId: string) {
    const counter = emptyCounter();
    for (const row of await this.read("Employee")) {
      const legacyId = text(row.id);
      const saved = await this.target.commerceEmployee.upsert(sourceUpsert({
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
      }));
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
    return this.importUserOwned(runId, "Address", "mall_address", async (row, userId, existingId) => {
      const saved = await this.target.commerceAddress.upsert(sourceUpsert({
        where: { id: existingId ?? randomUUID() },
        create: {
          legacyId: text(row.id),
          userId,
          name: text(row.name), mobile: text(row.mobile), province: text(row.province),
          provinceCode: nullable(row.provinceCode), city: text(row.city), cityCode: nullable(row.cityCode),
          district: text(row.district), districtCode: nullable(row.districtCode), detail: text(row.detail),
          postalCode: nullable(row.postalCode), isDefault: row.isDefault === true,
          createdAt: sourceDate(row.createdAt), updatedAt: sourceDate(row.updatedAt),
        }, update: {},
      }));
      return saved.id;
    });
  }

  private async carts(runId: string) {
    return this.importUserOwned(runId, "Cart", "mall_cart", async (row, userId) => {
      const saved = await this.target.commerceCart.upsert(sourceUpsert({
        where: { userId }, create: { userId }, update: {},
      }));
      return saved.id;
    });
  }

  private async cartItems(runId: string) {
    const counter = emptyCounter();
    for (const row of await this.read("CartItem")) {
      const cartId = await this.targetId("mall_cart", text(row.cartId));
      const skuId = await this.targetId("mall_sku", text(row.skuId));
      if (!cartId || !skuId) { counter.conflicted += 1; continue; }
      const saved = await this.target.commerceCartItem.upsert(sourceUpsert({
        where: { cartId_skuId: { cartId, skuId } },
        create: { cartId, skuId, quantity: Math.max(1, integer(row.quantity)), selected: row.selected !== false },
        update: {},
      }));
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
      await this.target.commerceFavorite.upsert(sourceUpsert({
        where: { userId_productId: { userId, productId } },
        create: { userId, productId, createdAt: sourceDate(row.createdAt) }, update: {},
      }));
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
      const saved = await this.target.commerceOrder.upsert(sourceUpsert({
        where: { orderNo: text(row.orderNo) },
        create: {
          legacyId, sourceSystem: "legacy_mall", executionOwner: "LEGACY_SYSTEM", orderNo: text(row.orderNo), userId, status: orderStatus(row.status),
          referralEmployeeId: employeeId, referralCodeSnapshot: nullable(row.referralCodeSnapshot),
          subtotalCents: sourceCents(row.subtotalCents), discountCents: sourceCents(row.discountCents),
          shippingCents: sourceCents(row.shippingCents), payableCents: sourceCents(row.payableCents),
          recipientName: text(row.recipientName), recipientMobile: text(row.recipientMobile),
          province: text(row.province), city: text(row.city), district: text(row.district),
          addressDetail: text(row.addressDetail), buyerRemark: nullable(row.buyerRemark), adminRemark: nullable(row.adminRemark),
          invoiceJson: row.invoiceJson ? json(row.invoiceJson) : Prisma.JsonNull,
          erpShopId: nullable(row.erpShopId), erpOrderId: nullable(row.erpOrderId), erpStatus: nullable(row.erpStatus),
          idempotencyKey: `mall-order:${legacyId}`, paidAt: date(row.paidAt), shippedAt: date(row.shippedAt),
          receivedAt: date(row.receivedAt), cancelledAt: date(row.cancelledAt),
          createdAt: sourceDate(row.createdAt), updatedAt: sourceDate(row.updatedAt),
        }, update: {},
      }));
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
      const saved = await this.target.commerceOrderItem.upsert(sourceUpsert({
        where: { id: existing ?? randomUUID() },
        create: {
          orderId, productId, skuId, erpSkuIdSnapshot: text(row.erpSkuIdSnapshot),
          nameSnapshot: text(row.nameSnapshot), specificationSnapshot: nullable(row.specificationSnapshot),
          imageSnapshot: nullable(row.imageSnapshot), unitPriceCents: sourceCents(row.unitPriceCents),
          quantity: integer(row.quantity), totalCents: sourceCents(row.totalCents),
        }, update: {},
      }));
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
      const saved = await this.target.paymentIntent.upsert(sourceUpsert({
        where: { paymentNo: text(row.paymentNo) },
        create: {
          paymentNo: text(row.paymentNo), sourceSystem: "legacy_mall", executionOwner: "LEGACY_SYSTEM", userId: order.userId, businessType: BusinessType.COMMERCE_ORDER,
          businessId: order.id, commerceOrderId: order.id, channel: paymentChannel(row.channel),
          status: paymentStatus(row.status), amountCents: sourceCents(row.amountCents),
          description: `迁移商城订单 ${order.orderNo}`, idempotencyKey: `mall-payment:${legacyId}`,
          providerTransactionId: nullable(row.providerTransactionId),
          providerMerchantId: nullable(row.providerMerchantId), providerAppId: nullable(row.providerAppId),
          providerPayload: row.providerPayload ? json(row.providerPayload) : Prisma.JsonNull,
          paidAt: date(row.paidAt), createdAt: sourceDate(row.createdAt), updatedAt: sourceDate(row.updatedAt),
        }, update: {},
      }));
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
      const saved = await this.target.commerceShipment.upsert(sourceUpsert({
        where: { orderId_trackingNo: { orderId, trackingNo: text(row.trackingNo) } },
        create: {
          orderId, logisticsCompany: text(row.logisticsCompany), logisticsCode: nullable(row.logisticsCode),
          trackingNo: text(row.trackingNo), traceJson: row.traceJson ? json(row.traceJson) : Prisma.JsonNull,
          shippedAt: date(row.shippedAt), deliveredAt: date(row.deliveredAt),
        }, update: {},
      }));
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
      const saved = await this.target.commerceAfterSale.upsert(sourceUpsert({
        where: { afterSaleNo: text(row.afterSaleNo) },
        create: {
          legacyId, sourceSystem: "legacy_mall", executionOwner: "LEGACY_SYSTEM", afterSaleNo: text(row.afterSaleNo), orderId, type: afterSaleType(row.type),
          status: afterSaleStatus(row.status), reason: text(row.reason), description: nullable(row.description),
          evidenceImages: strings(row.evidenceImages), requestedCents: sourceCents(row.requestedCents),
          erpAfterSaleId: nullable(row.erpAfterSaleId), erpStatus: nullable(row.erpStatus),
          returnLogisticsCompany: nullable(row.returnLogisticsCompany), returnTrackingNo: nullable(row.returnTrackingNo),
          createdAt: sourceDate(row.createdAt), updatedAt: sourceDate(row.updatedAt),
        }, update: {},
      }));
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
      const saved = await this.target.paymentRefund.upsert(sourceUpsert({
        where: { refundNo: text(row.refundNo) },
        create: {
          refundNo: text(row.refundNo), sourceSystem: "legacy_mall", executionOwner: "LEGACY_SYSTEM", paymentIntentId, afterSaleId, status: refundStatus(row.status),
          amountCents: sourceCents(row.amountCents), reason: text(row.reason), idempotencyKey: `mall-refund:${legacyId}`,
          providerRefundId: nullable(row.providerRefundId),
          providerPayload: row.providerPayload ? json(row.providerPayload) : Prisma.JsonNull,
          completedAt: date(row.completedAt), createdAt: sourceDate(row.createdAt), updatedAt: sourceDate(row.updatedAt),
        }, update: {},
      }));
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
      const saved = await this.target.commerceReview.upsert(sourceUpsert({
        where: { orderItemId },
        create: { userId, productId, orderItemId, rating: integer(row.rating), content: text(row.content), images: strings(row.images), published: row.published !== false },
        update: {},
      }));
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
      const saved = await this.target.commerceCoupon.upsert(sourceUpsert({
        where: { id: existingId ?? randomUUID() },
        create: {
          name: text(row.name), type: CouponType.CASH, status: couponStatus(row.status), value: integer(row.value),
          minimumSpendCents: sourceCents(row.minimumSpendCents), totalQuantity: nullableInteger(row.totalQuantity),
          claimedQuantity: integer(row.claimedQuantity), employeeDistributable: row.employeeDistributable === true,
          perEmployeeLimit: integer(row.perEmployeeLimit), validFrom: date(row.validFrom) ?? new Date(),
          validUntil: date(row.validUntil) ?? new Date(), createdAt: sourceDate(row.createdAt),
          updatedAt: sourceDate(row.updatedAt),
        }, update: {},
      }));
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
      const saved = await this.target.commerceCouponClaim.upsert(sourceUpsert({
        where: { couponId_userId: { couponId, userId } },
        create: { couponId, userId, orderId, claimedAt: date(row.claimedAt) ?? new Date(), usedAt: date(row.usedAt), sourceEmployeeId, sourceGiftId: nullable(row.sourceGiftId) },
        update: {},
      }));
      await this.map(runId, "mall_coupon_claim", text(row.id), saved.id, "CouponClaim");
      counter.imported += 1;
    }
    return counter;
  }

  private async commission(runId: string) {
    const counter = emptyCounter();
    const plans = await this.read("CommissionPlan");
    for (const row of plans) {
      const plan = await this.target.commerceCommissionPlan.upsert(sourceUpsert({
        where: { id: "default" },
        create: {
          id: "default", enabled: row.enabled === true, rateBps: integer(row.rateBps), settlementDays: sourceCents(row.settlementDays), enabledAt: date(row.enabledAt),
          withdrawalEnabled: row.withdrawalEnabled === true,
          minimumWithdrawCents: row.minimumWithdrawCents == null ? null : sourceCents(row.minimumWithdrawCents),
          dailyWithdrawLimitCents: row.dailyWithdrawLimitCents == null ? null : sourceCents(row.dailyWithdrawLimitCents),
          // Reviewed manual payout remains mandatory even if the original plan allowed automation.
          reviewRequired: true,
          createdAt: sourceDate(row.createdAt), updatedAt: sourceDate(row.updatedAt),
        },
        update: {},
      }));
      await this.map(runId, "mall_commission_plan", text(row.id), plan.id, "CommissionPlan");
      counter.imported += 1;
    }
    for (const row of await this.read("EmployeeWallet")) {
      const employeeId = await this.targetId("mall_employee", text(row.employeeId));
      if (!employeeId) { counter.conflicted += 1; continue; }
      await this.target.commerceEmployeeWallet.upsert(sourceUpsert({
        where: { employeeId },
        create: { employeeId, frozenCents: sourceCents(row.frozenCents), availableCents: sourceCents(row.availableCents), withdrawingCents: sourceCents(row.withdrawingCents), debtCents: sourceCents(row.debtCents), totalPaidCents: sourceCents(row.totalPaidCents) },
        update: {},
      }));
      await this.map(runId, "mall_employee_wallet", text(row.employeeId), employeeId, "EmployeeWallet", "employeeId");
      counter.imported += 1;
    }
    for (const row of await this.read("CommissionAccrual")) {
      const employeeId = await this.targetId("mall_employee", text(row.employeeId));
      const orderId = await this.targetId("mall_order", text(row.orderId));
      if (!employeeId || !orderId) { counter.conflicted += 1; continue; }
      const accrual = await this.target.commerceCommissionAccrual.upsert(sourceUpsert({
        where: { orderId },
        create: { employeeId, orderId, baseCents: sourceCents(row.baseCents), refundedBaseCents: sourceCents(row.refundedBaseCents), rateBps: integer(row.rateBps), grossBonusCents: sourceCents(row.grossBonusCents), reversedBonusCents: sourceCents(row.reversedBonusCents), status: text(row.status), availableAt: date(row.availableAt), settledAt: date(row.settledAt), createdAt: sourceDate(row.createdAt), updatedAt: sourceDate(row.updatedAt), settlementDaysSnapshot: row.settlementDaysSnapshot == null ? null : sourceCents(row.settlementDaysSnapshot) },
        update: {},
      }));
      await this.map(runId, "mall_commission_accrual", text(row.id), accrual.id, "CommissionAccrual");
      counter.imported += 1;
    }
    for (const row of await this.read("CommissionLedger")) {
      const employeeId = await this.targetId("mall_employee", text(row.employeeId));
      if (!employeeId) { counter.conflicted += 1; continue; }
      const orderId = row.orderId ? await this.targetId("mall_order", text(row.orderId)) : null;
      const refundId = row.refundId ? await this.targetId("mall_refund", text(row.refundId)) : null;
      const withdrawalId = row.withdrawalId ? await this.targetId("mall_withdrawal", text(row.withdrawalId)) : null;
      if ((row.refundId && !refundId) || (row.withdrawalId && !withdrawalId)) { counter.conflicted += 1; continue; }
      const withdrawal = withdrawalId ? await this.target.commerceWithdrawal.findUnique({ where: { id: withdrawalId } }) : null;
      const type = text(row.type);
      const withdrawingDeltaCents = !withdrawal ? 0 : type === "WITHDRAW_HOLD" ? withdrawal.amountCents : ["WITHDRAW_RELEASE", "WITHDRAW_SUCCESS"].includes(type) ? -withdrawal.amountCents : 0;
      const paidDeltaCents = type === "WITHDRAW_SUCCESS" ? withdrawal?.amountCents ?? 0 : 0;
      const ledger = await this.target.commerceCommissionLedger.upsert(sourceUpsert({
        where: { idempotencyKey: text(row.idempotencyKey) },
        create: { employeeId, orderId, refundId, withdrawalId, withdrawingDeltaCents, paidDeltaCents, type, frozenDeltaCents: sourceCents(row.frozenDeltaCents), availableDeltaCents: sourceCents(row.availableDeltaCents), debtDeltaCents: sourceCents(row.debtDeltaCents), idempotencyKey: text(row.idempotencyKey), memo: nullable(row.memo), createdAt: sourceDate(row.createdAt) },
        update: {},
      }));
      await this.map(runId, "mall_commission_ledger", text(row.id), ledger.id, "CommissionLedger");
      counter.imported += 1;
    }
    return counter;
  }

  private async payoutIdentities(runId: string) {
    const counter = emptyCounter();
    for (const row of await this.read("EmployeePayoutIdentity")) {
      const employeeId = await this.targetId("mall_employee", text(row.employeeId));
      if (!employeeId || !text(row.openId)) { counter.conflicted += 1; continue; }
      await this.target.commerceEmployeePayoutIdentity.upsert(sourceUpsert({
        where: { employeeId }, create: { employeeId, openId: text(row.openId), authorizationId: nullable(row.authorizationId),
          outAuthorizationNo: nullable(row.outAuthorizationNo), authorizationStatus: text(row.authorizationStatus),
          authorizedAt: date(row.authorizedAt), revokedAt: date(row.revokedAt) }, update: {},
      }));
      await this.map(runId, "mall_payout_identity", text(row.employeeId), employeeId, "EmployeePayoutIdentity", "employeeId");
      counter.imported += 1;
    }
    return counter;
  }

  private async withdrawals(runId: string) {
    const counter = emptyCounter();
    for (const row of await this.read("Withdrawal")) {
      const employeeId = await this.targetId("mall_employee", text(row.employeeId));
      const status = text(row.status);
      if (!employeeId || !["SUBMITTED", "APPROVED", "PROCESSING", "WAIT_USER_CONFIRM", "SUCCEEDED", "FAILED", "REJECTED", "CANCELLED"].includes(status) ||
        !Number.isSafeInteger(row.amountCents) || Number(row.amountCents) <= 0 || !text(row.withdrawalNo)) {
        await this.conflict(runId, "mall_withdrawal", text(row.id), "提现原身份、编号、状态或分单位金额未验证", "Withdrawal");
        counter.conflicted += 1; continue;
      }
      if (["PROCESSING", "WAIT_USER_CONFIRM", "SUCCEEDED"].includes(status) && (!text(row.providerBillId) || !text(row.openIdSnapshot))) {
        await this.conflict(runId, "mall_withdrawal", text(row.id), "在途或成功提现缺原转账号或收款身份，不能接管", "Withdrawal");
        counter.conflicted += 1; continue;
      }
      const saved = await this.target.commerceWithdrawal.upsert(sourceUpsert({
        where: { legacyId: text(row.id) }, create: {
          legacyId: text(row.id), sourceSystem: "legacy_mall", executionOwner: "LEGACY_SYSTEM", withdrawalNo: text(row.withdrawalNo),
          employeeId, amountCents: Number(row.amountCents), status, providerTransferId: nullable(row.providerBillId),
          idempotencyKey: `mall-withdrawal:${text(row.id)}`, requestHash: rowDigest({ employeeId, amountCents: row.amountCents, sourceId: row.id }),
          payoutIdentitySnapshot: { openId: nullable(row.openIdSnapshot), authorizationId: nullable(row.authorizationIdSnapshot) },
          providerPayload: row.providerPayload ? json(row.providerPayload) : Prisma.JsonNull,
          packageInfo: nullable(row.packageInfo), failureReason: nullable(row.failureReason),
          reviewedAt: date(row.reviewedAt), completedAt: date(row.completedAt), paidAt: status === "SUCCEEDED" ? date(row.completedAt) : null,
          createdAt: sourceDate(row.createdAt), updatedAt: sourceDate(row.updatedAt),
        }, update: {},
      }));
      await this.map(runId, "mall_withdrawal", text(row.id), saved.id, "Withdrawal");
      counter.imported += 1;
    }
    return counter;
  }

  private async configuration(runId: string) {
    const counter = emptyCounter();
    for (const row of await this.read("BusinessConfig")) {
      await this.target.commerceBusinessConfig.upsert(sourceUpsert({
        where: { key: text(row.key) },
        create: { key: text(row.key), label: text(row.label), value: row.value ? json(row.value) : Prisma.JsonNull, enabled: row.enabled === true },
        update: {},
      }));
      counter.imported += 1;
    }
    for (const row of await this.read("Banner")) {
      const saved = await this.target.commerceBanner.upsert(sourceUpsert({
        where: { legacyId: text(row.id) },
        create: { legacyId: text(row.id), title: text(row.title), imageUrl: text(row.imageUrl), targetUrl: nullable(row.targetUrl), sort: integer(row.sort), enabled: row.enabled !== false },
        update: {},
      }));
      await this.map(runId, "mall_banner", text(row.id), saved.id, "Banner");
      counter.imported += 1;
    }
    return counter;
  }

  private async financeArchive(runId: string) {
    const counter = emptyCounter();
    for (const table of ["Withdrawal", "EmployeePayoutIdentity", "CommissionPlan", "EmployeeCouponGrant", "CouponGift"] as const) {
      for (const row of await this.read(table)) {
        const employeeLegacyId = text(row.employeeId);
        const employeeId = employeeLegacyId ? await this.targetId("mall_employee", employeeLegacyId) : null;
        await this.target.legacyCommerceFinanceProjection.upsert(sourceUpsert({
          where: { sourceType_legacyId: { sourceType: `mall_${table.toLowerCase()}`, legacyId: text(row.id ?? row.employeeId) } },
          create: { employeeId, sourceType: `mall_${table.toLowerCase()}`, legacyId: text(row.id ?? row.employeeId), snapshot: json(row), occurredAt: date(row.createdAt) },
          update: {},
        }));
        counter.imported += 1;
      }
    }
    return counter;
  }

  private async importUserOwned(
    runId: string,
    table: string,
    entityType: string,
    create: (row: SourceRow, userId: string, existingId: string | null) => Promise<string>,
  ) {
    const counter = emptyCounter();
    for (const row of await this.read(table)) {
      const legacyId = text(row.id);
      const existing = await this.targetId(entityType, legacyId);
      const userId = await this.targetId("mall_user", text(row.userId));
      if (!userId) {
        await this.conflict(runId, entityType, legacyId, "会员映射缺失", table);
        counter.conflicted += 1; continue;
      }
      const targetId = await create(row, userId, existing);
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

  private async map(runId: string, entityType: string, legacyId: string, targetId: string, sourceTable: string, idColumn = "id") {
    if (!/^[A-Za-z0-9_]+$/.test(sourceTable) || !/^[A-Za-z0-9_]+$/.test(idColumn)) throw new Error("Unsafe source table or column");
    const rows = await this.source.query(`SELECT * FROM "${sourceTable}" WHERE "${idColumn}" = $1 LIMIT 1`, [legacyId]);
    const sourceRow = rows.rows[0] as SourceRow | undefined;
    if (!sourceRow) throw new Error("Source row disappeared inside the migration snapshot");
    const sourceHash = rowDigest(sourceRow);
    await this.target.legacyIdMap.upsert({
      where: { sourceSystem_entityType_legacyId: { sourceSystem: "legacy_mall", entityType, legacyId } },
      create: { sourceSystem: "legacy_mall", entityType, legacyId, targetId, sourceTable, runId, sourceHash },
      update: { runId, sourceHash, sourceUpdatedAt: date(sourceRow.updatedAt), sourceDeletedAt: null },
    });
  }

  private async targetId(entityType: string, legacyId: string) {
    if (!legacyId) return null;
    return (await this.target.legacyIdMap.findUnique({
      where: { sourceSystem_entityType_legacyId: { sourceSystem: "legacy_mall", entityType, legacyId } },
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

function sourceUpsert<T extends { create: object; update: object }>(input: T): T {
  return { ...input, update: { ...input.create, ...input.update } };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function sourceCents(value: unknown): number {
  if (value === null || value === undefined || !/^-?\d+$/.test(String(value))) throw new Error("Source amount in cents is missing or invalid");
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < -2_147_483_648 || amount > 2_147_483_647) throw new Error("Source amount in cents is out of range");
  return amount;
}

function sourceDate(value: unknown): Date {
  const parsed = date(value);
  if (!parsed) throw new Error("Source historical timestamp is missing or invalid");
  return parsed;
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
  if (!["PUBLISHED", "DISABLED", "DRAFT"].includes(status)) throw new Error("Unknown source product status");
  return status === "PUBLISHED" ? ProductStatus.PUBLISHED : status === "DISABLED" ? ProductStatus.OFF_SHELF : ProductStatus.DRAFT;
}
function orderStatus(value: unknown): CommerceOrderStatus {
  const status = text(value).toUpperCase();
  if (status === "ERP_SYNCING") return CommerceOrderStatus.WAITING_FULFILLMENT;
  if (!Object.values(CommerceOrderStatus).includes(status as CommerceOrderStatus)) throw new Error("Unknown source order status");
  return status as CommerceOrderStatus;
}
function paymentChannel(value: unknown): PaymentChannel {
  const status = text(value).toUpperCase() as PaymentChannel;
  if (!Object.values(PaymentChannel).includes(status) || status === PaymentChannel.APPLE_IAP) throw new Error("Unknown source mall payment channel");
  return status;
}
function paymentStatus(value: unknown): PaymentStatus {
  const status = text(value).toUpperCase() as PaymentStatus;
  if (!Object.values(PaymentStatus).includes(status)) throw new Error("Unknown source payment status");
  return status;
}
function afterSaleType(value: unknown): AfterSaleType {
  const type = text(value).toUpperCase() as AfterSaleType;
  if (!Object.values(AfterSaleType).includes(type)) throw new Error("Unknown source after-sale type");
  return type;
}
function afterSaleStatus(value: unknown): AfterSaleStatus {
  const status = text(value).toUpperCase();
  if (status === "ERP_SYNCING" || status === "PROCESSING") return AfterSaleStatus.REVIEWING;
  if (status === "RECEIVED") return AfterSaleStatus.RETURNED;
  if (!Object.values(AfterSaleStatus).includes(status as AfterSaleStatus)) throw new Error("Unknown source after-sale status");
  return status as AfterSaleStatus;
}
function refundStatus(value: unknown): RefundStatus {
  const status = text(value).toUpperCase() as RefundStatus;
  if (!Object.values(RefundStatus).includes(status)) throw new Error("Unknown source refund status");
  return status;
}
function couponStatus(value: unknown): CouponStatus {
  const status = text(value).toUpperCase() as CouponStatus;
  if (!Object.values(CouponStatus).includes(status)) throw new Error("Unknown source coupon status");
  return status;
}
