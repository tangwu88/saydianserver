import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { IntegrationState, ProductStatus } from "@prisma/client";
import { createHash } from "node:crypto";
import { safeObject } from "../common/crypto";
import { markIntegrationVerified } from "../common/integration-health";
import { IntegrationSecretsService } from "../common/integration-secrets.service";
import { PrismaService } from "../common/prisma.service";

type JushuitanSettings = {
  apiBase: string;
  appKey: string;
  appSecret: string;
  accessToken: string;
  skuOperation: string;
  inventoryOperation: string;
};

type JushuitanProduct = {
  erpItemId: string;
  erpSkuId: string;
  name: string;
  shortName: string | null;
  brand: string | null;
  specification: string | null;
  barcode: string | null;
  image: string | null;
  gallery: string[];
  tags: string[];
  salePriceCents: number;
  marketPriceCents: number | null;
  costPriceCents: number | null;
  weightGrams: number | null;
  enabled: boolean;
  modifiedAt: Date | null;
};

const PRODUCT_FIELDS = [
  "sku_id",
  "i_id",
  "name",
  "short_name",
  "sale_price",
  "cost_price",
  "purchase_price",
  "properties_value",
  "properties_name",
  "color",
  "c_id",
  "category",
  "pic_big",
  "pic",
  "pics",
  "enabled",
  "weight",
  "market_price",
  "brand",
  "supplier_id",
  "supplier_name",
  "modified",
  "sku_code",
  "sku_codes",
  "supplier_sku_id",
  "supplier_i_id",
  "vc_name",
  "sku_type",
  "creator",
  "created",
  "remark",
  "item_type",
  "stock_disabled",
  "unit",
  "shelf_life",
  "labels",
  "production_licence",
  "l",
  "w",
  "h",
  "is_series_number",
  "stock_type",
  "autoid",
  "batch_enabled",
  "bin",
  "other_bin",
  "min_qty",
  "max_qty",
  "overflow_qty",
  "pack_qty",
  "pack_volume",
  "productionbatch_format",
  ...Array.from({ length: 10 }, (_, index) => `other_price_${index + 1}`),
  ...Array.from({ length: 10 }, (_, index) => `other_${index + 1}`),
] as const;

const INVENTORY_FIELDS = [
  "sku_id",
  "i_id",
  "name",
  "qty",
  "avl_qty",
  "order_lock",
  "pick_lock",
  "virtual_qty",
  "purchase_qty",
  "return_qty",
  "in_qty",
  "defective_qty",
  "modified",
  "min_qty",
  "max_qty",
  "lock_qty",
  "customize_qty_1",
  "customize_qty_2",
  "customize_qty_3",
  "allocate",
] as const;

