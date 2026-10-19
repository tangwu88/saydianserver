import { sayRingIosHealthDisplayOrClosed, sayRingIosModuleDisplayOrClosed } from "@saydian/app-contracts";
import type { PrismaService } from "../common/prisma.service";

export async function cnDisplaySections(prisma: PrismaService) {
  const read = async (key: string) => {
    try { return (await prisma.appSetting.findFirst({ where: { key, public: true }, select: { value: true } }))?.value; }
    catch { return undefined; }
  };
  const [health, modules] = await Promise.all([read("cn_health_display"), read("cn_module_display")]);
  return {
    readOnlyHealth: { ...sayRingIosHealthDisplayOrClosed(health), validForSeconds: 300 },
    moduleVisibility: { ...sayRingIosModuleDisplayOrClosed(modules), validForSeconds: 300 },
  };
}
