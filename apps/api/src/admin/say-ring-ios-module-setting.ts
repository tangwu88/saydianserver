import { parseSayRingIosModuleDisplay, sayRingIosModuleDisplayOrClosed, sayRingIosModuleSettingKey } from "@saydian/app-contracts";
import type { PrismaService } from "../common/prisma.service";
import { writeAuditedDisplaySetting } from "./audited-display-setting";

export function writeSayRingIosModuleDisplay(prisma: PrismaService, actorId: string | undefined, input: unknown, rollback = false) {
  return writeAuditedDisplaySetting(prisma, actorId, input, {
    key: sayRingIosModuleSettingKey, label: "模块显示", action: "SAY_RING_IOS_MODULE_DISPLAY",
    parse: parseSayRingIosModuleDisplay, orClosed: sayRingIosModuleDisplayOrClosed,
  }, rollback);
}
