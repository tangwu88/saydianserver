import { mallStorage, isGlobalMall } from "./realm";
import { reactive } from "vue";
import { api } from "./api";
export const brandLogo = "https://www.saidian.cc/skin/images/logo.png";
export const storefront = reactive<any>({ banners: [], categories: [], featured: [], configs: {}, capabilities: null, referral: null });
export function configValue(key: string): any { const item = storefront.configs?.[key]; return item?.enabled === false ? null : item?.value ?? null; }
export async function loadStorefront() {
  const response: any = await api(isGlobalMall ? "/storefront/bootstrap?locale=en" : "/storefront/bootstrap?ref=" + encodeURIComponent(String(mallStorage.get("saidian-ref") || "")));
  Object.assign(storefront, response);
  if (!storefront.featured.length) { const catalog: any = await api("/storefront/products?page=1&pageSize=12"); storefront.featured = catalog.items || []; }
  return storefront;
}
