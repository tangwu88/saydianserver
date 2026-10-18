import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { parseSayRingIosHealthDisplay, sayRingIosHealthDisplayOrClosed, sayRingIosHealthSettingKey } from "@saydian/app-contracts";
import type { PrismaService } from "../common/prisma.service";
import { safeObject } from "../common/crypto";

// Only non-sensitive boolean snapshots enter this audit. A failed audit rolls
// back the setting too; the advisory lock and revision prevent lost updates.
export async function writeSayRingIosHealthDisplay(prisma: PrismaService, actorId: string | undefined, input: unknown, rollback = false) {
  if (!actorId) throw new ForbiddenException("请先登录后台");
  const body = safeObject(input);
  if (body.public === false) throw new BadRequestException("只读健康显示设置必须公开");
  const expected = body.expectedUpdatedAt;
  if (expected !== null && (typeof expected !== "string" || !Number.isFinite(Date.parse(expected))))
    throw new BadRequestException("请刷新设置后重试");
  let next;
  if (!rollback) {
    try { next = parseSayRingIosHealthDisplay(body.value); }
    catch (error) { throw new BadRequestException((error as Error).message); }
  }
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${sayRingIosHealthSettingKey}, 0))`;
    const current = await tx.appSetting.findUnique({ where: { key: sayRingIosHealthSettingKey } });
    if ((current?.updatedAt.toISOString() ?? null) !== expected)
      throw new ConflictException("设置已被更新，请刷新后重试");
    const before = sayRingIosHealthDisplayOrClosed(current?.public ? current.value : undefined);
    if (rollback) {
      const audit = await tx.auditLog.findFirst({
        where: { entityType: "APP_SETTING", entityId: sayRingIosHealthSettingKey, action: { in: ["SAY_RING_IOS_HEALTH_DISPLAY_UPDATED", "SAY_RING_IOS_HEALTH_DISPLAY_ROLLED_BACK"] } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      if (!audit) throw new NotFoundException("没有可恢复的上次配置");
      // Refuse legacy/untracked changes rather than restoring an unrelated state.
      if (JSON.stringify(sayRingIosHealthDisplayOrClosed(audit.afterJson)) !== JSON.stringify(before))
        throw new ConflictException("配置与审计不一致，请先核查");
      try { next = parseSayRingIosHealthDisplay(audit.beforeJson); }
      catch { throw new ConflictException("上次配置无效，不能恢复"); }
    }
    const value = next! as unknown as Prisma.InputJsonValue;
    const updatedAt = new Date(Math.max(Date.now(), (current?.updatedAt.getTime() ?? 0) + 1));
    const saved = await tx.appSetting.upsert({
      where: { key: sayRingIosHealthSettingKey },
      create: { key: sayRingIosHealthSettingKey, value, public: true, updatedAt },
      update: { value, public: true, updatedAt },
    });
    await tx.auditLog.create({ data: {
      actorType: "ADMIN", actorId,
      action: rollback ? "SAY_RING_IOS_HEALTH_DISPLAY_ROLLED_BACK" : "SAY_RING_IOS_HEALTH_DISPLAY_UPDATED",
      entityType: "APP_SETTING", entityId: sayRingIosHealthSettingKey,
      beforeJson: before as unknown as Prisma.InputJsonValue, afterJson: value,
      createdAt: saved.updatedAt,
    } });
    return saved;
  });
}
