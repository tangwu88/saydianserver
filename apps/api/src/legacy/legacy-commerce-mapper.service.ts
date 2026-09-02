import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { safeObject } from "../common/crypto";
import { LegacyService } from "./legacy.service";

const entity = {
  address: "mall_address",
  category: "mall_category",
  order: "mall_order",
  orderItem: "mall_order_item",
  product: "mall_product",
  sku: "mall_sku",
} as const;

@Injectable()
export class LegacyCommerceMapper {
  constructor(private readonly legacy: LegacyService) {}

  async home(bootstrapInput: unknown, catalogInput: unknown) {
    const bootstrap = safeObject(bootstrapInput);
    const catalog = safeObject(catalogInput);
    const banners = list(bootstrap.banners)
      .map((item) => safeObject(item))
      .map((item) => ({
        url: text(
          item.imageUrl ?? item.image ?? item.url ?? item.bannerUrl,
        ),
        link: text(item.linkUrl ?? item.link ?? item.target),
      }))
      .filter((item) => item.url);
    const products = await Promise.all(
      list(catalog.items).map((item) => this.productCard(item)),
    );
    const featured = await Promise.all(
      list(bootstrap.featured).map((item) => this.productCard(item)),
    );
    const categories = list(bootstrap.categories).map((item) => safeObject(item));
    const tabs: Array<Record<string, unknown>> = [];
    if (featured.length) tabs.push({ name: "推荐", list: featured });
    for (const category of categories) {
      const categoryId = text(category.id);
      if (!categoryId) continue;
      const compatibilityId = await this.legacy.compatibilityId(
        entity.category,
        categoryId,
      );
      tabs.push({
        id: compatibilityId,
        name: text(category.name) || "商品",
        list: products.filter(
          (product) => product.category_external_id === categoryId,
        ),
      });
    }
    if (!tabs.length) tabs.push({ name: "全部商品", list: products });
    return {
      code: "SHOP_HOME",
      items: [
        ...(banners.length
          ? [{ type: "swiper", data: { list: banners } }]
          : []),
        {
          type: "tabs",
          value: tabs.map(({ list: tabProducts, ...tab }) => ({
            ...tab,
            list: (tabProducts as Array<Record<string, unknown>>).map(
              ({ category_external_id: _categoryId, ...product }) => product,
            ),
          })),
        },
      ],
    };
  }

  async productDetail(input: unknown) {
    const product = safeObject(input);
    const publicProduct = omitKeys(product, [
      "categoryId",
      "defaultSku",
      "sku",
      "skus",
      "supplierId",
    ]);
    const productId = await this.compatibilityId(entity.product, product.id);
    const skus = await Promise.all(
      list(product.skus ?? product.sku).map(async (inputSku) => {
        const sku = safeObject(inputSku);
        const publicSku = omitKeys(sku, ["productId", "supplierSkuId"]);
        return {
          ...publicSku,
          id: await this.compatibilityId(entity.sku, sku.id),
          product_id: productId,
          name: text(sku.specification ?? sku.name) || "默认规格",
          picture: text(sku.image ?? sku.picture ?? product.coverImage),
          price: moneyFromCents(sku.salePriceCents, sku.price),
          market_price: moneyFromCents(
            sku.marketPriceCents,
            sku.market_price,
          ),
          stock: integer(sku.stock),
        };
      }),
    );
    const covers = uniqueStrings([
      product.coverImage,
      product.picture,
      ...list(product.gallery),
      ...list(product.covers),
    ]);
    return {
      ...publicProduct,
      id: productId,
      name: text(product.displayName ?? product.name) || "商品",
      picture: text(product.coverImage ?? product.picture),
      covers,
      intro: text(product.subtitle ?? product.intro),
      content: text(product.detailHtml ?? product.content),
      price:
        skus.length > 0
          ? Math.min(...skus.map((sku) => number(sku.price)))
          : moneyFromCents(product.priceCents, product.price),
      market_price: moneyFromCents(
        product.marketPriceCents,
        product.market_price,
      ),
      sales: integer(product.sales),
      stock: skus.reduce((sum, sku) => sum + integer(sku.stock), 0),
      min_buy: 1,
      sku: skus,
    };
  }

