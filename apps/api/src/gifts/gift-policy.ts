import { BadRequestException, ConflictException } from "@nestjs/common";
import { randomBytes, randomInt } from "node:crypto";
import { safeObject, sha256 } from "../common/crypto";

export const giftSessionMs = 30 * 60_000;
export const giftVerificationMs = 15 * 60_000;
export const giftSecret = () => String(randomInt(100000, 1000000));
export function formatGiftCardNo(productCode: number, serial: number) {
  if (
    !Number.isInteger(productCode) ||
    productCode < 1 ||
    productCode > 99 ||
    !Number.isInteger(serial) ||
    serial < 1 ||
    serial > 99999
  )
    throw new ConflictException("商品编号或卡号流水已用完，不能继续发卡");
  return (
    "8" + String(productCode).padStart(2, "0") + String(serial).padStart(5, "0")
  );
}
export const giftNumber = (prefix: string) =>
  prefix + Date.now() + randomBytes(5).toString("hex").toUpperCase();
export function giftCardNumber(value: unknown) {
  const text = String(value ?? "")
    .replace(/[\s-]/g, "")
    .toUpperCase();
  if (!/^8\d{7}$/.test(text))
    throw new BadRequestException("卡号或校验码不正确");
  return text;
}
export function giftCheckCode(value: unknown) {
  const text = String(value ?? "")
    .replace(/[\s-]/g, "")
    .toUpperCase();
  if (!/^\d{6}$/.test(text))
    throw new BadRequestException("卡号或校验码不正确");
  return text;
}
export function giftRequestKey(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(value))
    throw new BadRequestException("缺少有效请求编号，请刷新后重试");
  return value;
}
export function giftPayloadHash(value: unknown) {
  return sha256(JSON.stringify(value));
}
export function assertGiftAvailable(
  card: { status: string; expiresAt: Date | null },
  now = new Date(),
) {
  if (card.status === "DRAFT")
    throw new ConflictException("兑换卡尚未启用，请联系发卡方");
  if (card.status === "REDEEMED")
    throw new ConflictException("该卡已兑换，请登录兑换手机号查看订单");
  if (card.status !== "ACTIVE")
    throw new ConflictException("兑换卡已作废，请联系发卡方");
  if (card.expiresAt && card.expiresAt <= now)
    throw new ConflictException("兑换卡已过期，请联系发卡方");
}
export function giftBinding(input: unknown) {
  const body = safeObject(input),
    productId = String(body.productId ?? "");
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (
    !uuid.test(productId) ||
    !Array.isArray(body.allowedSkuIds) ||
    !body.allowedSkuIds.length ||
    body.allowedSkuIds.length > 200 ||
    body.allowedSkuIds.some((id) => typeof id !== "string" || !uuid.test(id))
  )
    throw new BadRequestException("请选择商品和允许兑换的规格");
  const allowedSkuIds = [...new Set(body.allowedSkuIds as string[])].sort();
  const expiresAt = body.expiresAt ? new Date(String(body.expiresAt)) : null;
  if (
    expiresAt &&
    (!Number.isFinite(expiresAt.valueOf()) || expiresAt <= new Date())
  )
    throw new BadRequestException("有效期必须晚于当前时间");
  return { productId, allowedSkuIds, expiresAt };
}
export function giftCsv(rows: Array<Array<unknown>>) {
  const cell = (value: unknown) => {
    let text = String(value ?? "");
    if (/^[\s]*[=+@\-\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  return "\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n");
}
export function giftPublicCard(card: {
  id: string;
  number: number;
  cardNo: string;
  status: string;
  productId: string;
  allowedSkuIds: string[];
  expiresAt: Date | null;
  version: number;
  batchId: string;
  createdAt: Date;
}) {
  return {
    id: card.id,
    serialNo: String(card.number),
    cardNo: card.cardNo,
    status:
      card.expiresAt && card.expiresAt <= new Date() && card.status === "ACTIVE"
        ? "EXPIRED"
        : card.status,
    productId: card.productId,
    allowedSkuIds: card.allowedSkuIds,
    expiresAt: card.expiresAt,
    version: card.version,
    batchId: card.batchId,
    createdAt: card.createdAt,
  };
}