export async function importJushuitanProductBySku(
  prisma: PrismaService,
  integrationSecrets: IntegrationSecretsService,
  input: unknown,
) {
  const requestedSku = String(safeObject(input).sku ?? "").trim();
  if (!requestedSku) throw new BadRequestException("请填写 ERP SKU");
  if (requestedSku.length > 100 || /[,\r\n]/.test(requestedSku)) {
    throw new BadRequestException("ERP SKU 格式无效，请一次只查询一个商品编码");
  }

  const settings = await jushuitanSettings(prisma, integrationSecrets);
  try {
    const productResponse = await callJushuitan(
      settings,
      settings.skuOperation,
      {
        sku_ids: requestedSku,
        page_index: 1,
        page_size: 20,
        ...(settings.skuOperation.startsWith("/")
          ? { flds: "purchase_price,pics", loadSkuBin: true }
          : {}),
      },
    );
    const productRow = exactSkuRow(
      jushuitanRows(productResponse),
      requestedSku,
    );
    if (!productRow) {
      await markIntegrationVerified(prisma, "jushuitan");
      throw new NotFoundException(`聚水潭未找到 SKU：${requestedSku}`);
    }
    const mapped = mapJushuitanProduct(productRow);

    const inventoryResponse = await callJushuitan(
      settings,
      settings.inventoryOperation,
      {
        sku_ids: requestedSku,
        page_index: 1,
        page_size: 100,
        ...(settings.inventoryOperation.startsWith("/")
          ? { has_lock_qty: true }
          : {}),
      },
    );
    const inventoryRow = exactSkuRow(
      jushuitanRows(inventoryResponse),
      requestedSku,
    );
    if (!inventoryRow) {
      throw new ServiceUnavailableException(
        "聚水潭已返回商品资料，但未返回该 SKU 的库存；本次没有导入，请稍后重试",
      );
    }
    const stock = inventoryStock(inventoryRow);
    await markIntegrationVerified(prisma, "jushuitan");

    const saved = await prisma.$transaction(async (tx) => {
      const existingProduct = await tx.commerceProduct.findUnique({
        where: { erpItemId: mapped.erpItemId },
      });
      if (existingProduct && existingProduct.source !== "ERP") {
        throw new ConflictException(
          "ERP 款式编码与本地商品冲突，请先核对商品编码",
        );
      }
      const existingSku = await tx.commerceSku.findUnique({
        where: { erpSkuId: mapped.erpSkuId },
        include: { product: { select: { source: true } } },
      });
      if (existingSku && existingSku.product.source !== "ERP") {
        throw new ConflictException("ERP SKU 与本地商品规格冲突，请先核对 SKU");
      }

      const product = await tx.commerceProduct.upsert({
        where: { erpItemId: mapped.erpItemId },
        create: {
          erpItemId: mapped.erpItemId,
          source: "ERP",
          name: mapped.name,
          displayName: mapped.name,
          subtitle: mapped.shortName,
          brand: mapped.brand,
          coverImage: mapped.image,
          gallery: mapped.gallery,
          tags: mapped.tags,
          status: ProductStatus.DRAFT,
          erpModifiedAt: mapped.modifiedAt,
        },
        update: {
          name: mapped.name,
          erpModifiedAt: mapped.modifiedAt,
          ...(existingProduct?.displayName ? {} : { displayName: mapped.name }),
          ...(existingProduct?.subtitle || !mapped.shortName
            ? {}
            : { subtitle: mapped.shortName }),
          ...(existingProduct?.brand || !mapped.brand
            ? {}
            : { brand: mapped.brand }),
          ...(existingProduct?.coverImage || !mapped.image
            ? {}
            : { coverImage: mapped.image }),
          ...(existingProduct?.gallery.length || !mapped.gallery.length
            ? {}
            : { gallery: mapped.gallery }),
          ...(existingProduct?.tags.length || !mapped.tags.length
            ? {}
            : { tags: mapped.tags }),
        },
      });
      await tx.commerceSku.upsert({
        where: { erpSkuId: mapped.erpSkuId },
        create: {
          productId: product.id,
          erpItemId: mapped.erpItemId,
          erpSkuId: mapped.erpSkuId,
          specification: mapped.specification,
          barcode: mapped.barcode,
          image: mapped.image,
          salePriceCents: mapped.salePriceCents,
          marketPriceCents: mapped.marketPriceCents,
          costPriceCents: mapped.costPriceCents,
          stock,
          weightGrams: mapped.weightGrams,
          enabled: mapped.enabled,
          erpModifiedAt: mapped.modifiedAt,
        },
        update: {
          productId: product.id,
          erpItemId: mapped.erpItemId,
          specification: mapped.specification,
          barcode: mapped.barcode,
          image: mapped.image,
          salePriceCents: mapped.salePriceCents,
          marketPriceCents: mapped.marketPriceCents,
          costPriceCents: mapped.costPriceCents,
          stock,
          weightGrams: mapped.weightGrams,
          enabled: mapped.enabled,
          erpModifiedAt: mapped.modifiedAt,
        },
      });
      return tx.commerceProduct.findUniqueOrThrow({
        where: { id: product.id },
        include: { skus: true, category: true },
      });
    });

    return {
      ...saved,
      erpLookup: {
        requestedSku,
        fetchedAt: new Date().toISOString(),
        product: selectedFields(productRow, PRODUCT_FIELDS),
        inventory: selectedFields(inventoryRow, INVENTORY_FIELDS),
      },
    };
  } catch (error) {
    if (error instanceof HttpException) throw error;
    throw new ServiceUnavailableException(
      error instanceof Error && error.message
        ? `聚水潭实时查询失败：${sanitizeProviderMessage(error.message)}`
        : "聚水潭实时查询失败，请稍后重试",
    );
  }
}

