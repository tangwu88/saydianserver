import { BadRequestException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { isGlobalRealm } from "../common/deployment-realm";

export const evidencePurpose = "commerce_after_sale";
export const evidenceLimits = { maxFiles: 9, maxBytes: 10 * 1024 * 1024, contentTypes: ["image/jpeg", "image/png", "image/webp"] };
export const evidenceId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);

/** No SVG/HTML, MIME-only masquerading, or trusting client file-size metadata. */
export function validateEvidenceImage(file: Express.Multer.File | undefined) {
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length < 12 || file.buffer.length > evidenceLimits.maxBytes || file.size !== file.buffer.length) throw new BadRequestException("图片须为非空文件，且不能超过10MB");
  const b = file.buffer;
  const jpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9;
  const png = b.length >= 45 && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && b.readUInt32BE(8) === 13 && b.toString("ascii", 12, 16) === "IHDR" && b.readUInt32BE(16) > 0 && b.readUInt32BE(20) > 0 && b.readUInt32BE(16) <= 16384 && b.readUInt32BE(20) <= 16384 && b.subarray(-12).equals(Buffer.from([0,0,0,0,73,69,78,68,174,66,96,130]));
  const webp = b.length >= 20 && b.toString("ascii", 0, 4) === "RIFF" && b.readUInt32LE(4) + 8 === b.length && b.toString("ascii", 8, 12) === "WEBP" && ["VP8 ", "VP8L", "VP8X"].includes(b.toString("ascii", 12, 16));
  const detected = png ? "image/png" : jpeg ? "image/jpeg" : webp ? "image/webp" : null;
  if (!detected || detected !== file.mimetype) throw new BadRequestException("图片内容与格式不符，请选择有效的 JPG、PNG 或 WebP 图片");
  return detected;
}

export async function afterSaleEvidenceReferences(db: Pick<Prisma.TransactionClient, "fileObject">, userId: string, body: Record<string, unknown>): Promise<string[]> {
  if (body.evidenceFileIds === undefined) {
    if (isGlobalRealm() && Array.isArray(body.evidenceImages) && body.evidenceImages.length) throw new BadRequestException("请先上传售后图片，不能提交外部图片地址");
    // Existing domestic App request shape remains compatible. New uploads use IDs.
    return Array.isArray(body.evidenceImages) ? body.evidenceImages.map(String).slice(0, 9) : [];
  }
  const ids = body.evidenceFileIds;
  if (!Array.isArray(ids) || ids.length > evidenceLimits.maxFiles || ids.some(id => !evidenceId(id)) || new Set(ids).size !== ids.length) throw new BadRequestException("售后图片编号无效，最多选择9张不同图片");
  if (Array.isArray(body.evidenceImages) && body.evidenceImages.length) throw new BadRequestException("不能同时提交图片编号和外部图片地址");
  if (!ids.length) return [];
  const count = await db.fileObject.count({ where: { id: { in: ids }, ownerUserId: userId, purpose: evidencePurpose, status: "ACTIVE", contentType: { in: evidenceLimits.contentTypes }, byteSize: { gt: 0, lte: evidenceLimits.maxBytes } } });
  if (count !== ids.length) throw new BadRequestException("售后图片不存在或不属于当前会员，请重新上传");
  return ids.map(id => `file:${id}`);
}
