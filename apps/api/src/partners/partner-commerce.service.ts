import { productPage, productCategoryFilter } from "../commerce/product-list-query";
import { orderErpSnapshot } from "../commerce/order-erp-snapshot";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  Prisma,
  PaymentChannel,
  PaymentStatus,
  BusinessType,
} from "@prisma/client";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../common/prisma.service";
import { isUuid, safeObject, sha256 } from "../common/crypto";
import { markPaymentStockItems } from "../commerce/commerce-payment-stock";
import { completeCommercePayment } from "../commerce/commerce-payment-settlement";
import { postPartnerLedger, PARTNER_MAX_CENTS } from "./partner-ledger";

export function partnerPage(pageInput: unknown, sizeInput: unknown = 30) {
  const page = Math.min(
    1_000_000,
    Math.max(1, Math.trunc(Number(pageInput)) || 1),
  );
  const pageSize = Math.min(
    100,
    Math.max(1, Math.trunc(Number(sizeInput)) || 30),
  );
  return { page, pageSize, skip: (page - 1) * pageSize };
}
export function partnerRequestKey(input: unknown) {
  const key = String(input ?? "").trim();
  if (!/^[A-Za-z0-9:_-]{8,90}$/.test(key))
    throw new BadRequestException("请求编号不正确");
  return key;
}
export function partnerNumber(prefix: string) {
  return `${prefix}${Date.now()}${randomBytes(5).toString("hex")}`;
}
function positiveCents(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > PARTNER_MAX_CENTS)
    throw new BadRequestException("采购金额超出范围");
  return value;
}
function purchaseItems(input: unknown) {
  if (!Array.isArray(input) || !input.length || input.length > 100)
    throw new BadRequestException("请选择1至100个商品规格");
  const seen = new Set<string>();
  return input
    .map((raw) => {
      const item = safeObject(raw),
        skuId = String(item.skuId ?? ""),
        quantity = Number(item.quantity);
      if (
        !isUuid(skuId) ||
        seen.has(skuId) ||
        !Number.isSafeInteger(quantity) ||
        quantity < 1 ||
        quantity > 9999
      )
        throw new BadRequestException("商品规格或数量不正确");
      seen.add(skuId);
      return { skuId, quantity };
    })
    .sort((a, b) => a.skuId.localeCompare(b.skuId));
}
function purchaseAddress(input: unknown) {
  const body = safeObject(input);
  const text = (key: string, max: number, optional = false) => {
    const value = String(body[key] ?? "").trim();
    if ((!optional && !value) || value.length > max)
      throw new BadRequestException("请填写完整、有效的收货地址");
    return value;
  };
  const recipientMobile = text("recipientMobile", 30);
  if (!/^\+?[0-9 ()-]{6,30}$/.test(recipientMobile))
    throw new BadRequestException("收货手机号不正确");
  const countryCode = (text("countryCode", 2, true) || "CN").toUpperCase();
  if (countryCode !== "CN")
    throw new BadRequestException("当前采购仅支持中国大陆收货地址");
  return {
    recipientName: text("recipientName", 80),
    recipientMobile,
    countryCode,
    province: text("province", 80),
    city: text("city", 80),
    district: text("district", 80, true),
    addressDetail: text("addressDetail", 300),
    postalCode: text("postalCode", 20, true) || null,
  };
}
const partnerOrderInclude = {
  items: true,
  paymentIntents: {
    select: {
      id: true,
      paymentNo: true,
      channel: true,
      status: true,
      amountCents: true,
      paidAt: true,
    },
  },
  shipments: {
    select: {
      id: true,
      logisticsCompany: true,
      logisticsCode: true,
      trackingNo: true,
      shippedAt: true,
      deliveredAt: true,
      items: { select: { orderItemId: true, quantity: true } },
    },
  },
  afterSales: {
    select: {
      id: true,
      afterSaleNo: true,
      type: true,
      status: true,
      requestedCents: true,
      reason: true,
      createdAt: true,
    },
  },
} satisfies Prisma.CommerceOrderInclude;

@Injectable()
export class PartnerCommerceService {
  constructor(private readonly prisma: PrismaService) {}