async function jushuitanSettings(
  prisma: PrismaService,
  integrationSecrets: IntegrationSecretsService,
): Promise<JushuitanSettings> {
  const integration = await prisma.integrationConfig.findUnique({
    where: { key: "jushuitan" },
  });
  if (!integration || integration.state !== IntegrationState.CONFIGURED) {
    throw new ServiceUnavailableException("聚水潭集成尚未配置并启用");
  }
  const publicConfig = safeObject(integration.publicConfig);
  const paths = safeObject(publicConfig.paths);
  const methods = safeObject(publicConfig.methods);
  const secrets = await integrationSecrets.resolve("jushuitan", {
    appKey: "JUSHUITAN_APP_KEY",
    appSecret: "JUSHUITAN_APP_SECRET",
    accessToken: "JUSHUITAN_ACCESS_TOKEN",
  });
  const appKey = secrets.appKey ?? "";
  const appSecret = secrets.appSecret ?? "";
  const accessToken = secrets.accessToken ?? "";
  if (!appKey || !appSecret || !accessToken) {
    throw new ServiceUnavailableException(
      "聚水潭 AppKey、AppSecret 或 Access Token 尚未完整配置",
    );
  }
  const skuOperation = configuredOperation(
    methods.sku ?? paths.sku,
    "sku.query",
  );
  const inventoryOperation = configuredOperation(
    methods.inventory ?? paths.inventory,
    skuOperation.startsWith("/") ? "/open/inventory/query" : "inventory.query",
  );
  const apiBase =
    String(publicConfig.apiBase ?? "")
      .trim()
      .replace(/\/$/, "") ||
    (skuOperation.startsWith("/")
      ? "https://openapi.jushuitan.com"
      : "https://open.erp321.com/api/open/query.aspx");
  return {
    apiBase,
    appKey,
    appSecret,
    accessToken,
    skuOperation,
    inventoryOperation,
  };
}

function configuredOperation(value: unknown, fallback: string): string {
  const operation = String(value ?? "").trim();
  return operation || fallback;
}

