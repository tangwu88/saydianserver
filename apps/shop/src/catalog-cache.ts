import { api } from './api';
import { availableSku } from './catalog-presentation';
let cached: any[] | null = null;
let savedAt = 0;
let pending: Promise<any[]> | null = null;
/** Public catalog only. Prices/stock are revalidated by product and checkout APIs. */
export function loadCatalog(force = false): Promise<any[]> {
  if (!force && cached && Date.now() - savedAt < 60_000) return Promise.resolve(cached);
  if (pending) return pending;
  pending = (async () => {
    const rows: any[] = [];
    for (let page = 1; page <= 100; page++) {
      const result = await api<any>(`/storefront/products?page=${page}&pageSize=24`);
      if (!Array.isArray(result.items) || !Number.isSafeInteger(result.total) || result.total < 0) throw new Error('商品资料暂时无法读取，请重试');
      rows.push(...result.items);
      if (rows.length >= result.total) {
        // A sold-out lowest-price default is not a purchasable offer. Resolve only
        // these ambiguous products, in small batches; all final prices stay server-quoted.
        const ambiguous=rows.filter(row=>row.defaultSku?.stock===0 && row.stock>0);
        for(let start=0;start<ambiguous.length;start+=4) await Promise.all(ambiguous.slice(start,start+4).map(async row=>{
          try { const detail=await api<any>('/storefront/products/'+encodeURIComponent(row.id));
            const available=(detail.skus || []).filter(availableSku).filter((sku:any)=>Number.isSafeInteger(sku.salePriceCents)&&sku.salePriceCents>=0).sort((a:any,b:any)=>a.salePriceCents-b.salePriceCents);
            if(available.length){row.priceCents=available[0].salePriceCents;row.defaultSku=available[0];}else row.priceNeedsSelection=true;
          } catch { row.priceNeedsSelection=true; }
        }));
        cached = rows; savedAt = Date.now(); return rows;
      }
      if (!result.items.length) throw new Error('商品资料尚未加载完整，请重试');
    }
    throw new Error('商品较多，请稍后重试');
  })().finally(() => { pending = null; });
  return pending;
}
