export type MallRealm = "domestic" | "global";

export function resolveMallConfig(env: Record<string, unknown>, miniProgram = false) {
  const realm: MallRealm = env.VITE_APP_REALM === "global" ? "global" : "domestic";
  const apiBase = String(env.VITE_API_BASE || (realm === "global" ? "/global/api/saidian-mall/v1" : miniProgram ? "https://stest.saydian.cn/api/saidian-mall/v1" : "/api/saidian-mall/v1")).replace(/\/$/, "");
  const publicBase = String(env.VITE_PUBLIC_BASE || (realm === "global" ? "/global/saidian-mall/" : "/saidian-mall/"));
  if (realm === "global" && (miniProgram || apiBase !== "/global/api/saidian-mall/v1" || publicBase !== "/global/saidian-mall/")) {
    throw new Error("国际商城必须使用独立 H5 入口和国际 API，尚未启用小程序");
  }
  return { realm, apiBase, publicBase };
}

export function realmKey(key: string, realm: MallRealm) { return realm === "global" ? "saydian-global-mall:" + key : key; }
export function globalPageAllowed(route: string) {
  return /^\/pages\/(home|category|search|product|profile|login|help|cart|checkout|orders|order-detail|after-sale|addresses|address-edit|favorites|coupons|points)\/index(?:\?[^#]*)?$/.test(route) && !/[\\\r\n]/.test(route);
}
export function globalApiAllowed(path: string, method = "GET") {
  // Routing only: the server still verifies identity, scope, market and channel
  // capability. In particular this list never grants temporary OTP trading rights.
  if (/[\\#\r\n]/.test(path) || (method !== "GET" && path.includes("?"))) return false;
  if (/^\/auth\/(password\/login|refresh|wechat\/h5\/(authorize-url|login|bind-account|binding-code|bind-code|phone-code|bind-phone))$/.test(path)) return method === "POST";
  if (path === "/auth/wechat/h5/account") return method === "GET";
  const route = path.split("?", 1)[0] ?? "";
  if (route === '/storefront/after-sale-images') return method === 'POST';
  if (/^\/storefront\/after-sale-images\/(capabilities|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(route)) return method === 'GET';
  if (route === "/payments/create") return method === "POST";
  if (route === "/storefront/coupons/available") return method === "GET";
  if (route === "/storefront/coupons/code/claim") return method === "POST";
  if (route === "/storefront/orders/preview") return method === "POST";
  if (method === "GET") return /^\/storefront\/(bootstrap|capabilities|categories|markets|products(?:\/[A-Za-z0-9_-]+)?|cart|addresses|orders(?:\/[A-Za-z0-9_-]+(?:\/logistics)?)?|favorites|coupons|points)$/.test(route) || /^\/payments\/[A-Za-z0-9_-]+$/.test(route);
  if (method === "POST") return /^\/storefront\/(cart\/items|addresses|orders(?:\/[A-Za-z0-9_-]+\/(cancel|receipt|after-sales(?:\/preview|\/[A-Za-z0-9_-]+\/return-logistics)?))?|favorites\/[A-Za-z0-9_-]+|coupons\/[A-Za-z0-9_-]+\/claim|reviews)$/.test(route);
  if (method === "PATCH") return /^\/storefront\/addresses\/[A-Za-z0-9_-]+$/.test(route);
  if (method === "DELETE") return /^\/storefront\/(addresses|cart\/items)\/[A-Za-z0-9_-]+$/.test(route);
  return false;
}
