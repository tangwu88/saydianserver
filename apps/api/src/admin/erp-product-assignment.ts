import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, ProductStatus } from "@prisma/client";
import { isUuid, safeObject, sha256 } from "../common/crypto";
import { PrismaService } from "../common/prisma.service";
import { IntegrationSecretsService } from "../common/integration-secrets.service";
import {
  lookupJushuitanAssignments,
  type JushuitanProduct,
} from "./jushuitan-product-import";

function conflict(message: string): never {
  throw new ConflictException({ message, errorKey: "erp_assignment_conflict" });
}
async function snapshot(tx: Prisma.TransactionClient, productId: string) {
  const product = await tx.commerceProduct.findUnique({
    where: { id: productId },
    include: { skus: { orderBy: { id: "asc" } } },
  });
  if (!product) throw new NotFoundException("商品不存在");
  if (product.source !== "ERP" || product.localArchived)
    throw new BadRequestException("仅支持未归档的ERP商品");
  if (!product.skus.length || product.skus.length > 100)
    throw new BadRequestException("每次仅支持核对1至100个规格");
  return product;
}
type Snapshot = Awaited<ReturnType<typeof snapshot>>;
async function plan(
  tx: Prisma.TransactionClient,
  source: Snapshot,
  erp: JushuitanProduct[],
) {
  const bySku = new Map(erp.map((row) => [row.erpSkuId.toLowerCase(), row]));
  const targets = await tx.commerceProduct.findMany({
    where: { erpItemId: { in: [...new Set(erp.map((row) => row.erpItemId))] } },
    orderBy: { id: "asc" },
  });
  if (targets.some((row) => row.source !== "ERP" || row.localArchived))
    conflict("目标款式对应本地或已归档商品，请先人工核对");
  const rows = source.skus.map((sku) => {
    const mapped = bySku.get(sku.erpSkuId.toLowerCase());
    if (!mapped) conflict("商品规格已变化，请重新核对");
    const target = targets.find((row) => row.erpItemId === mapped.erpItemId);
    return {
      skuId: sku.id,
      erpSkuId: sku.erpSkuId,
      fromProductId: source.id,
      currentItemId: source.erpItemId,
      currentSkuItemId: sku.erpItemId,
      erpItemId: mapped.erpItemId,
      targetProductId: target?.id ?? null,
      targetName:
        target?.displayName || target?.name || mapped.shortName || mapped.name,
      createsDraft: !target,
      changed: target?.id !== source.id || sku.erpItemId !== mapped.erpItemId,
    };
  });
  const fingerprint = sha256(
    JSON.stringify({
      sourceId: source.id,
      sourceVersion: source.updatedAt.toISOString(),
      skus: source.skus.map((row) => [
        row.id,
        row.erpSkuId,
        row.erpItemId,
        row.productId,
        row.updatedAt.toISOString(),
      ]),
      targets: targets.map((row) => [
        row.id,
        row.erpItemId,
        row.updatedAt.toISOString(),
      ]),
      rows,
    }),
  );
  return {
    rows,
    fingerprint,
    changed: rows.filter((row) => row.changed).length,
  };
}

export async function reconcileErpProduct(
  prisma: PrismaService,
  secrets: IntegrationSecretsService,
  productId: string,
  input: unknown,
  actorId: string,
  requestId?: string,
  lookup: typeof lookupJushuitanAssignments = lookupJushuitanAssignments,
) {
  if (!isUuid(productId)) throw new BadRequestException("商品编号不正确");
  const body = safeObject(input);
  if (body.action !== "preview" && body.action !== "apply")
    throw new BadRequestException("操作不正确");
  if (
    body.action === "apply" &&
    (typeof body.fingerprint !== "string" ||
      !/^[a-f0-9]{64}$/.test(body.fingerprint))
  )
    throw new BadRequestException("请先预览规格归属");
  const before = await snapshot(prisma, productId);
  // The authoritative item ID comes from an exact SKU lookup, never a code prefix.
  const erp = await lookup(
    prisma,
    secrets,
    before.skus.map((row) => row.erpSkuId),
  );
  if (body.action === "preview") return plan(prisma, before, erp);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`erp-assignment:${productId}`}))`;
    await tx.$queryRaw`SELECT "id" FROM "CommerceProduct"
      WHERE "id" = ${productId}::uuid OR "erpItemId" IN (${Prisma.join([...new Set(erp.map((row) => row.erpItemId))])})
      ORDER BY "id" FOR UPDATE`;
    const source = await snapshot(tx, productId);
    const current = await plan(tx, source, erp);
    if (current.fingerprint !== body.fingerprint)
      conflict("商品或ERP归属已变化，请重新预览后确认");
    const targetIds = new Map<string, string>();
    for (const row of current.rows.filter((row) => row.changed)) {
      let targetId = row.targetProductId ?? targetIds.get(row.erpItemId);
      if (!targetId) {
        const mapped = erp.find((item) => item.erpItemId === row.erpItemId)!;
        const target = await tx.commerceProduct.create({
          data: {
            erpItemId: mapped.erpItemId,
            source: "ERP",
            name: mapped.name,
            displayName: mapped.shortName || mapped.name,
            coverImage: mapped.image,
            gallery: mapped.gallery,
            tags: mapped.tags,
            brand: mapped.brand,
            status: ProductStatus.DRAFT,
          },
        });
        targetId = target.id;
        targetIds.set(row.erpItemId, targetId);
      }
      const sku = source.skus.find((item) => item.id === row.skuId)!;
      const result = await tx.commerceSku.updateMany({
        where: {
          id: sku.id,
          productId: source.id,
          erpItemId: sku.erpItemId,
          updatedAt: sku.updatedAt,
        },
        data: { productId: targetId, erpItemId: row.erpItemId },
      });
      if (result.count !== 1) conflict("规格已被修改，请重新预览后确认");
    }
    await tx.auditLog.create({
      data: {
        actorType: "ADMIN",
        actorId,
        action: "ERP_PRODUCT_ASSIGNMENTS_RECONCILED",
        entityType: "COMMERCE_PRODUCT",
        entityId: productId,
        requestId: requestId ?? null,
        beforeJson: current.rows as unknown as Prisma.InputJsonValue,
        afterJson: {
          changed: current.changed,
          targets: Object.fromEntries(targetIds),
        },
      },
    });
    const product = await tx.commerceProduct.findUniqueOrThrow({
      where: { id: productId },
      include: { skus: true, category: true },
    });
    return {
      changed: current.changed,
      product,
      newDrafts: [...targetIds.keys()],
    };
  });
}
