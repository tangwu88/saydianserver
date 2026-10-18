<script setup lang="ts">
import { onLaunch } from "@dcloudio/uni-app";
import { startMallSessionSync } from "./api";
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
  /* #ifdef MP-WEIXIN */
  if (isLoggedIn()) void bindReferral();
  /* #endif */
  /* #ifdef H5 */
  if (typeof location === "undefined") return;
  const pageUrl = new URL(location.href);
  const hashQuery = pageUrl.hash.split("?", 2)[1] ?? "";
  const h5Referral =
    pageUrl.searchParams.get("ref") ??
    new URLSearchParams(hashQuery).get("ref");
  captureReferral(h5Referral ?? undefined);
  if (isLoggedIn()) void bindReferral();
  /* #endif */
});

</script>
<style lang="scss">
page {
  background: #f7f8f4;
  color: #333333;
  font-size: 16px;
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
}
</style>