  private async currentPartner(
    tx: Prisma.TransactionClient,
    partnerId: string,
  ) {
    const partner = await tx.brandPartner.findFirst({
      where: { id: partnerId, active: true },
      include: { level: true },
    });
    if (!partner) throw new NotFoundException("品牌伙伴账户不可用");
    if (!partner.level.active)
      throw new ConflictException("合作等级暂未开放采购，请联系总后台");
    return partner;
  }

  async products(partnerId: string, search: string, pageInput: unknown, sizeInput: unknown = 10, categoryId = "") {
    const partner = await this.currentPartner(this.prisma, partnerId),
      { page, pageSize, skip } = productPage(pageInput, sizeInput);
    const pricedSku: Prisma.CommerceSkuWhereInput = {
      enabled: true,
      partnerPrices: {
        some: {
          levelId: partner.levelId,
          enabled: true,
          priceCents: { gt: 0, lte: PARTNER_MAX_CENTS },
        },
      },
    };
    const category = await productCategoryFilter(this.prisma, categoryId);
    const where: Prisma.CommerceProductWhereInput = {
      ...category.where,
      source: { in: ["ERP", "LOCAL"] },
      localArchived: false,
      status: "PUBLISHED",
      skus: { some: pricedSku },
      ...(search
        ? {
            OR: [
              { name: { contains: search.trim(), mode: "insensitive" } },
              {
                skus: {
                  some: {
                    ...pricedSku,
                    partnerPrices: {
                      some: {
                        levelId: partner.levelId,
                        enabled: true,
                        priceCents: { gt: 0, lte: PARTNER_MAX_CENTS },
                        OR: [
                          {
                            productName: {
                              contains: search.trim(),
                              mode: "insensitive",
                            },
                          },
                          {
                            specification: {
                              contains: search.trim(),
                              mode: "insensitive",
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.commerceProduct.findMany({
        where,
        include: {
          skus: {
            where: pricedSku,
            orderBy: { id: "asc" },
            include: {
              partnerPrices: {
                where: {
                  levelId: partner.levelId,
                  enabled: true,
                  priceCents: { gt: 0, lte: PARTNER_MAX_CENTS },
                },
              },
            },
          },
        },
        orderBy: [{ sort: "asc" }, { id: "asc" }],
        skip,
        take: pageSize,
      }),
      this.prisma.commerceProduct.count({ where }),
    ]);
    return {
      level: partner.level.name,
      items: rows.map((row) => ({
        id: row.id,
        erpItemId: row.erpItemId,
        name:
          new Set(
            row.skus.map(
              (sku) =>
                sku.partnerPrices[0]?.productName ??
                (row.displayName || row.name),
            ),
          ).size === 1
            ? (row.skus[0]?.partnerPrices[0]?.productName ??
              (row.displayName || row.name))
            : row.displayName || row.name,
        coverImage: row.coverImage,
        subtitle: row.subtitle,
        fulfillmentSource: row.source,
        skus: row.skus.map((sku) => ({
          id: sku.id,
          name:
            sku.partnerPrices[0]?.productName ?? (row.displayName || row.name),
          specification:
            sku.partnerPrices[0]?.specification ?? sku.specification,
          retailPriceCents:
            sku.partnerPrices[0]?.retailPriceCents ?? sku.salePriceCents,
          image: sku.image,
          stock: sku.stock,
          distributionPriceCents: sku.partnerPrices[0]?.priceCents ?? null,
          purchasable: Boolean(sku.partnerPrices[0]) && sku.stock > 0,
        })),
      })),
      total,
      page,
      pageSize,
      categories: category.categories,
    };
  }

  private async readQuote(
    tx: Prisma.TransactionClient,
    partnerId: string,
    input: unknown,
  ) {
    const partner = await this.currentPartner(tx, partnerId),
      requested = purchaseItems(input);
    const prices = await tx.partnerSkuPrice.findMany({
      where: {
        levelId: partner.levelId,
        skuId: { in: requested.map((item) => item.skuId) },
        enabled: true,
        sku: {
          enabled: true,
          product: {
            status: "PUBLISHED",
            localArchived: false,
            source: { in: ["ERP", "LOCAL"] },
          },
        },
      },
      include: { sku: { include: { product: true } } },
    });
    const lines = requested.map((item) => {
      const price = prices.find((row) => row.skuId === item.skuId);
      if (!price)
        throw new ConflictException(
          "部分商品未设置合作价或已下架，请刷新商品列表",
        );
      if (price.sku.stock <= 0)
        throw new ConflictException("部分商品暂无库存，请刷新商品列表后重新选择");
      return {
        skuId: item.skuId,
        fulfillmentSource: price.sku.product.source,
        productId: price.sku.productId,
        quantity: item.quantity,
        unitPriceCents: positiveCents(price.priceCents),
        totalCents: positiveCents(price.priceCents * item.quantity),
        name:
          price.productName ??
          (price.sku.product.displayName || price.sku.product.name),
        specification: price.specification ?? price.sku.specification,
        image: price.sku.image || price.sku.product.coverImage,
        erpSkuId: price.sku.erpSkuId,
      };
    });
    if (new Set(lines.map((line) => line.fulfillmentSource)).size !== 1)
      throw new ConflictException("不同发货来源的商品，请分别下单");
    const shipping = await tx.commerceBusinessConfig.findUnique({
      where: { key: "shipping.default" },
    });
    const shippingValue = safeObject(shipping?.value);
    const shippingCents = shipping?.enabled
      ? Number(shippingValue.amountCents ?? 0)
      : 0;
    if (
      !Number.isSafeInteger(shippingCents) ||
      shippingCents < 0 ||
      shippingCents > PARTNER_MAX_CENTS
    )
      throw new ConflictException("运费配置不正确，请联系总后台");
    const subtotalCents = positiveCents(
        lines.reduce((sum, item) => sum + item.totalCents, 0),
      ),
      payableCents = positiveCents(subtotalCents + shippingCents);
    const fingerprint = sha256(
      JSON.stringify({
        partnerId,
        levelId: partner.levelId,
        lines: lines.map((item) => ({
          skuId: item.skuId,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          fulfillmentSource: item.fulfillmentSource,
          name: item.name,
          specification: item.specification,
        })),
        shippingCents,
      }),
    );
    return {
      lines,
      levelId: partner.levelId,
      level: partner.level.name,
      subtotalCents,
      shippingCents,
      payableCents,
      currency: "CNY",
      fingerprint,
    };
  }

  quote(partnerId: string, input: unknown) {
    return this.prisma.$transaction((tx) =>
      this.readQuote(tx, partnerId, safeObject(input).items),
    );
  }

  async createOrder(partnerId: string, input: unknown) {
    const body = safeObject(input),
      requested = purchaseItems(body.items),
      address = purchaseAddress(body.address);
    const expectedQuote = String(body.expectedQuote ?? ""),
      key = `partner-order:${partnerId}:${partnerRequestKey(body.idempotencyKey)}`;
    const buyerRemark = String(body.buyerRemark ?? "").trim();
    if (buyerRemark.length > 500 || !/^[a-f0-9]{64}$/.test(expectedQuote))
      throw new BadRequestException("请先确认当前报价");
    const requestHash = sha256(
      JSON.stringify({ requested, address, expectedQuote, buyerRemark }),
    );
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
            const existing = await tx.commerceOrder.findUnique({
              where: { idempotencyKey: key },
              include: partnerOrderInclude,
            });
            if (existing) {
              if (
                existing.partnerId !== partnerId ||
                existing.requestHash !== requestHash
              )
                throw new ConflictException("订单请求编号已被不同参数使用");
              return existing;
            }
            await tx.$queryRaw`SELECT id FROM "BrandPartner" WHERE id = ${partnerId}::uuid FOR SHARE`;
            const quote = await this.readQuote(tx, partnerId, requested);
            if (quote.fingerprint !== expectedQuote)
              throw new ConflictException("合作价或等级已变化，请重新确认报价");
            const order = await tx.commerceOrder.create({
              data: {
                orderNo: partnerNumber("VP"),
                partnerId,
                partnerLevelSnapshot: quote.level,
                subtotalCents: quote.subtotalCents,
                shippingCents: quote.shippingCents,
                payableCents: quote.payableCents,
                currency: "CNY",
                ...address,
                buyerRemark,
                idempotencyKey: key,
                requestHash,
                pricingVersion: 1,
                pricingVerifiedAt: new Date(),
                items: {
                  create: quote.lines.map((line) => ({
                    productId: line.productId,
                    skuId: line.skuId,
                    erpSkuIdSnapshot: line.erpSkuId,
                    nameSnapshot: line.name,
                    specificationSnapshot: line.specification,
                    imageSnapshot: line.image,
                    unitPriceCents: line.unitPriceCents,
                    quantity: line.quantity,
                    totalCents: line.totalCents,
                    couponDiscountCentsSnapshot: 0,
                    pointDiscountCentsSnapshot: 0,
                    cashPaidCentsSnapshot: line.totalCents,
                  })),
                },
              },
              include: { items: true },
            });
            await postPartnerLedger(tx, {
              partnerId,
              account: "BALANCE",
              type: "PURCHASE",
              deltaCents: -quote.payableCents,
              idempotencyKey: `partner-purchase:${order.id}`,
              referenceId: order.id,
              reason: `采购订单 ${order.orderNo}`,
            });
            await tx.paymentIntent.create({
              data: {
                paymentNo: partnerNumber("VB"),
                partnerId,
                businessType: BusinessType.COMMERCE_ORDER,
                businessId: order.id,
                commerceOrderId: order.id,
                channel: PaymentChannel.PARTNER_BALANCE,
                status: PaymentStatus.SUCCEEDED,
                amountCents: order.payableCents,
                currency: "CNY",
                description: `品牌伙伴采购 ${order.orderNo}`,
                paidAt: new Date(),
                idempotencyKey: `partner-balance:${order.id}`,
              },
            });
            await markPaymentStockItems(tx, order.id, order.items);
            if (!(await completeCommercePayment(tx, order.id)))
              throw new ConflictException("订单状态已变化");
            return tx.commerceOrder.findUniqueOrThrow({
              where: { id: order.id },
              include: partnerOrderInclude,
            });
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: 10_000,
            timeout: 30_000,
          },
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034" &&
          attempt < 2
        )
          continue;
        throw error;
      }
    }
  }

  async orders(partnerId: string, pageInput: unknown) {
    const { page, pageSize, skip } = partnerPage(pageInput),
      where = { partnerId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.commerceOrder.findMany({
        where,
        include: partnerOrderInclude,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take: pageSize,
      }),
      this.prisma.commerceOrder.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async order(partnerId: string, id: string) {
    if (!isUuid(id)) throw new NotFoundException("订单不存在");
    const order = await this.prisma.commerceOrder.findFirst({
      where: { id, partnerId },
      include: partnerOrderInclude,
    });
    if (!order) throw new NotFoundException("订单不存在");
    return order;
  }

  async processing(partnerId: string, id: string) {
    return orderErpSnapshot(this.prisma, id, "stale", partnerId);
  }

  async logistics(partnerId: string, id: string) {
    await this.order(partnerId, id);
    const rows = await this.prisma.commerceShipment.findMany({
      where: { orderId: id, order: { partnerId } },
      orderBy: { createdAt: "desc" },
    });
    return {
      items: rows.map((row) => {
        const raw = safeObject(row.traceJson),
          candidates = raw.traces ?? raw.events ?? raw.list ?? raw.data;
        const traces = Array.isArray(candidates)
          ? candidates
              .slice(0, 200)
              .map((item) => {
                const event = safeObject(item);
                return {
                  time: String(
                    event.time ?? event.accept_time ?? event.AcceptTime ?? "",
                  ).slice(0, 80),
                  description: String(
                    event.description ??
                      event.context ??
                      event.AcceptStation ??
                      "",
                  ).slice(0, 1000),
                };
              })
              .filter((item) => item.description)
          : [];
        return {
          id: row.id,
          logisticsCompany: row.logisticsCompany,
          logisticsCode: row.logisticsCode,
          trackingNo: row.trackingNo,
          shippedAt: row.shippedAt,
          deliveredAt: row.deliveredAt,
          traces,
        };
      }),
    };
  }
}
