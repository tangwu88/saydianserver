const key = "saydian-partner-registration-v1";
export type PartnerReferral = {
  code: string;
  name: string;
  notice: string;
  expiresAt: number;
};
export function currentPartnerReferral(): PartnerReferral | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const record = JSON.parse(sessionStorage.getItem(key) || "null");
    if (
      record &&
      /^[A-Za-z0-9_-]{8,64}$/.test(record.code) &&
      record.expiresAt > Date.now()
    )
      return record;
  } catch {
    /* Expired/corrupt registration context is discarded. */
  }
  sessionStorage.removeItem(key);
  return null;
}
export async function loadPartnerReferral(): Promise<PartnerReferral | null> {
  if (typeof location === "undefined") return null;
  const existing = currentPartnerReferral(),
    candidate = new URL(location.href).searchParams.get("partner");
  const code = existing?.code || candidate;
  if (!code) return null;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(code))
    throw new Error("品牌伙伴推广链接已失效，您可以选择普通注册。");
  const response = await fetch(
    `/api/saydian-app/vip/v1/public/promotion/${encodeURIComponent(code)}`,
    { credentials: "omit", cache: "no-store" },
  );
  const envelope = await response.json();
  if (!response.ok || !envelope.data?.partnerCode)
    throw new Error("品牌伙伴推广链接已失效，您可以选择普通注册。");
  // A later QR cannot replace the first server-validated registration source.
  const referral = {
    code: envelope.data.partnerCode,
    name: envelope.data.name,
    notice: envelope.data.notice,
    expiresAt: existing?.expiresAt || Date.now() + 24 * 60 * 60 * 1000,
  };
  sessionStorage.setItem(key, JSON.stringify(referral));
  return referral;
}
export function clearPartnerReferral() {
  if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(key);
  if (typeof location !== "undefined") {
    const url = new URL(location.href);
    url.searchParams.delete("partner");
    history.replaceState(history.state, "", url.toString());
  }
}

export function attemptedPartnerCode() {
  return (
    currentPartnerReferral()?.code ||
    (typeof location === "undefined"
      ? null
      : new URL(location.href).searchParams.get("partner"))
  );
}