async function callJushuitan(
  settings: JushuitanSettings,
  operation: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  let response: Response;
  if (operation.startsWith("/")) {
    const biz = JSON.stringify(body ?? {});
    const params: Record<string, string> = {
      access_token: settings.accessToken,
      app_key: settings.appKey,
      timestamp: String(Math.floor(Date.now() / 1_000)),
      version: "2",
      charset: "utf-8",
      biz,
    };
    params.sign = jushuitanV2Sign(params, settings.appSecret);
    response = await fetch(`${settings.apiBase}${operation}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(20_000),
    });
  } else {
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const url = new URL(settings.apiBase);
    url.searchParams.append("method", operation);
    url.searchParams.append("partnerid", settings.appKey);
    url.searchParams.append("token", settings.accessToken);
    url.searchParams.append("ts", timestamp);
    url.searchParams.append(
      "sign",
      jushuitanGatewaySign(
        operation,
        settings.appKey,
        settings.accessToken,
        timestamp,
        settings.appSecret,
      ),
    );
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(20_000),
    });
  }

  const text = await response.text();
  let result: Record<string, unknown>;
  try {
    result = safeObject(JSON.parse(text));
  } catch {
    throw new ServiceUnavailableException(
      `聚水潭返回了无法识别的响应（HTTP ${response.status}）`,
    );
  }
  if (
    !response.ok ||
    result.issuccess === false ||
    (result.code !== undefined && Number(result.code) !== 0)
  ) {
    const code = Number(result.code);
    if (code === 190) {
      throw new ServiceUnavailableException(
        "聚水潭未授权商品或库存查询接口（错误码 190），请先补充接口权限",
      );
    }
    const message = sanitizeProviderMessage(
      String(result.msg ?? result.message ?? response.status),
    );
    throw new ServiceUnavailableException(`聚水潭接口调用失败：${message}`);
  }
  return { ...safeObject(result.data), ...result };
}

export function jushuitanGatewaySign(
  method: string,
  partnerId: string,
  token: string,
  timestamp: string,
  partnerKey: string,
): string {
  return createHash("md5")
    .update(
      `${method}${partnerId}token${token}ts${timestamp}${partnerKey}`,
      "utf8",
    )
    .digest("hex")
    .toLowerCase();
}

export function jushuitanV2Sign(
  params: Record<string, string>,
  appSecret: string,
): string {
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

export function mapJushuitanProduct(
  row: Record<string, unknown>,
): JushuitanProduct {
  const erpSkuId = String(row.sku_id ?? row.skuId ?? "").trim();
  const erpItemId = String(row.i_id ?? row.iId ?? erpSkuId).trim();
  if (!erpSkuId || !erpItemId)
    throw new ServiceUnavailableException("聚水潭商品缺少款式编码或 SKU");
  const name = String(row.name ?? row.short_name ?? erpSkuId).trim();
  if (!name) throw new ServiceUnavailableException("聚水潭商品缺少商品名称");
  const modifiedAt = optionalDate(row.modified);
  const weight = Number(row.weight ?? 0);
  const gallery = imageUrls(row);
  return {
    erpSkuId,
    erpItemId,
    name,
    shortName: optionalText(row.short_name),
    brand: optionalText(row.brand),
    specification: optionalText(row.properties_value ?? row.color),
    barcode: optionalText(row.sku_code ?? row.sku_codes),
    image: gallery[0] ?? null,
    gallery,
    tags: splitText(row.labels),
    salePriceCents: toCents(row.sale_price),
    marketPriceCents: optionalCents(row.market_price),
    costPriceCents: optionalCents(row.cost_price ?? row.purchase_price),
    weightGrams:
      Number.isFinite(weight) && weight > 0 ? Math.round(weight * 1_000) : null,
    enabled:
      Number(row.enabled ?? 1) === 1 && Number(row.stock_disabled ?? 0) !== 1,
    modifiedAt,
  };
}

function jushuitanRows(
  result: Record<string, unknown>,
): Record<string, unknown>[] {
  const candidates = [
    result.datas,
    result.inventorys,
    safeObject(result.data).datas,
    result.data,
  ];
  const selected = candidates.find(Array.isArray);
  return Array.isArray(selected) ? selected.map(safeObject) : [];
}

function exactSkuRow(
  rows: Record<string, unknown>[],
  requestedSku: string,
): Record<string, unknown> | undefined {
  return (
    rows.find(
      (row) => String(row.sku_id ?? row.skuId ?? "").trim() === requestedSku,
    ) ??
    rows.find(
      (row) =>
        String(row.sku_id ?? row.skuId ?? "")
          .trim()
          .toLowerCase() === requestedSku.toLowerCase(),
    )
  );
}

function inventoryStock(row: Record<string, unknown>): number {
  const quantity = Number(row.avl_qty ?? row.qty);
  if (!Number.isFinite(quantity)) {
    throw new ServiceUnavailableException(
      "聚水潭库存响应缺少有效数量；本次没有导入",
    );
  }
  return Math.max(0, Math.floor(quantity));
}

function selectedFields(
  value: Record<string, unknown>,
  names: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    names
      .filter((name) => value[name] !== undefined)
      .map((name) => [name, value[name]]),
  );
}

function imageUrls(row: Record<string, unknown>): string[] {
  const urls = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== "string") return;
    for (const candidate of value.split(/[\r\n,;]/)) {
      const url = candidate.trim();
      if (/^https?:\/\//i.test(url)) urls.add(url);
    }
  };
  add(row.pic_big);
  add(row.pic);
  if (Array.isArray(row.pics)) {
    for (const item of row.pics) {
      if (typeof item === "string") add(item);
      else {
        const image = safeObject(item);
        add(image.url ?? image.pic_big ?? image.pic);
      }
    }
  } else {
    add(row.pics);
  }
  return [...urls].slice(0, 20);
}

function splitText(value: unknown): string[] {
  return [
    ...new Set(
      String(value ?? "")
        .split(/[,，\r\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].slice(0, 30);
}

function optionalText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function optionalDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.valueOf()) ? null : date;
}

function toCents(value: unknown): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100)) : 0;
}

function optionalCents(value: unknown): number | null {
  return value === null || value === undefined || value === ""
    ? null
    : toCents(value);
}

function sanitizeProviderMessage(value: string): string {
  return value
    .replace(
      /(token|sign|secret|partnerkey)\s*[=:]\s*[^\s&,]+/gi,
      "$1=<hidden>",
    )
    .replace(/[\r\n]/g, " ")
    .slice(0, 300);
}
