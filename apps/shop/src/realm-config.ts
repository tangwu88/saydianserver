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
export function globalPageAllowed(route: string) { return /^\/pages\/(home|category|search|product|profile|login|help)\/index(?:\?[^#]*)?$/.test(route) && !/[\\\r\n]/.test(route); }
export function globalApiAllowed(path: string, method = "GET") {
  if (/^\/auth\/(password\/login|refresh|wechat\/h5\/(authorize-url|login|bind-account|binding-code|bind-code|phone-code|bind-phone))$/.test(path)) return method === "POST";
  if (path === "/auth/wechat/h5/account") return method === "GET";
  return method === "GET" && /^\/storefront\/(bootstrap|capabilities|categories|products(?:\/[^/?#]+)?)(?:\?[^#]*)?$/.test(path);
}