  async preview(input: unknown) {
    const payload = safeObject(input);
    const publicPayload = omitKeys(payload, ["addressId", "userId"]);
    const products = await Promise.all(
      list(payload.products).map((item) => this.previewProduct(item)),
    );
    return {
      ...publicPayload,
      address: payload.address ? await this.address(payload.address) : null,
      products,
    };
  }

  async addresses(input: unknown) {
    return Promise.all(list(input).map((item) => this.address(item)));
  }

  async address(input: unknown) {
    const address = safeObject(input);
    const publicAddress = omitKeys(address, ["userId"]);
    const region = [address.province, address.city, address.district]
      .map(text)
      .filter(Boolean)
      .join(" ");
    return {
      ...publicAddress,
      id: await this.compatibilityId(entity.address, address.id),
      realname: text(address.name ?? address.realname),
      mobile: text(address.mobile),
      region: region || text(address.region),
      address_name: region || text(address.address_name),
      address_details: text(address.detail ?? address.address_details),
      postal_code: address.postalCode ?? address.postal_code ?? null,
      province_id: positiveInteger(address.provinceCode ?? address.province_id),
      city_id: positiveInteger(address.cityCode ?? address.city_id),
      area_id: positiveInteger(address.districtCode ?? address.area_id),
      is_default: truthy(address.isDefault ?? address.is_default) ? 1 : 0,
    };
  }

  async orders(input: unknown, statusInput?: unknown) {
    const orders = await Promise.all(list(input).map((item) => this.order(item)));
    const status = optionalInteger(statusInput);
    return status === null
      ? orders
      : orders.filter((order) => order.order_status === status);
  }

  async order(input: unknown) {
    const order = safeObject(input);
    const publicOrder = omitKeys(order, [
      "addressId",
      "idempotencyKey",
      "items",
      "product",
      "userId",
    ]);
    const readOnly = truthy(order.readOnly ?? order.read_only);
    const legacyOrderId = positiveInteger(order.legacyOrderId ?? order.legacy_order_id);
    const id =
      readOnly && legacyOrderId
        ? legacyOrderId
        : await this.compatibilityId(entity.order, order.id);
    const productsInput = list(order.items).length
      ? list(order.items)
      : list(order.product);
    const products = await Promise.all(
      productsInput.map((item) => this.orderProduct(item)),
    );
    const status = legacyOrderStatus(order.status ?? order.order_status);
    const payable = moneyFromCents(
      order.payableCents,
      order.pay_money ?? order.order_money,
    );
    const subtotal = moneyFromCents(
      order.subtotalCents,
      order.product_money ?? payable,
    );
    const province = text(order.province);
    const city = text(order.city);
    const district = text(order.district);
    const statusName = legacyOrderStatusName(order.status ?? order.order_status);
    return {
      ...publicOrder,
      id,
      order_id: id,
      order_sn: text(order.orderNo ?? order.order_sn) || String(id),
      order_status: status,
      order_status_name: statusName,
      product: products,
      product_money: subtotal,
      shipping_money: moneyFromCents(
        order.shippingCents,
        order.shipping_money,
      ),
      discount_money: moneyFromCents(
        order.discountCents,
        order.discount_money,
      ),
      pay_money: payable,
      order_money: payable,
      receiver_name: text(order.recipientName ?? order.receiver_name ?? order.realname),
      receiver_mobile: text(
        order.recipientMobile ?? order.receiver_mobile ?? order.mobile,
      ),
      receiver_region_name:
        [province, city, district].filter(Boolean).join(" ") ||
        text(order.receiver_region_name),
      receiver_address: text(
        order.addressDetail ?? order.receiver_address ?? order.address,
      ),
      created_at: order.createdAt ?? order.created_at ?? null,
      read_only: readOnly,
    };
  }

  payment(input: unknown) {
    const payload = safeObject(input);
    const invoke = safeObject(payload.invoke ?? payload.config ?? payload);
    return {
      payment_no: payload.paymentNo ?? payload.payment_no ?? null,
      channel: payload.channel ?? null,
      config: invoke,
    };
  }

  shipments(input: unknown) {
    return list(input).map((item) => {
      const shipment = safeObject(item);
      const publicShipment = omitKeys(shipment, ["orderId"]);
      const traceInput = shipment.traceJson ?? shipment.trace;
      const trace = Array.isArray(traceInput)
        ? traceInput
        : Array.isArray(safeObject(traceInput).data)
          ? safeObject(traceInput).data
          : [];
      return {
        ...publicShipment,
        express_company: text(
          shipment.logisticsCompany ?? shipment.express_company,
        ),
        express_code: text(shipment.logisticsCode ?? shipment.express_code),
        express_no: text(shipment.trackingNo ?? shipment.express_no),
        trace,
      };
    });
  }

