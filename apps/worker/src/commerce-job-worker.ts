import {
  CommerceJobStatus,
  CommerceOrderStatus,
  IntegrationState,
  PaymentStatus,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { createHash } from "node:crypto";
import { settleCommerceCommission } from "@saydian/commerce-domain";
import { shouldPauseWorkers } from "@saydian/app-contracts";
import {
  markWorkerIntegrationVerified,
  resolveWorkerSecrets,
} from "./integration-secrets";

type JstSettings = {
  apiBase: string;
  appKey: string;
  appSecret: string;
  accessToken: string;
  shopId: string;
  paths: Record<string, string>;
};

export class CommerceJobWorker {
  private nextSettlementScan = 0;
  private settlementCursor: string | undefined;
  constructor(private readonly prisma: PrismaClient) {}

  async runOnce(): Promise<boolean> {
    if (shouldPauseWorkers(process.env)) return false;
    await this.scheduleSettlements();
    await this.recoverStaleClaims();
    const job = await this.prisma.commerceIntegrationJob.findFirst({
      where: {
        status: CommerceJobStatus.PENDING,
        nextRunAt: { lte: new Date() },
      },
      orderBy: { createdAt: "asc" },
    });
    if (!job) return false;
    const claimed = await this.prisma.commerceIntegrationJob.updateMany({
      where: { id: job.id, status: CommerceJobStatus.PENDING },
      data: {
        status: CommerceJobStatus.RUNNING,
        attempt: { increment: 1 },
        lockedAt: new Date(),
      },
    });
    if (claimed.count !== 1) return true;
    try {
      await this.dispatch(job.type, asObject(job.payload));
      await this.prisma.commerceIntegrationJob.update({
        where: { id: job.id },
        data: {
          status: CommerceJobStatus.SUCCEEDED,
          finishedAt: new Date(),
          lockedAt: null,
          lastError: null,
        },
      });
    } catch (error) {
      const attempt = job.attempt + 1;
      const exhausted = attempt >= job.maxAttempts || error instanceof PermanentCommerceJobError;
      await this.prisma.commerceIntegrationJob.update({
        where: { id: job.id },
        data: {
          status: exhausted ? CommerceJobStatus.DEAD_LETTER : CommerceJobStatus.PENDING,
          nextRunAt: new Date(
            Date.now() + Math.min(2 ** Math.min(attempt, 10) * 15_000, 3_600_000),
          ),
          lockedAt: null,
          lastError: sanitizeError(error),
        },
      });
    }
    return true;
  }

  private async dispatch(type: string, payload: Record<string, unknown>) {
    const identifier = (key: string) => String(payload[key] ?? "").trim();
    if (type === "COMMISSION_SETTLEMENT") {
      const id = identifier("accrualId");
      const changed = await this.prisma.$transaction((tx) => settleCommerceCommission(tx, id));
      if (!changed) {
        const accrual = await this.prisma.commerceCommissionAccrual.findUnique({ where: { id } });
        if (accrual?.status === "FROZEN") throw new Error("Commission settlement waits for after-sale or migration review");
      }
      return;
    }
    if (type === "JUSHUITAN_ORDER_PUSH") {
      await this.uploadOrder(identifier("orderId"));
      return;
    }
    if (type === "JUSHUITAN_AFTER_SALE_PUSH") {
      await this.uploadAfterSale(identifier("afterSaleId"));
      return;
    }
    if (type === "JUSHUITAN_PRODUCT_SYNC") {
      await this.syncProducts(payload);
      return;
    }
    if (type === "JUSHUITAN_FULFILLMENT_SYNC") {
      await this.syncFulfillment();
      return;
    }
    throw new PermanentCommerceJobError(`Unsupported commerce job: ${type}`);
  }

  private async uploadOrder(orderId: string) {
    if (!orderId) throw new PermanentCommerceJobError("Order job has no orderId");
    const settings = await this.settings();
    if (!settings.shopId) throw new Error("Jushuitan shop id is unconfigured");
    const order = await this.prisma.commerceOrder.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        paymentIntents: { where: { status: PaymentStatus.SUCCEEDED } },
      },
    });
    if (!order) throw new PermanentCommerceJobError("Commerce order not found");
    if (order.executionOwner !== "NEW_SYSTEM") throw new Error("Order takeover has not been verified");
    if (![CommerceOrderStatus.PAID, CommerceOrderStatus.WAITING_FULFILLMENT].includes(order.status as "PAID" | "WAITING_FULFILLMENT")) {
      throw new PermanentCommerceJobError("Order is no longer awaiting ERP fulfillment");
    }
    if (!order.paymentIntents.length) throw new Error("Commerce order is not paid");
    const result = await this.call(settings, settings.paths.orderUpload!, [
      {
        shop_id: Number(settings.shopId),
        so_id: order.orderNo,
        order_date: formatJstDate(order.createdAt),
        shop_status: "WAIT_SELLER_SEND_GOODS",
        shop_buyer_id: order.userId,
        receiver_state: order.province,
        receiver_city: order.city,
        receiver_district: order.district,
        receiver_address: order.addressDetail,
        receiver_name: order.recipientName,
        receiver_mobile: order.recipientMobile,
        pay_amount: order.payableCents / 100,
        freight: order.shippingCents / 100,
        remark: order.adminRemark ?? order.buyerRemark ?? undefined,
        items: order.items.map((item) => ({
          outer_oi_id: item.id,
          sku_id: item.erpSkuIdSnapshot,
          name: item.nameSnapshot,
          properties_value: item.specificationSnapshot,
          qty: item.quantity,
          price: item.unitPriceCents / 100,
          amount: item.totalCents / 100,
        })),
        pay: order.paymentIntents.map((payment) => ({
          outer_pay_id: payment.paymentNo,
          pay_date: formatJstDate(payment.paidAt ?? new Date()),
          payment: payment.channel,
          amount: payment.amountCents / 100,
        })),
      },
    ]);
    const first = rows(result)[0];
    await this.prisma.commerceOrder.update({
      where: { id: order.id },
      data: {
        erpOrderId: first?.o_id ? String(first.o_id) : order.erpOrderId,
        erpShopId: settings.shopId,
        erpStatus: "WAIT_SELLER_SEND_GOODS",
        status: order.status === CommerceOrderStatus.PAID
          ? CommerceOrderStatus.WAITING_FULFILLMENT
          : order.status,
      },
    });
  }

  private async uploadAfterSale(afterSaleId: string) {
    if (!afterSaleId) {
      throw new PermanentCommerceJobError("After-sale job has no afterSaleId");
    }
    const settings = await this.settings();
    if (!settings.shopId) throw new Error("Jushuitan shop id is unconfigured");
    const afterSale = await this.prisma.commerceAfterSale.findUnique({
      where: { id: afterSaleId },
      include: { order: { include: { items: true } }, items: { include: { orderItem: true } } },
    });
    if (!afterSale) throw new PermanentCommerceJobError("After-sale record not found");
    if (afterSale.executionOwner !== "NEW_SYSTEM" || afterSale.order.executionOwner !== "NEW_SYSTEM") throw new Error("After-sale takeover has not been verified");
    if (!["APPROVED", "WAITING_RETURN", "RETURNED"].includes(afterSale.status)) throw new PermanentCommerceJobError("After-sale is no longer approved for ERP submission");
    if (!afterSale.items.length) throw new PermanentCommerceJobError("After-sale lines require migration verification");
    const result = await this.call(settings, settings.paths.afterSaleUpload!, [
      {
        outer_as_id: afterSale.afterSaleNo,
        shop_id: Number(settings.shopId),
        so_id: afterSale.order.orderNo,
        shop_status: "wait",
        type: afterSale.type,
        remark: afterSale.reason,
        total_amount: afterSale.requestedCents / 100,
        refund: afterSale.requestedCents / 100,
        items: afterSale.items.map((item) => ({
          outer_oi_id: item.orderItemId,
          sku_id: item.orderItem.erpSkuIdSnapshot,
          qty: item.quantity,
          amount: item.amountCents / 100,
          type: afterSale.type === "EXCHANGE" ? "换货" : "退货",
        })),
      },
    ]);
    const first = rows(result)[0];
    await this.prisma.commerceAfterSale.update({
      where: { id: afterSale.id },
      data: {
        erpAfterSaleId: first?.as_id ? String(first.as_id) : afterSale.erpAfterSaleId,
        erpStatus: "wait",
      },
    });
  }

  private async syncProducts(payload: Record<string, unknown>) {
    const settings = await this.settings();
    const end = parseDate(payload.modifiedEnd) ?? new Date();
    const begin = parseDate(payload.modifiedBegin) ?? new Date(end.valueOf() - 24 * 3_600_000);
    if (begin >= end || end.valueOf() - begin.valueOf() > 31 * 86_400_000) {
      throw new PermanentCommerceJobError("Product sync window is invalid");
    }
    let page = 1;
    const skuIds: string[] = [];
    do {
      const result = await this.call(settings, settings.paths.sku!, {
        modified_begin: formatJstDate(begin),
        modified_end: formatJstDate(end),
        page_index: page,
        page_size: 100,
      });
      const items = rows(result);
      for (const item of items) {
        const mapped = mapJstProduct(item);
        const existing = await this.prisma.commerceProduct.findUnique({
          where: { erpItemId: mapped.erpItemId },
        });
        if (existing && existing.source !== "ERP") throw new PermanentCommerceJobError("ERP product code conflicts with a local product");
        const existingSku = await this.prisma.commerceSku.findUnique({ where: { erpSkuId: mapped.erpSkuId }, include: { product: true } });
        if (existingSku && existingSku.product.source !== "ERP") throw new PermanentCommerceJobError("ERP SKU code conflicts with a local SKU");
        const product = await this.prisma.commerceProduct.upsert({
          where: { erpItemId: mapped.erpItemId },
          create: {
            erpItemId: mapped.erpItemId,
            source: "ERP",
            name: mapped.name,
            coverImage: mapped.image,
            gallery: [],
            tags: [],
            erpModifiedAt: mapped.modifiedAt,
          },
          update: {
            name: mapped.name,
            coverImage: existing?.coverImage ?? mapped.image,
            erpModifiedAt: mapped.modifiedAt,
          },
        });
        await this.prisma.commerceSku.upsert({
          where: { erpSkuId: mapped.erpSkuId },
          create: {
            erpSkuId: mapped.erpSkuId,
            erpItemId: mapped.erpItemId,
            productId: product.id,
            specification: mapped.specification,
            image: mapped.image,
            salePriceCents: mapped.salePriceCents,
            marketPriceCents: mapped.marketPriceCents,
            costPriceCents: mapped.costPriceCents,
            enabled: mapped.enabled,
            weightGrams: mapped.weightGrams,
            erpModifiedAt: mapped.modifiedAt,
          },
          update: {
            productId: product.id,
            erpItemId: mapped.erpItemId,
            specification: mapped.specification,
            image: mapped.image,
            salePriceCents: mapped.salePriceCents,
            marketPriceCents: mapped.marketPriceCents,
            costPriceCents: mapped.costPriceCents,
            enabled: mapped.enabled,
            weightGrams: mapped.weightGrams,
            erpModifiedAt: mapped.modifiedAt,
          },
        });
        skuIds.push(mapped.erpSkuId);
      }
      if (!hasNext(result) || items.length === 0) break;
      page += 1;
      if (page > 20_000) throw new Error("Jushuitan product pagination exceeded limit");
    } while (true);
    for (let offset = 0; offset < skuIds.length; offset += 100) {
      const result = await this.call(settings, settings.paths.inventory!, {
        sku_ids: skuIds.slice(offset, offset + 100).join(","),
        page_index: 1,
        page_size: 100,
      });
      for (const item of rows(result)) {
        const erpSkuId = String(item.sku_id ?? item.skuId ?? "").trim();
        if (!erpSkuId) continue;
        await this.prisma.commerceSku.updateMany({
          where: { erpSkuId, product: { source: "ERP" } },
          data: {
            stock: Math.max(0, Math.floor(Number(item.avl_qty ?? item.qty ?? item.stock ?? 0))),
          },
        });
      }
    }
  }

  private async syncFulfillment() {
    const settings = await this.settings();
    const orders = await this.prisma.commerceOrder.findMany({
      where: {
        executionOwner: "NEW_SYSTEM",
        status: {
          in: [
            CommerceOrderStatus.WAITING_FULFILLMENT,
            CommerceOrderStatus.SHIPPED,
            CommerceOrderStatus.AFTER_SALE,
          ],
        },
      },
      orderBy: { updatedAt: "asc" },
      take: 100,
    });
    if (!orders.length) return;
    const result = await this.call(settings, settings.paths.fulfillment!, {
      shop_id: Number(settings.shopId),
      so_ids: orders.map((order) => order.orderNo),
    });
    for (const item of rows(result)) {
      const orderNo = String(item.so_id ?? item.order_no ?? "").trim();
      const trackingNo = String(item.l_id ?? item.tracking_no ?? "").trim();
      if (!orderNo || !trackingNo) continue;
      const order = await this.prisma.commerceOrder.findUnique({ where: { orderNo } });
      if (!order) continue;
      await this.prisma.$transaction([
        this.prisma.commerceShipment.upsert({
          where: { orderId_trackingNo: { orderId: order.id, trackingNo } },
          create: {
            orderId: order.id,
            logisticsCompany: String(item.lc_name ?? item.logistics_company ?? "物流公司"),
            logisticsCode: item.lc_id ? String(item.lc_id) : null,
            trackingNo,
            shippedAt: new Date(),
            traceJson: item as Prisma.InputJsonValue,
          },
          update: { traceJson: item as Prisma.InputJsonValue },
        }),
        this.prisma.commerceOrder.updateMany({
          where: { id: order.id, executionOwner: "NEW_SYSTEM", status: { in: [CommerceOrderStatus.WAITING_FULFILLMENT, CommerceOrderStatus.SHIPPED] } },
          data: {
            status: CommerceOrderStatus.SHIPPED,
            version: { increment: 1 },
            shippedAt: order.shippedAt ?? new Date(),
            erpStatus: "SENT",
          },
        }),
      ]);
    }
  }

  private async settings(): Promise<JstSettings> {
    const integration = await this.prisma.integrationConfig.findUnique({
      where: { key: "jushuitan" },
    });
    if (!integration || integration.state !== IntegrationState.CONFIGURED) {
      throw new Error("Jushuitan integration is unconfigured");
    }
    const publicConfig = asObject(integration.publicConfig);
    const customPaths = asObject(publicConfig.paths);
    const secrets = await resolveWorkerSecrets(this.prisma, "jushuitan", {
      appKey: "JUSHUITAN_APP_KEY",
      appSecret: "JUSHUITAN_APP_SECRET",
      accessToken: "JUSHUITAN_ACCESS_TOKEN",
      shopId: "JUSHUITAN_SHOP_ID",
    });
    const appKey = secrets.appKey ?? "";
    const appSecret = secrets.appSecret ?? "";
    const accessToken = secrets.accessToken ?? "";
    if (!appKey || !appSecret || !accessToken) {
      throw new Error("Jushuitan credentials are unconfigured");
    }
    return {
      apiBase: String(publicConfig.apiBase ?? "https://openapi.jushuitan.com").replace(/\/$/, ""),
      appKey,
      appSecret,
      accessToken,
      shopId: String(publicConfig.shopId ?? secrets.shopId ?? ""),
      paths: {
        sku: String(customPaths.sku ?? "/open/sku/query"),
        inventory: String(customPaths.inventory ?? "/open/inventory/query"),
        orderUpload: String(customPaths.orderUpload ?? "/open/jushuitan/orders/upload"),
        afterSaleUpload: String(customPaths.afterSaleUpload ?? "/open/aftersale/upload"),
        fulfillment: String(customPaths.fulfillment ?? "/open/logistic/query"),
      },
    };
  }

  private async scheduleSettlements() {
    if (Date.now() < this.nextSettlementScan) return;
    this.nextSettlementScan = Date.now() + 60_000;
    const due = await this.prisma.commerceCommissionAccrual.findMany({ where: {
      status: "FROZEN", availableAt: { lte: new Date() }, settlementDaysSnapshot: { not: null },
      order: { executionOwner: "NEW_SYSTEM" },
    }, take: 100, orderBy: { id: "asc" },
      ...(this.settlementCursor ? { cursor: { id: this.settlementCursor }, skip: 1 } : {}),
    });
    for (const accrual of due) await this.prisma.commerceIntegrationJob.upsert({
      where: { idempotencyKey: `commission-settlement:${accrual.id}` },
      create: { type: "COMMISSION_SETTLEMENT", aggregateType: "commerce_commission", aggregateId: accrual.id,
        payload: { accrualId: accrual.id }, idempotencyKey: `commission-settlement:${accrual.id}` }, update: {},
    });
    this.settlementCursor = due.length === 100 ? due[due.length - 1]!.id : undefined;
  }

  private async call(
    settings: JstSettings,
    path: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const params: Record<string, string> = {
      access_token: settings.accessToken,
      app_key: settings.appKey,
      timestamp: String(Math.floor(Date.now() / 1_000)),
      version: "2",
      charset: "utf-8",
      biz: JSON.stringify(body ?? {}),
    };
    params.sign = jstSign(params, settings.appSecret);
    const response = await fetch(`${settings.apiBase}${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    let result: Record<string, unknown>;
    try {
      result = asObject(JSON.parse(text));
    } catch {
      throw new Error(`Jushuitan returned non-JSON HTTP ${response.status}`);
    }
    if (
      !response.ok ||
      result.issuccess === false ||
      (result.code !== undefined && Number(result.code) !== 0)
    ) {
      throw new Error(`Jushuitan request failed: ${String(result.msg ?? response.status)}`);
    }
    await markWorkerIntegrationVerified(this.prisma, "jushuitan");
    return { ...asObject(result.data), ...result };
  }

  private async recoverStaleClaims() {
    await this.prisma.commerceIntegrationJob.updateMany({
      where: {
        status: CommerceJobStatus.RUNNING,
        lockedAt: { lt: new Date(Date.now() - 5 * 60_000) },
      },
      data: { status: CommerceJobStatus.PENDING, lockedAt: null },
    });
  }
}

export class PermanentCommerceJobError extends Error {}

export function jstSign(params: Record<string, string>, appSecret: string): string {
  const content = Object.entries(params)
    .filter(([key, value]) => key !== "sign" && value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}${value}`)
    .join("");
  return createHash("md5")
    .update(`${appSecret}${content}`, "utf8")
    .digest("hex")
    .toLowerCase();
}

