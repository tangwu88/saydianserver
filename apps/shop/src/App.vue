<script setup lang="ts">
import { onLaunch } from "@dcloudio/uni-app";
import { ensureMiniProgramSession, startMallSessionSync } from "./api";
import { bindReferral, captureReferral, isLoggedIn } from "./session";
import { isGlobalMall } from "./realm";
import { installGlobalNavigation } from "./global-navigation";
onLaunch((options) => {
  startMallSessionSync();
  if (isGlobalMall) installGlobalNavigation();
  const query = (options as any)?.query ?? {};
  const referral =
    query.ref ||
    (query.scene
      ? decodeURIComponent(String(query.scene)).split(".")[0]
      : undefined);
  captureReferral(referral);
  if (!isGlobalMall) {
    /* #ifdef MP-WEIXIN */
    void ensureMiniProgramSession()
      .then(() => bindReferral())
      .catch(() => undefined);
    /* #endif */
  }
  /* #ifdef H5 */
  if (typeof location === "undefined") return;
  const pageUrl = new URL(location.href);
  const hashQuery = pageUrl.hash.split("?", 2)[1] ?? "";
  const h5Referral =
    pageUrl.searchParams.get("ref") ??
    new URLSearchParams(hashQuery).get("ref");
  captureReferral(h5Referral ?? undefined);
  if (isLoggedIn()) void bindReferral();
  if (!/wxwork/i.test(navigator.userAgent)) return;
  const currentRoute = promotionTarget(pageUrl.hash);
  if (currentRoute.startsWith("/pages/employee/index")) return;
  setTimeout(() => uni.reLaunch({ url: "/pages/employee/index" }), 0);
  /* #endif */
});

function promotionTarget(hash: string): string {
  const route = hash.replace(/^#/, "") || "/pages/home/index";
  if (!/^\/pages\/[a-z0-9-]+\/index(?:\?|$)/i.test(route)) {
    return "/pages/home/index";
  }
  const [path, query = ""] = route.split("?", 2);
  const params = new URLSearchParams(query);
  params.delete("wechatAutoLogin");
  params.delete("autoWechat");
  const nextQuery = params.toString();
  return `${path}${nextQuery ? `?${nextQuery}` : ""}`;
}
</script>
<style lang="scss">
page {
  background: #f1f2f4;
  color: #333333;
  font-size: 16px;
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
}
</style>