  async productExternalId(value: unknown) {
    return this.externalId(entity.product, value);
  }

  async orderExternalId(value: unknown) {
    return this.externalId(entity.order, value, true);
  }

  async orderItemExternalId(value: unknown) {
    return this.externalId(entity.orderItem, value);
  }

  async addressExternalId(value: unknown) {
    return this.externalId(entity.address, value);
  }

  async orderRequest(input: unknown) {
    const body = safeObject(input);
    const legacyItem = parseObject(body.data);
    const rawItems = Array.isArray(body.items)
      ? body.items
      : Object.keys(legacyItem).length
        ? [legacyItem]
        : [];
    if (!rawItems.length) throw new BadRequestException("请选择商品");
    const items = await Promise.all(
      rawItems.map(async (inputItem) => {
        const item = safeObject(inputItem);
        return {
          skuId: await this.externalId(
            entity.sku,
            item.skuId ?? item.sku_id,
          ),
          quantity: positiveInteger(item.quantity ?? item.num) ?? 1,
        };
      }),
    );
    const addressInput = body.addressId ?? body.address_id;
    return {
      addressId: addressInput
        ? await this.externalId(entity.address, addressInput)
        : "",
      items,
      buyerRemark: text(body.buyerRemark ?? body.buyer_message),
    };
  }

  async previewQuery(input: Record<string, string>) {
    const request = await this.orderRequest(input);
    return {
      addressId: request.addressId,
      items: request.items,
    };
  }

  async paymentRequest(input: unknown) {
    const body = safeObject(input);
    const data = parseObject(body.data);
    const orderInput = body.orderId ?? body.order_id ?? data.order_id;
    if (!orderInput) throw new BadRequestException("订单编号不正确");
    const orderId = await this.orderExternalId(orderInput);
    return {
      ...body,
      orderId,
      data: JSON.stringify({ ...data, order_id: orderId }),
    };
  }

  private async productCard(input: unknown) {
    const product = safeObject(input);
    const publicProduct = omitKeys(product, [
      "categoryId",
      "defaultSku",
      "supplierId",
    ]);
    const sku = safeObject(product.defaultSku);
    return {
      ...publicProduct,
      id: await this.compatibilityId(entity.product, product.id),
      name: text(product.displayName ?? product.name) || "商品",
      picture: text(product.coverImage ?? product.picture),
      price: moneyFromCents(
        product.priceCents ?? sku.salePriceCents,
        product.price,
      ),
      market_price: moneyFromCents(
        product.marketPriceCents ?? sku.marketPriceCents,
        product.market_price,
      ),
      sales: integer(product.sales),
      stock: integer(product.stock ?? sku.stock),
      category_external_id: text(product.categoryId ?? product.category_id),
    };
  }

  private async previewProduct(input: unknown) {
    const product = safeObject(input);
    const publicProduct = omitKeys(product, ["productId", "skuId"]);
    return {
      ...publicProduct,
      id: await this.compatibilityId(
        entity.product,
        product.id ?? product.product_id,
      ),
      product_id: await this.compatibilityId(
        entity.product,
        product.product_id ?? product.id,
      ),
      sku_id: await this.compatibilityId(entity.sku, product.sku_id),
      product_name: text(product.name ?? product.product_name),
      sku_name: text(product.specification ?? product.sku_name),
      product_picture: text(product.image ?? product.product_picture),
      product_money: number(product.price ?? product.product_money),
      num: positiveInteger(product.num ?? product.quantity) ?? 1,
    };
  }

