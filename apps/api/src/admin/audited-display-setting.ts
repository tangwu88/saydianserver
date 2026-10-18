import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { PrismaService } from "../common/prisma.service";
import { safeObject } from "../common/crypto";

export interface AuditedDisplaySetting<T> {
  key: string;
  label: string;
  action: string;
  parse(input: unknown): T;
  orClosed(input?: unknown): T;
}

// Fixed server definitions share the transaction, revision and audit protocol.
export async function writeAuditedDisplaySetting<T>(prisma: PrismaService, actorId: string | undefined, input: unknown, definition: AuditedDisplaySetting<T>, rollback = false) {
  if (!actorId) throw new ForbiddenException("请先登录后台");
  const body = safeObject(input);
  if (body.public === false) throw new BadRequestException(`${definition.label}设置必须公开`);
  const expected = body.expectedUpdatedAt;
  if (expected !== null && (typeof expected !== "string" || !Number.isFinite(Date.parse(expected))))
    throw new BadRequestException("请刷新设置后重试");
  let next: T | undefined;
  if (!rollback) {
    try { next = definition.parse(body.value); }
    catch (error) { throw new BadRequestException((error as Error).message); }
  }
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${definition.key}, 0))`;
    const current = await tx.appSetting.findUnique({ where: { key: definition.key } });
    if ((current?.updatedAt.toISOString() ?? null) !== expected)
      throw new ConflictException("设置已被更新，请刷新后重试");
    const before = definition.orClosed(current?.public ? current.value : undefined);
    if (rollback) {
      const audit = await tx.auditLog.findFirst({
        where: { entityType: "APP_SETTING", entityId: definition.key, action: { in: [`${definition.action}_UPDATED`, `${definition.action}_ROLLED_BACK`] } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      if (!audit) throw new NotFoundException("没有可恢复的上次配置");
      let actual: T, audited: T;
      try {
        if (!current?.public) throw new Error("untracked publication");
        actual = definition.parse(current.value);
        audited = definition.parse(audit.afterJson);
      } catch { throw new ConflictException("配置与审计不一致，请先核查"); }
      if (JSON.stringify(audited) !== JSON.stringify(actual))
        throw new ConflictException("配置与审计不一致，请先核查");
      try { next = definition.parse(audit.beforeJson); }
      catch { throw new ConflictException("上次配置无效，不能恢复"); }
    }
    const value = next! as unknown as Prisma.InputJsonValue;
    const updatedAt = new Date(Math.max(Date.now(), (current?.updatedAt.getTime() ?? 0) + 1));
    const saved = await tx.appSetting.upsert({
      where: { key: definition.key },
      create: { key: definition.key, value, public: true, updatedAt },
      update: { value, public: true, updatedAt },
    });
    await tx.auditLog.create({ data: {
      actorType: "ADMIN", actorId,
      action: `${definition.action}_${rollback ? "ROLLED_BACK" : "UPDATED"}`,
      entityType: "APP_SETTING", entityId: definition.key,
      beforeJson: before as unknown as Prisma.InputJsonValue, afterJson: value,
      createdAt: saved.updatedAt,
    } });
    return saved;
  });
}
