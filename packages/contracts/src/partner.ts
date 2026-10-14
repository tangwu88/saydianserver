/** Brand partner interfaces are independent of member/employee promotion accounts. */
export interface PartnerLevelContract {
  id: string;
  code: string;
  name: string;
  sort: number;
  active: boolean;
  updatedAt: string;
}
export interface PartnerWalletContract {
  partnerId: string;
  balanceCents: number;
  depositCents: number;
  version: number;
  currency: "CNY";
  updatedAt: string;
}
export interface PartnerIdentityContract {
  preview?: boolean;
  canViewMemberHealth?: boolean;
  id: string;
  partnerNo: string;
  username: string;
  name: string;
  mobile: string | null;
  level: { id: string; name: string };
}
export interface PartnerQuoteContract {
  lines: Array<{
    skuId: string;
    productId: string;
    quantity: number;
    unitPriceCents: number;
    totalCents: number;
    name: string;
    specification: string | null;
  }>;
  levelId: string;
  level: string;
  subtotalCents: number;
  shippingCents: number;
  payableCents: number;
  currency: "CNY";
  fingerprint: string;
}
export interface PartnerCheckoutInput {
  items: Array<{ skuId: string; quantity: number }>;
  address: {
    recipientName: string;
    recipientMobile: string;
    province: string;
    city: string;
    district?: string;
    addressDetail: string;
    countryCode?: string;
    postalCode?: string;
  };
  expectedQuote: string;
  idempotencyKey: string;
  buyerRemark?: string;
}
export type PartnerRechargeChannel =
  "wechat_native" | "alipay_page" | "alipay_wap";
export interface PartnerRechargeInput {
  amountCents: number;
  channel: PartnerRechargeChannel;
  idempotencyKey: string;
}
export interface PartnerLedgerContract {
  id: string;
  account: "BALANCE" | "DEPOSIT";
  type:
    | "RECHARGE"
    | "PURCHASE"
    | "REFUND"
    | "DEPOSIT_RECEIPT"
    | "DEPOSIT_RETURN"
    | "DEPOSIT_CORRECTION";
  deltaCents: number;
  balanceAfterCents: number;
  referenceId: string | null;
  reason: string;
  createdAt: string;
}
export interface PartnerPromotionContract {
  name: string;
  partnerNo: string;
  promotionCode: string;
  linkUrl: string;
  qrDataUrl: string;
  active: boolean;
}

/** Display current cooperation wording without rewriting historic transaction snapshots. */
export function partnerLevelName(name: string | null | undefined): string {
  return (
    (
      {
        一级分销: "战略合作",
        二级分销: "核心合作",
        三级分销: "优选合作",
      } as Record<string, string>
    )[name ?? ""] ?? (name || "—").replace(/分销/g, "合作")
  );
}
