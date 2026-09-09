import { BadRequestException, ConflictException } from "@nestjs/common";

export const afterSaleTransitions: Record<string, readonly string[]> = {
  APPLIED: ["REVIEWING", "APPROVED", "REJECTED", "CANCELLED"],
  REVIEWING: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["WAITING_RETURN"],
  WAITING_RETURN: ["RETURNED"],
  RETURNED: [], REFUNDING: [], COMPLETED: [], REJECTED: [], CANCELLED: [],
};

export function assertAfterSaleTransition(current: string, next: string): void {
  if (current === next) return;
  if (!afterSaleTransitions[current]?.includes(next)) {
    throw new ConflictException(`售后不能从 ${current} 转为 ${next}，请刷新后按当前流程处理`);
  }
}

export function requireCommerceOwner(owner: string): void {
  if (owner !== "NEW_SYSTEM") throw new ConflictException("该业务尚未完成迁移接管验收，请稍后重试");
}

export function integerCents(value: unknown, label: string, minimum = 0): number {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") {
    throw new BadRequestException(`${label}必须填写有效整数`);
  }
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < minimum || amount > 2_147_483_647) {
    throw new BadRequestException(`${label}必须是${minimum ? "正" : "非负"}整数且不超过2147483647`);
  }
  return amount;
}

export function expectedVersion(value: unknown): number {
  if (value === undefined) throw new BadRequestException("缺少记录版本，请刷新后重试");
  return integerCents(value, "版本");
}

export function pointFaceValueCents(value: unknown): number {
  const text = String(value ?? "0").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new BadRequestException("积分抵扣金额最多保留两位小数");
  const [whole = "0", fraction = ""] = text.split(".");
  return integerCents(Number(whole) * 100 + Number(fraction.padEnd(2, "0")), "积分抵扣");
}

/** Allocate discounts proportionally; the final line receives rounding residue. */
export function merchandiseAllocations(
  items: Array<{ id: string; totalCents: number }>,
  merchandiseCents: number,
): Map<string, number> {
  const subtotal = items.reduce((sum, item) => sum + item.totalCents, 0);
  const available = Math.max(0, Math.min(merchandiseCents, subtotal));
  let remainder = available;
  return new Map(items.map((item, index) => {
    const amount = index === items.length - 1 ? remainder
      : subtotal ? Number(BigInt(available) * BigInt(item.totalCents) / BigInt(subtotal)) : 0;
    remainder -= amount;
    return [item.id, amount];
  }));
}
