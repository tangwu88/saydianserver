import { parseSayRingIosHealthDisplay, sayRingIosHealthDisplayOrClosed, sayRingIosHealthSettingKey } from "@saydian/app-contracts";
import type { PrismaService } from "../common/prisma.service";
import { writeAuditedDisplaySetting } from "./audited-display-setting";

export function writeSayRingIosHealthDisplay(prisma: PrismaService, actorId: string | undefined, input: unknown, rollback = false) {
  return writeAuditedDisplaySetting(prisma, actorId, input, {
    key: sayRingIosHealthSettingKey, label: "只读健康显示", action: "SAY_RING_IOS_HEALTH_DISPLAY",
    parse: parseSayRingIosHealthDisplay, orClosed: sayRingIosHealthDisplayOrClosed,
  }, rollback);
}
