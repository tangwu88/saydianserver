import { parseSayRingIosHealthDisplay, sayRingIosHealthDisplayOrClosed, parseSayRingIosModuleDisplay, sayRingIosModuleDisplayOrClosed } from "@saydian/app-contracts";
import type { PrismaService } from "../common/prisma.service";
import { writeAuditedDisplaySetting } from "./audited-display-setting";

export const cnDisplayDefinitions = {
  cn_health_display: { key: "cn_health_display", label: "赛电健康只读指标", action: "CN_HEALTH_DISPLAY", parse: parseSayRingIosHealthDisplay, orClosed: sayRingIosHealthDisplayOrClosed },
  cn_module_display: { key: "cn_module_display", label: "赛电健康百科与商城", action: "CN_MODULE_DISPLAY", parse: parseSayRingIosModuleDisplay, orClosed: sayRingIosModuleDisplayOrClosed },
};

export function writeCnDisplaySetting(prisma: PrismaService, actorId: string | undefined, key: keyof typeof cnDisplayDefinitions, input: unknown, rollback = false) {
  // Share the validated shape and audited transaction, never the product key.
  if (key === "cn_health_display") return writeAuditedDisplaySetting(prisma, actorId, input, cnDisplayDefinitions.cn_health_display, rollback);
  return writeAuditedDisplaySetting(prisma, actorId, input, cnDisplayDefinitions.cn_module_display, rollback);
}
