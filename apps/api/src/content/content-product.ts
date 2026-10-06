import { BadRequestException } from "@nestjs/common";

export const CONTENT_PRODUCTS = ["shared", "saidian", "saydian-global", "say-ring"] as const;
export type ContentProduct = (typeof CONTENT_PRODUCTS)[number];

export function contentProduct(value: unknown, fallback: ContentProduct = "saydian-global"): ContentProduct {
  const product = value === undefined || value === null || String(value).trim() === "" ? fallback : String(value).trim();
  if (!CONTENT_PRODUCTS.includes(product as ContentProduct))
    throw new BadRequestException("请选择支持的前端应用");
  return product as ContentProduct;
}

export function contentProductFilter(product: ContentProduct): { in: ContentProduct[] } {
  return { in: product === "shared" ? ["shared"] : ["shared", product] };
}
