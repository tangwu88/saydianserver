import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { priceOrder } from "./commerce-finance";

/** Conditional price equality, not a reservation or an authorization token. */
export function commerceQuoteFingerprint(quote: ReturnType<typeof priceOrder>): string {
  const lines = [...quote.lines].sort((a, b) => a.skuId < b.skuId ? -1 : a.skuId > b.skuId ? 1 : 0);
  const values = [quote.pricingVersion, quote.subtotalCents, quote.couponDiscountCents, quote.pointDiscountCents,
    quote.shippingCents, quote.payableCents, lines.map(line => [line.skuId, line.quantity, line.unitPriceCents,
      line.totalCents, line.couponDiscountCentsSnapshot, line.pointDiscountCentsSnapshot, line.cashPaidCentsSnapshot])];
  return "q1:" + createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

export function optionalExpectedQuote(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^q1:[a-f0-9]{64}$/.test(value)) {
    throw new BadRequestException("报价凭据无效，请重新获取报价");
  }
  return value;
}
