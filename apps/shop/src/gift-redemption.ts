export type GiftDraft = {
  token: string;
  expiresAt: string;
  skuId: string;
  addressId: string;
  ownerId: string;
  request?: {
    token: string;
    skuId: string;
    addressId: string;
    fingerprint: string;
    requestKey: string;
  };
};
const key = "saydian:gift-redemption:v1";
export function readGiftDraft(
  storage?: Pick<Storage, "getItem">,
  now = Date.now(),
): GiftDraft | null {
  try {
    const value = JSON.parse(storage?.getItem(key) || "null");
    if (
      !value ||
      typeof value.token !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(value.token) ||
      !Number.isFinite(Date.parse(value.expiresAt)) ||
      Date.parse(value.expiresAt) <= now ||
      typeof value.ownerId !== "string" ||
      typeof value.skuId !== "string" ||
      typeof value.addressId !== "string"
    )
      return null;
    if (
      value.request &&
      (value.request.token !== value.token ||
        value.request.skuId !== value.skuId ||
        value.request.addressId !== value.addressId ||
        !/^[A-Za-z0-9_-]{8,128}$/.test(value.request.requestKey) ||
        !/^[a-f0-9]{64}$/.test(value.request.fingerprint))
    )
      return null;
    return value;
  } catch {
    return null;
  }
}
export function saveGiftDraft(
  storage: Pick<Storage, "setItem" | "removeItem"> | undefined,
  value: GiftDraft | null,
) {
  if (!storage) return;
  try {
    if (value) storage.setItem(key, JSON.stringify(value));
    else storage.removeItem(key);
  } catch {
    /* Storage may be unavailable in private browsing; the active page still works. */
  }
}
