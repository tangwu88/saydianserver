import { BadRequestException } from "@nestjs/common";
import { CommerceOrderStatus } from "@prisma/client";

type OrderFilter = { status?: CommerceOrderStatus | { in: CommerceOrderStatus[] }; afterSales?: { some: Record<string, never> } };

/** UI groups are opt-in: older consumers retain exact status filtering. */
export function commerceOrderListFilter(statusInput?: string, groupInput?: string): OrderFilter {
  if (groupInput && groupInput !== "pending_shipment" && groupInput !== "after_sales") throw new BadRequestException("订单分组不正确");
  if (statusInput && groupInput) throw new BadRequestException("订单状态与分组不能同时指定");
  if (groupInput === "pending_shipment") return { status: { in: [CommerceOrderStatus.PAID, CommerceOrderStatus.WAITING_FULFILLMENT] } };
  if (groupInput === "after_sales") return { afterSales: { some: {} } };
  if (!statusInput) return {};
  const status = String(statusInput).trim().toUpperCase();
  if (!Object.values(CommerceOrderStatus).some(value => value === status)) throw new BadRequestException("订单状态不正确");
  return { status: status as CommerceOrderStatus };
}
