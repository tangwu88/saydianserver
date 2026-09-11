import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { BillingService } from "../billing/billing.service";
import { isUuid, safeObject } from "../common/crypto";
import { PrismaService } from "../common/prisma.service";
import { CommerceStoreService } from "./commerce-store.service";
import { integerCents, pointFaceValueCents } from "./commerce-policy";
import { optionalExpectedQuote } from "./commerce-quote";
import { commerceOrderListFilter } from "./commerce-order-filter";

@Injectable()
export class CommerceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: CommerceStoreService,
    private readonly billing: BillingService,
  ) {}

  async publicGet(path: string) {
    const url = parsePath(path);
    if (url.pathname === "/storefront/markets") return this.store.markets();
    if (url.pathname === "/storefront/bootstrap") {
      return this.store.bootstrap(url.searchParams.get("referralCode") ?? undefined);
    }
    if (url.pathname === "/storefront/products") {
      return this.store.listProducts({
        ...(url.searchParams.get("keyword")
          ? { keyword: url.searchParams.get("keyword")! }
          : {}),
        ...(url.searchParams.get("categoryId")
          ? { categoryId: url.searchParams.get("categoryId")! }
          : {}),
        page: Number(url.searchParams.get("page") ?? 1),
        pageSize: Number(url.searchParams.get("pageSize") ?? 20),
        ...(url.searchParams.get("sort")
          ? { sort: url.searchParams.get("sort")! }
          : {}),
      });
    }
    const product = /^\/storefront\/products\/([^/]+)$/.exec(url.pathname);
    if (product?.[1]) return this.store.product(decodeURIComponent(product[1]));
    throw new NotFoundException("商城内容不存在或已下架");
  }

  async forUser(
    userId: string,
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    input?: unknown,
    idempotencyKey?: string,
  ) {
    const body = safeObject(input);
    const url = parsePath(path);
    let pathname = url.pathname;
    const orderPath = /^\/orders\/([^/?]+)(?:\/|$)/.exec(pathname);
    const orderId = orderPath?.[1]
      ? decodeURIComponent(orderPath[1])
      : pathname === "/payments"
        ? String(body.orderId ?? body.order_id ?? "")
        : "";
    if (orderId) {
      const canonical = await this.resolveCanonicalOrder(userId, orderId);
      if (canonical) {
        if (pathname === "/payments") body.orderId = canonical.id;
        else pathname = pathname.replace(/^\/orders\/[^/]+/, `/orders/${canonical.id}`);
      } else if (method !== "GET") {
      const legacy = await this.prisma.legacyOrderProjection.findFirst({
        where: {
          userId,
          OR: [...(isUuid(orderId) ? [{ id: orderId }] : []), { legacyOrderId: orderId }],
        },
        select: { id: true },
      });
      if (legacy) throw new ConflictException("该订单尚未完成明细及资金迁移核验，请稍后重试");
      }
    }
    if (pathname === "/cart" && method === "GET") return this.store.cart(userId);
    if (pathname === "/cart/items" && method === "POST") {
      return this.store.putCartItem(
        userId,
        String(body.skuId ?? body.sku_id ?? ""),
        Number(body.quantity ?? body.num ?? 1),
        body.selected !== false,
        body.mode === "increment" ? "increment" : "set",
      );
    }
    const cartItem = /^\/cart\/items\/([^/]+)$/.exec(pathname);
    if (cartItem?.[1] && method === "DELETE") {
      return this.store.deleteCartItem(userId, decodeURIComponent(cartItem[1]));
    }
    if (pathname === "/addresses") {
      if (method === "GET") return this.store.listAddresses(userId);
      if (method === "POST") return this.store.saveAddress(userId, body);
    }
    const address = /^\/addresses\/([^/]+)$/.exec(pathname);
    if (address?.[1]) {
      const id = decodeURIComponent(address[1]);
      if (method === "GET") return this.store.address(userId, id);
      if (method === "PATCH") return this.store.saveAddress(userId, body, id);
      if (method === "DELETE") return this.store.deleteAddress(userId, id);
    }
    if (pathname === "/orders/preview" && method === "POST") {
      return this.store.previewOrder(userId, normalizeOrderInput(body, "preview"));
    }
    if (pathname === "/orders" && method === "GET") {
      return this.store.listOrders(userId, url.searchParams.get("status") ?? undefined, url.searchParams.get("group") ?? undefined);
    }
    if (pathname === "/orders" && method === "POST") {
      return this.store.createOrder(userId, {
        ...normalizeOrderInput(body, "create"),
        idempotencyKey:
          idempotencyKey?.trim() || String(body.idempotencyKey ?? "").trim(),
      });
    }
    const order = /^\/orders\/([^/]+)$/.exec(pathname);
    if (order?.[1] && method === "GET") {
      return this.orderDetail(userId, decodeURIComponent(order[1]));
    }
    const receipt = /^\/orders\/([^/]+)\/receipt$/.exec(pathname);
    if (receipt?.[1] && method === "POST") {
      return this.store.confirmReceipt(userId, decodeURIComponent(receipt[1]));
    }
    const cancel = /^\/orders\/([^/]+)\/cancel$/.exec(pathname);
    if (cancel?.[1] && method === "POST") {
      return this.store.cancelOrder(userId, decodeURIComponent(cancel[1]));
    }
    const returnLogistics = /^\/orders\/([^/]+)\/after-sales\/([^/]+)\/return-logistics$/.exec(pathname);
    if (returnLogistics?.[1] && returnLogistics[2] && method === "POST") {
      return this.store.submitReturnLogistics(userId, decodeURIComponent(returnLogistics[1]), decodeURIComponent(returnLogistics[2]), body);
    }
    const previewAfterSale = /^\/orders\/([^/]+)\/after-sales\/preview$/.exec(pathname);
    if (previewAfterSale?.[1] && method === "POST") return this.store.afterSaleQuote(userId, decodeURIComponent(previewAfterSale[1]), body);
    const afterSale = /^\/orders\/([^/]+)\/after-sales$/.exec(pathname);
    if (afterSale?.[1] && method === "POST") {
      return this.store.createAfterSale(userId, decodeURIComponent(afterSale[1]), body);
    }
    const itemAfterSale = /^\/order-items\/([^/]+)\/after-sales$/.exec(pathname);
    if (itemAfterSale?.[1] && method === "POST") {
      return this.store.createAfterSaleFromOrderItem(
        userId,
        decodeURIComponent(itemAfterSale[1]),
        body,
      );
    }
    const logistics = /^\/orders\/([^/]+)\/logistics$/.exec(pathname);
    if (logistics?.[1] && method === "GET") {
      return this.store.logistics(userId, decodeURIComponent(logistics[1]));
    }
    if (pathname === "/payments" && method === "POST") {
      const orderId = String(body.orderId ?? body.order_id ?? "").trim();
      const channel = String(body.channel ?? "").trim();
      return this.billing.createPayment(
        userId,
        {
          businessType: "commerce_order",
          businessId: orderId,
          channel,
          platform: body.platform ?? platformFromPaymentChannel(channel),
          idempotencyKey:
            idempotencyKey?.trim() ||
            String(body.idempotencyKey ?? `commerce-payment:${orderId}:${channel}`).trim(),
        },
        {},
      );
    }
    throw new NotFoundException("商城功能不存在或已调整");
  }

  async points(userId: string, page = 1) {
    if (!Number.isInteger(page) || page < 1 || page > 100000) throw new BadRequestException("页码不正确");
    const pageSize = 20;
    const [account, items, total] = await this.prisma.$transaction([
      this.prisma.commercePointAccount.findUnique({ where: { userId }, select: { balanceCents: true, updatedAt: true } }),
      this.prisma.commercePointLedger.findMany({ where: { userId }, select: { id: true, deltaCents: true, type: true, orderId: true, createdAt: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.commercePointLedger.count({ where: { userId } }),
    ]);
    return { balanceCents: account?.balanceCents ?? null, verified: !!account, reason: account ? null : "积分账户尚未核验", items, pagination: { page, pageSize, total, hasMore: page * pageSize < total } };
  }

  async orders(userId: string, status?: string, group?: string) {
    const filter = commerceOrderListFilter(status, group);
    const [current, legacy] = await Promise.all([
      this.store.listOrders(userId, status, group),
      // A projection status is not evidence of a real after-sale relationship.
      group === "after_sales" ? [] : this.prisma.legacyOrderProjection.findMany({
        where: { userId, ...(filter.status ? { status: filter.status } : {}) },
        orderBy: { legacyCreatedAt: "desc" },
      }),
    ]);
    return [
      ...current.map((item) => ({ ...item, readOnly: false, source: "commerce" })),
      ...legacy.filter((item) => !current.some((order) => order.orderNo === item.orderNo || order.legacyId === item.legacyOrderId)).map((item) => ({
        id: item.id,
        legacyOrderId: item.legacyOrderId,
        orderNo: item.orderNo,
        status: item.status,
        payableCents: item.payableCents,
        currency: item.currency,
        createdAt: item.legacyCreatedAt.toISOString(),
        snapshot: item.snapshot,
        readOnly: true,
        source: "legacy",
      })),
    ].sort((left, right) =>
      String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")),
    );
  }

  async orderDetail(userId: string, id: string) {
    const canonical = await this.resolveCanonicalOrder(userId, id);
    if (canonical) return { ...(await this.store.order(userId, canonical.id)),
      readOnly: canonical.executionOwner !== "NEW_SYSTEM", source: canonical.sourceSystem };
    const legacy = await this.prisma.legacyOrderProjection.findFirst({
      where: {
        userId,
        OR: [...(isUuid(id) ? [{ id }] : []), { legacyOrderId: id }],
      },
    });
    if (legacy) {
      return {
        ...safeObject(legacy.snapshot),
        id: legacy.id,
        legacyOrderId: legacy.legacyOrderId,
        orderNo: legacy.orderNo,
        status: legacy.status,
        payableCents: legacy.payableCents,
        currency: legacy.currency,
        createdAt: legacy.legacyCreatedAt.toISOString(),
        readOnly: true,
        source: "legacy",
      };
    }
    return {
      ...(await this.store.order(userId, id)),
      readOnly: false,
      source: "commerce",
    };
  }

  private async resolveCanonicalOrder(userId: string, id: string) {
    const direct = await this.prisma.commerceOrder.findFirst({ where: { userId,
      OR: [...(isUuid(id) ? [{ id }] : []), { legacyId: id }, { orderNo: id }],
    } });
    if (direct) return direct;
    const maps = await this.prisma.legacyIdMap.findMany({ where: {
      entityType: "mall_order", legacyId: id, sourceSystem: { in: ["legacy_mall", "legacy_app"] },
    } });
    const targets = [...new Set(maps.map((map) => map.targetId))].filter(isUuid);
    if (!targets.length) return null;
    const orders = await this.prisma.commerceOrder.findMany({ where: { id: { in: targets }, userId } });
    if (orders.length > 1) throw new ConflictException("旧订单编号在多个来源重复，请先核验订单映射");
    return orders[0] ?? null;
  }

  setFavorite(userId: string, productId: string, enabled: boolean) {
    return this.store.favorite(userId, productId, enabled);
  }

  favorites(userId: string) {
    return this.store.favorites(userId);
  }

  coupons(userId: string) {
    return this.store.coupons(userId);
  }

  availableCoupons(userId: string, page = 1) {
    return this.store.availableCoupons(userId, page);
  }

  claimCoupon(userId: string, couponId: string) {
    return this.store.claimCoupon(userId, couponId);
  }

  createReview(userId: string, input: unknown) {
    return this.store.createReview(userId, input);
  }
}

function parsePath(path: string): URL {
  return new URL(path, "https://commerce.internal");
}

function normalizeOrderInput(body: Record<string, unknown>, mode: "preview" | "create") {
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items = rawItems.map((item) => {
    const row = safeObject(item);
    return {
      skuId: String(row.skuId ?? row.sku_id ?? ""),
      quantity: Number(row.quantity ?? row.num ?? 1),
    };
  });
  const addressId = String(body.addressId ?? body.address_id ?? "").trim();
  if (!addressId && mode === "create") throw new BadRequestException("请选择收货地址");
  const expectedQuote = mode === "create" ? optionalExpectedQuote(body.expectedQuote) : undefined;
  return {
    addressId,
    items,
    pointCents: body.point !== undefined ? pointFaceValueCents(body.point) : integerCents(body.pointCents ?? 0, "积分抵扣"),
    ...(expectedQuote === undefined ? {} : { expectedQuote }),
    ...(body.couponClaimId
      ? { couponClaimId: String(body.couponClaimId) }
      : {}),
    ...(body.buyerRemark || body.buyer_message
      ? { buyerRemark: String(body.buyerRemark ?? body.buyer_message) }
      : {}),
    ...(Object.keys(safeObject(body.invoice)).length
      ? { invoice: safeObject(body.invoice) }
      : {}),
  };
}

function platformFromPaymentChannel(channel: string) {
  if (channel.endsWith("_app")) return "android";
  if (channel === "wechat_mini") return "mini_program";
  return "h5";
}
