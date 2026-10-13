import type {
  PartnerCheckoutInput,
  PartnerQuoteContract,
} from "@saydian/app-contracts";
const key = "saydian-vip-pending-checkout-v1";
export type PendingCheckout = {
  partnerId: string;
  input: PartnerCheckoutInput;
  quote: PartnerQuoteContract;
};
export function readCheckout(
  storage: Pick<Storage, "getItem" | "removeItem">,
  partnerId: string,
): PendingCheckout | null {
  try {
    const value = JSON.parse(storage.getItem(key) || "null");
    if (!value) return null;
    if (value.partnerId !== partnerId) return null; // A different signed-in owner cannot inherit this request.
    if (
      typeof value.input?.idempotencyKey !== "string" ||
      !/^[A-Za-z0-9:_-]{8,90}$/.test(value.input.idempotencyKey) ||
      !/^[a-f0-9]{64}$/.test(value.input.expectedQuote) ||
      value.quote?.fingerprint !== value.input.expectedQuote ||
      !Array.isArray(value.input.items) ||
      !value.input.items.length ||
      !value.input.address
    )
      throw new Error();
    return value;
  } catch {
    storage.removeItem(key);
    return null;
  }
}
export function saveCheckout(
  storage: Pick<Storage, "setItem">,
  pending: PendingCheckout,
) {
  storage.setItem(key, JSON.stringify(pending));
}
export function clearCheckout(
  storage: Pick<Storage, "getItem" | "removeItem">,
  partnerId: string,
  requestKey: string,
) {
  const pending = readCheckout(storage, partnerId);
  if (pending?.input.idempotencyKey === requestKey) storage.removeItem(key);
}