export function mapJstProduct(row: Record<string, unknown>) {
  const erpSkuId = String(row.sku_id ?? row.skuId ?? "").trim();
  const erpItemId = String(row.i_id ?? row.iId ?? erpSkuId).trim();
  if (!erpSkuId || !erpItemId) throw new Error("Jushuitan product identifiers are missing");
  const modified = row.modified ? new Date(String(row.modified)) : null;
  const weight = Number(row.weight ?? 0);
  return {
    erpSkuId,
    erpItemId,
    name: String(row.name ?? row.short_name ?? erpSkuId),
    specification: row.properties_value ? String(row.properties_value) : null,
    image: row.pic_big ? String(row.pic_big) : row.pic ? String(row.pic) : null,
    salePriceCents: toCents(row.sale_price),
    marketPriceCents: optionalCents(row.market_price),
    costPriceCents: optionalCents(row.cost_price),
    enabled: Number(row.enabled ?? 1) === 1 && Number(row.stock_disabled ?? 0) !== 1,
    weightGrams: Number.isFinite(weight) && weight > 0 ? Math.round(weight * 1_000) : null,
    modifiedAt: modified && !Number.isNaN(modified.valueOf()) ? modified : null,
  };
}

function rows(result: Record<string, unknown>): Record<string, unknown>[] {
  const candidates = [result.datas, result.inventorys, result.data];
  const selected = candidates.find(Array.isArray);
  return Array.isArray(selected) ? selected.map(asObject) : [];
}

function hasNext(result: Record<string, unknown>): boolean {
  return result.has_next === true || asObject(result.data).has_next === true;
}

function toCents(value: unknown): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100)) : 0;
}

function optionalCents(value: unknown): number | null {
  return value === null || value === undefined || value === "" ? null : toCents(value);
}

function formatJstDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.valueOf()) ? null : date;
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sanitizeError(error: unknown): string {
  return (error instanceof Error ? error.message : "commerce job failed")
    .replace(/[\r\n]/g, " ")
    .slice(0, 1_000);
}
