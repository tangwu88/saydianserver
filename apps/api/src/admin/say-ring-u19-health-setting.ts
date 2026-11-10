import { parseSayRingU19Health, sayRingU19HealthOrClosed, sayRingU19HealthSettingKey } from "@saydian/app-contracts";
import type { PrismaService } from "../common/prisma.service";
import { writeAuditedDisplaySetting } from "./audited-display-setting";
/** 只写独立 U19 项：沿用原后台角色、版本锁及事务审计。 */
export function writeSayRingU19Health(prisma: PrismaService, actorId: string | undefined, input: unknown) {
  return writeAuditedDisplaySetting(prisma, actorId, input, {
    key: sayRingU19HealthSettingKey, label: "U19 健康功能", action: "SAY_RING_U19_HEALTH",
    parse: parseSayRingU19Health, orClosed: sayRingU19HealthOrClosed,
  });
}
