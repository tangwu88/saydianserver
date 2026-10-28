import { NotFoundException } from "@nestjs/common";
import { sayRingIosModuleDisplayOrClosed, sayRingIosModuleSettingKey, type SayRingModule } from "@saydian/app-contracts";
import type { PrismaService } from "./prisma.service";

export async function sayRingIosModuleVisibility(prisma: PrismaService) {
  let value: unknown;
  try {
    const setting = await prisma.appSetting.findFirst({
      where: { key: sayRingIosModuleSettingKey, public: true }, select: { value: true },
    });
    value = setting?.value;
  } catch { /* Read failure closes only these modules, not the health lease. */ }
  return { ...sayRingIosModuleDisplayOrClosed(value), validForSeconds: 300 };
}

export async function assertSayRingModuleVisible(prisma: PrismaService, module: SayRingModule, product?: string, platform?: string) {
  // Caller-declared scope is not a trusted app identity or account permission.
  if (product !== "say-ring" || !["ios", "android", "harmonyos"].includes(platform ?? "")) return;
  if (!(await sayRingIosModuleVisibility(prisma)).modules[module])
    throw new NotFoundException("功能暂未开放");
}
