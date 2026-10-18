export type CatalogKind = 'all' | 'watch' | 'ring' | 'accessory';
export const catalogKinds = [
  { id: 'all', name: '全部商品', icon: 'shop' },
  { id: 'watch', name: '健康手表', icon: 'heart' },
  { id: 'ring', name: '智能戒指', icon: 'loop' },
  { id: 'accessory', name: '表带与配件', icon: 'settings' },
] as const;
export function catalogKind(product: any): CatalogKind {
  const text = String(product?.displayName || product?.name || '');
  if (/表带|充电|指模|尺码工具/.test(text) && !/智能戒指/.test(text)) return 'accessory';
  if (/戒指|指环|ring/i.test(text)) return 'ring';
  if (/手表|watch/i.test(text)) return 'watch';
  return 'accessory';
}
export function isSizingSku(sku: any): boolean { return /指模|尺码工具|尺寸测量/.test(String(sku?.specification || '')); }
export function availableSku(sku: any): boolean { return sku?.enabled !== false && Number.isSafeInteger(sku?.stock) && sku.stock > 0; }
export function preferredSku(skus: any[], previousId?: string): any {
  const previous = skus.find(sku => sku.id === previousId);
  const devices = skus.filter(sku => !isSizingSku(sku));
  return previous || devices.find(availableSku) || devices[0] || skus.find(availableSku) || skus[0];
}
export function productTitle(product: any): string {
  const raw = String(product?.displayName || product?.name || '赛电商品');
  if (isSizingSku(product?.defaultSku)) return '智能戒指与尺码工具';
  if (/充电器/.test(raw)) { const wattage=raw.match(/\d+\s*W/i)?.[0]; return wattage ? `赛电 ${wattage} 充电器套装` : '赛电充电器'; }
  if (/表带/.test(raw)) return raw.replace(/^赛电适用赛电/i, '赛电 ').replace(/原装气囊一体式/, '气囊').slice(0, 34);
  const watch = raw.match(/W(?:9\s*Pro|8\s*Ultra(?:-R)?|9S|8S|9|8U|8)(?![a-z0-9])/i);
  if (watch) return `赛电 ${watch[0].replace(/\s+/g, ' ')} ${/插卡/.test(raw) ? '插卡' : '健康'}手表`;
  const ring = raw.match(/R[0-9]+(?:\s*(?:Pro|Ultra|U))?/i);
  if (/戒指|指环/i.test(raw) && ring) return `赛电 ${ring[0].replace(/\s+/g, ' ')} 智能戒指`;
  return raw.replace(/【[^】]*】/g, '').replace(/[.。]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 38) || raw;
}
export function publicTags(tags: unknown): string[] {
  return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string' && !/供应链|导入|色标|ERP|同步|已映射|内部|测试/i.test(tag)).slice(0, 2) : [];
}
export function priceCaption(product: any): string { return isSizingSku(product?.defaultSku) ? '尺码工具价格' : '商品价格'; }
export function officialProductUrl(product: any): string {
  const name = String(product?.displayName || product?.name || '');
  if (/W9S(?![a-z0-9])/i.test(name)) return 'https://www.saydian.cn/products/w9s/';
  if (/W9(?![a-z0-9]|\s*pro)/i.test(name)) return 'https://www.saydian.cn/products/w9/';
  if (/W8(?![a-z0-9]|\s*ultra)/i.test(name)) return 'https://www.saydian.cn/products/w8/';
  return catalogKind(product) === 'ring' ? 'https://www.saydian.cn/products/#rings' : 'https://www.saydian.cn/products/';
}
export function filterCatalog(rows: any[], kind: string, keyword = '', sort = ''): any[] {
  const query = keyword.trim().toLocaleLowerCase();
  const selected = rows.filter(product => (kind === 'all' || catalogKind(product) === kind) && (!query || `${product.name || ''} ${product.displayName || ''} ${product.subtitle || ''}`.toLocaleLowerCase().includes(query)));
  if (sort === 'price_asc' || sort === 'price_desc') selected.sort((a, b) => {
    const aPrice = Number.isSafeInteger(a.priceCents) ? a.priceCents : null;
    const bPrice = Number.isSafeInteger(b.priceCents) ? b.priceCents : null;
    if (aPrice === null) return bPrice === null ? 0 : 1;
    if (bPrice === null) return -1;
    return (aPrice - bPrice) * (sort === 'price_desc' ? -1 : 1);
  });
  if (sort === 'sales') selected.sort((a, b) => Number(b.sales || 0) - Number(a.sales || 0));
  return selected;
}