  private async orderProduct(input: unknown) {
    const item = safeObject(input);
    const publicItem = omitKeys(item, ["orderId", "productId", "skuId"]);
    const currentShape = Boolean(item.nameSnapshot || item.unitPriceCents !== undefined);
    const id = currentShape
      ? await this.compatibilityId(entity.orderItem, item.id)
      : positiveInteger(item.id) ?? null;
    const productId = currentShape
      ? await this.compatibilityId(entity.product, item.productId)
      : positiveInteger(item.product_id) ?? null;
    const skuId = currentShape
      ? await this.compatibilityId(entity.sku, item.skuId)
      : positiveInteger(item.sku_id) ?? null;
    return {
      ...publicItem,
      id,
      product_id: productId,
      sku_id: skuId,
      product_name: text(item.nameSnapshot ?? item.product_name ?? item.title),
      sku_name: text(item.specificationSnapshot ?? item.sku_name),
      product_picture: text(
        item.imageSnapshot ?? item.product_picture ?? item.image,
      ),
      price: moneyFromCents(
        item.unitPriceCents,
        item.price ?? item.product_money,
      ),
      product_money: moneyFromCents(
        item.unitPriceCents,
        item.product_money ?? item.price,
      ),
      num: positiveInteger(item.quantity ?? item.num) ?? 1,
    };
  }

  private async compatibilityId(entityType: string, value: unknown) {
    const externalId = text(value);
    if (!externalId) throw new NotFoundException("资源不存在或已失效");
    return this.legacy.compatibilityId(entityType, externalId);
  }

  private async externalId(
    entityType: string,
    value: unknown,
    allowLegacyNumeric = false,
  ) {
    const raw = text(value);
    if (!raw) throw new NotFoundException("资源不存在或已失效");
    if (!/^\d+$/.test(raw)) return raw;
    const mapped = await this.legacy.externalIdIfMapped(entityType, raw);
    if (mapped) return mapped;
    if (allowLegacyNumeric) return raw;
    throw new NotFoundException("资源不存在或已失效");
  }
}

function list(input: unknown): unknown[] {
  return Array.isArray(input) ? input : [];
}

function text(input: unknown): string {
  return String(input ?? "").trim();
}

function number(input: unknown): number {
  const value = Number(input);
  return Number.isFinite(value) ? value : 0;
}

function integer(input: unknown): number {
  return Math.trunc(number(input));
}

function positiveInteger(input: unknown): number | null {
  const value = integer(input);
  return value > 0 ? value : null;
}

function optionalInteger(input: unknown): number | null {
  if (input === undefined || input === null || text(input) === "") return null;
  const value = Number(input);
  return Number.isInteger(value) ? value : null;
}

function truthy(input: unknown): boolean {
  return input === true || input === 1 || input === "1" || input === "true";
}

function moneyFromCents(centsInput: unknown, fallback: unknown): number {
  if (centsInput !== undefined && centsInput !== null && text(centsInput) !== "") {
    return Number((number(centsInput) / 100).toFixed(2));
  }
  return Number(number(fallback).toFixed(2));
}

function uniqueStrings(input: unknown[]): string[] {
  return [...new Set(input.map(text).filter(Boolean))];
}

function parseObject(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return safeObject(input);
  }
  if (typeof input !== "string" || !input.trim()) return {};
  try {
    return safeObject(JSON.parse(input));
  } catch {
    throw new BadRequestException("订单数据格式不正确");
  }
}

function omitKeys(
  input: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const output = { ...input };
  for (const key of keys) delete output[key];
  return output;
}

function legacyOrderStatus(input: unknown): number {
  const raw = text(input).toUpperCase();
  const numeric = Number(raw);
  if (Number.isInteger(numeric) && raw !== "") return numeric;
  if (raw === "PENDING_PAYMENT") return 0;
  if (["PAID", "WAITING_FULFILLMENT"].includes(raw)) return 1;
  if (raw === "SHIPPED") return 2;
  if (["RECEIVED", "CLOSED"].includes(raw)) return 3;
  if (raw === "REFUNDED") return -3;
  if (raw === "AFTER_SALE") return -1;
  if (raw === "CANCELLED") return 4;
  return 1;
}

function legacyOrderStatusName(input: unknown): string {
  const raw = text(input).toUpperCase();
  if (raw === "PENDING_PAYMENT" || raw === "0") return "待付款";
  if (["PAID", "WAITING_FULFILLMENT", "1"].includes(raw)) return "待发货";
  if (raw === "SHIPPED" || raw === "2") return "待收货";
  if (["RECEIVED", "CLOSED", "3"].includes(raw)) return "已完成";
  if (raw === "CANCELLED" || raw === "4") return "已取消";
  if (raw === "AFTER_SALE" || raw === "-1") return "售后处理中";
  if (raw === "REFUNDED" || raw === "-3") return "已退款";
  return "订单处理中";
}
