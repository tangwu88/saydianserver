import { globalPageAllowed } from "./realm-config";
import { globalCommerceNotice, isGlobalMall, mallConfig } from "./realm";
export function normalizeGlobalEntry() {
  if (!isGlobalMall || typeof location === "undefined") return;
  const entry = location.hash.replace(/^#/, "");
  const route = entry === "/" ? "/pages/home/index" : entry;
  if (route && !globalPageAllowed(route)) history.replaceState(history.state, "", mallConfig.publicBase + "#/pages/help/index");
}
export function installGlobalNavigation() {
  if (!isGlobalMall) return;
  for (const action of ["navigateTo", "redirectTo", "reLaunch", "switchTab"] as const) {
    uni.addInterceptor(action, { invoke(args: { url: string }) {
      // Uni's built-in first tab uses '/' instead of its configured page path.
      if (args.url === "/") args.url = "/pages/home/index";
      if (globalPageAllowed(args.url)) return;
      uni.showToast({ title: globalCommerceNotice, icon: "none", duration: 3000 });
      return false;
    } });
  }
}
