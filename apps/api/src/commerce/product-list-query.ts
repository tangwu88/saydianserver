import { BadRequestException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { isUuid } from "../common/crypto";
import type { PrismaService } from "../common/prisma.service";

export function productPage(pageInput: unknown, sizeInput: unknown = 10) {
  const bounded = (input: unknown, fallback: number, max: number) => {
    const value = Number(input);
    return Number.isFinite(value) && value > 0
      ? Math.min(max, Math.max(1, Math.trunc(value)))
      : fallback;
  };
  const page = bounded(pageInput, 1, 1_000_000);
  const pageSize = bounded(sizeInput, 10, 100);
  return { page, pageSize, skip: (page - 1) * pageSize };
}

// A parent filter includes descendants; exact IDs keep similarly named categories distinct.
export async function productCategoryFilter(prisma: PrismaService, input = "") {
  if (input && input !== "uncategorized" && !isUuid(input))
    throw new BadRequestException("商品分类不正确");
  const rows = await prisma.commerceCategory.findMany({
    select: { id: true, name: true, parentId: true },
    orderBy: [{ sort: "asc" }, { id: "asc" }],
  });
  const names = new Map(rows.map((row) => [row.id, row]));
  const categories = rows.map((row) => {
    const path = [row.name],
      visited = new Set([row.id]);
    let parent = row.parentId;
    while (parent && !visited.has(parent)) {
      visited.add(parent);
      const ancestor = names.get(parent);
      if (!ancestor) break;
      path.unshift(ancestor.name);
      parent = ancestor.parentId;
    }
    return { ...row, label: path.join(" / ") };
  });
  const ids = new Set([input]);
  let previousSize = 0;
  while (previousSize !== ids.size) {
    previousSize = ids.size;
    for (const row of rows)
      if (row.parentId && ids.has(row.parentId)) ids.add(row.id);
  }
  const where: Prisma.CommerceProductWhereInput = !input
    ? {}
    : input === "uncategorized"
      ? { categoryId: null }
      : { categoryId: { in: [...ids] } };
  return { categories, where };
}
