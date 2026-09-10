import { globalPageAllowed } from "./realm-config";
import { globalCommerceNotice, isGlobalMall, mallConfig } from "./realm";
export function normalizeGlobalEntry() {
  if (!isGlobalMall || typeof location === "undefined") return;
  const route = location.hash.replace(/^#/, "");
  if (route && !globalPageAllowed(route)) history.replaceState(history.state, "", mallConfig.publicBase + "#/pages/help/index");
}
export function installGlobalNavigation() {
  if (!isGlobalMall) return;
  for (const action of ["navigateTo", "redirectTo", "reLaunch", "switchTab"] as const) {
    uni.addInterceptor(action, { invoke(args: { url: string }) {
      if (globalPageAllowed(args.url)) return;
      uni.showToast({ title: globalCommerceNotice, icon: "none", duration: 3000 });
      return false;
    } });
  }
}
