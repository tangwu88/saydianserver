const key = "saydian-vip-pending-recharge-v1";
export type RechargeInput = {
  amountCents: number;
  channel: string;
  idempotencyKey: string;
};
export function readRecharge(
  storage: Pick<Storage, "getItem" | "removeItem">,
  partnerId: string,
): RechargeInput | null {
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (value.partnerId !== partnerId) return null;
    const input = value.input;
    if (
      !Number.isSafeInteger(input?.amountCents) ||
      input.amountCents <= 0 ||
      input.amountCents > 2147483647 ||
      !["wechat_native", "wechat_jsapi", "wechat_h5", "alipay_page", "alipay_wap"].includes(input.channel) ||
      !/^[-\w:]{8,90}$/.test(input.idempotencyKey)
    )
      throw new Error();
    return input;
  } catch {
    storage.removeItem(key);
    return null;
  }
}
export function saveRecharge(
  storage: Pick<Storage, "setItem">,
  partnerId: string,
  input: RechargeInput,
) {
  storage.setItem(key, JSON.stringify({ partnerId, input }));
}
export function clearRecharge(
  storage: Pick<Storage, "getItem" | "removeItem">,
  partnerId: string,
  requestKey: string,
) {
  if (readRecharge(storage, partnerId)?.idempotencyKey === requestKey)
    storage.removeItem(key);
}
export function terminalPayment(status: unknown) {
  return ["succeeded", "closed", "failed"].includes(
    String(status).toLowerCase(),
  );
}
export function channelLabel(channel: string) {
  return (
    (
      {
        wechat_native: "微信扫码",
        wechat_jsapi: "微信支付",
        wechat_h5: "微信支付",
        alipay_page: "支付宝",
        alipay_wap: "支付宝",
      } as Record<string, string>
    )[channel.toLowerCase()] || channel
  );
}
