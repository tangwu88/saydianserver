import { api } from "./api";
export function captureReferral(explicitReferral?: string): void {
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
  if (ref && !uni.getStorageSync("saidian-ref"))
    uni.setStorageSync("saidian-ref", ref);
}
export function isLoggedIn(): boolean {
  return Boolean(uni.getStorageSync("saidian-token"));
}
export async function bindReferral(): Promise<void> {
  const ref = String(uni.getStorageSync("saidian-ref") || "");
  if (ref && isLoggedIn())
    await api("/auth/referral", {
      method: "POST",
      data: { referralCode: ref },
      auth: true,
    }).catch(() => undefined);
}
