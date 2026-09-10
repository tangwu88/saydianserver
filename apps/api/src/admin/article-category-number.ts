import { ServiceUnavailableException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

// This existing sequence table stores technical identifiers, not legacy business data.
// Keep a separate namespace for the international admin; never reuse legacyId.
const entityType = "global_article_category";

export async function withCategoryNumbers<T extends { id: string }>(
  db: Pick<Prisma.TransactionClient, "compatibilityId">,
  categories: T[],
): Promise<Array<T & { categoryNo: string }>> {
  if (!categories.length) return [];
  const externalIds = [...new Set(categories.map(category => category.id))].sort();
  const query = { where: { entityType, externalId: { in: externalIds } }, select: { id: true, externalId: true } };
  let mappings = await db.compatibilityId.findMany(query);
  const existing = new Set(mappings.map(mapping => mapping.externalId));
  const missing = externalIds.filter(id => !existing.has(id));
  if (missing.length) {
    // Existing categories are assigned once, in a batch. Concurrent readers may
    // allocate first: the unique constraint and reread preserve the winning ID.
    await db.compatibilityId.createMany({ data: missing.map(externalId => ({ entityType, externalId })), skipDuplicates: true });
    mappings = await db.compatibilityId.findMany(query);
  }
  const numbers = new Map(mappings.map(mapping => [mapping.externalId, mapping.id]));
  return categories.map(category => {
    const number = numbers.get(category.id);
    if (!number || !Number.isSafeInteger(number) || number < 1) {
      throw new ServiceUnavailableException("分类编号暂时无法读取，请刷新重试");
    }
    return { ...category, categoryNo: String(number) };
  });
}
