import { mallStorage, isGlobalMall } from "./realm";
import { api } from "./api";
export function captureReferral(explicitReferral?: string): void {
  if (isGlobalMall) return;
  const pages = getCurrentPages?.() ?? [];
  const route = pages[pages.length - 1] as any;
  const locationSearch =
    typeof location !== "undefined"
      ? new URLSearchParams(location.search).get("ref")
      : "";
  const ref =
    explicitReferral ||
    route?.options?.ref ||
    (route?.options?.scene
      ? decodeURIComponent(String(route.options.scene)).split(".")[0]
      : "") ||
    new URLSearchParams(
      typeof location !== "undefined" ? location.hash.split("?")[1] || "" : "",
    ).get("ref") ||
    locationSearch;
  if (ref && !mallStorage.get("saidian-ref"))
    mallStorage.set("saidian-ref", ref);
}
export function isLoggedIn(): boolean {
  return Boolean(mallStorage.get("saidian-token"));
}
export async function bindReferral(): Promise<void> {
  if (isGlobalMall) return;
  const ref = String(mallStorage.get("saidian-ref") || "");
  if (ref && isLoggedIn())
    await api("/auth/referral", {
      method: "POST",
      data: { referralCode: ref },
      auth: true,
    }).catch(() => undefined);
}
