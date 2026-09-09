/** Public contract: never spread database SKU rows (cost/ERP/private fields). */
export function publicSku(sku: {
  id: string;
  specification: string | null;
  image: string | null;
  salePriceCents: number;
  marketPriceCents: number | null;
  stock: number;
  enabled: boolean;
}) {
  return {
    id: sku.id,
    specification: sku.specification,
    image: sku.image,
    salePriceCents: sku.salePriceCents,
    marketPriceCents: sku.marketPriceCents,
    stock: sku.stock,
    enabled: sku.enabled,
  };
}
