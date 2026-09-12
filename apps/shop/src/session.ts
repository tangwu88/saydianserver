import { isGlobalMall, mallStorage } from "./realm";
import { api } from "./api";

export const PURCHASE_REFERRAL_KEY = "saydian-global:purchase-referral:v1";
type PurchaseReferral = { code: string; ownerId: string | null; capturedAt: number };

function referralSession(): Storage | null {
  return typeof sessionStorage === "undefined" ? null : sessionStorage;
}

function readPurchaseReferral(): PurchaseReferral | null {
  const storage = referralSession();
  if (!storage) return null;
  try {
    const value = JSON.parse(storage.getItem(PURCHASE_REFERRAL_KEY) || "null");
    return value && typeof value.code === "string" && value.code.trim() && value.code.length <= 128 &&
      (value.ownerId === null || typeof value.ownerId === "string") && Number.isFinite(value.capturedAt)
      ? value as PurchaseReferral
      : null;
  } catch {
    storage.removeItem(PURCHASE_REFERRAL_KEY);
    return null;
  }
}

function scrubReferralUrl(): void {
  if (typeof location === "undefined" || typeof history === "undefined") return;
  const url = new URL(location.href);
  url.searchParams.delete("ref");
  const [hashPath, hashQuery = ""] = url.hash.split("?", 2);
  if (hashQuery) {
    const params = new URLSearchParams(hashQuery);
    params.delete("ref");
    url.hash = `${hashPath}${params.toString() ? `?${params}` : ""}`;
  }
  history.replaceState(history.state, "", url.href);
}

function preserveReferralWithoutLink(): boolean {
  if (mallStorage.get("checkout-draft") || mallStorage.get("checkout-pending")) return true;
  if (typeof location !== "undefined" && location.pathname.endsWith("/oauth/callback")) return true;
  if (typeof performance !== "undefined") {
    const navigation = performance.getEntriesByType?.("navigation")?.[0] as PerformanceNavigationTiming | undefined;
    if (navigation?.type === "reload" || navigation?.type === "back_forward") return true;
  }
  return false;
}

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
  const normalized = String(ref || "").trim();
  if (isGlobalMall) {
    const storage = referralSession();
    if (!storage) return;
    if (normalized && normalized.length <= 128 && !/[\u0000-\u001f]/.test(normalized)) {
      storage.setItem(PURCHASE_REFERRAL_KEY, JSON.stringify({
        code: normalized,
        ownerId: String(mallStorage.get("saidian-user")?.id || "") || null,
        capturedAt: Date.now(),
      } satisfies PurchaseReferral));
      scrubReferralUrl();
    } else if (!preserveReferralWithoutLink()) {
      storage.removeItem(PURCHASE_REFERRAL_KEY);
    }
    return;
  }
  if (normalized && !mallStorage.get("saidian-ref"))
    mallStorage.set("saidian-ref", normalized);
}

export function currentPurchaseReferral(userId?: string): string {
  if (!isGlobalMall) return String(mallStorage.get("saidian-ref") || "").trim();
  const storage = referralSession();
  const context = readPurchaseReferral();
  if (!storage || !context) return "";
  if (userId) {
    if (context.ownerId && context.ownerId !== userId) {
      storage.removeItem(PURCHASE_REFERRAL_KEY);
      return "";
    }
    if (!context.ownerId) {
      context.ownerId = userId;
      storage.setItem(PURCHASE_REFERRAL_KEY, JSON.stringify(context));
    }
  }
  return context.code;
}

export function claimPurchaseReferral(userId: string): string {
  return currentPurchaseReferral(userId);
}

export function consumePurchaseReferral(userId: string, expectedCode?: string): void {
  if (!isGlobalMall || !expectedCode) return;
  const storage = referralSession();
  const context = readPurchaseReferral();
  if (storage && context?.ownerId === userId && context.code === expectedCode) {
    storage.removeItem(PURCHASE_REFERRAL_KEY);
  }
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
