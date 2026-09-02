import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma.service";
import { safeObject, sha256 } from "../common/crypto";

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  async bind(userId: string, input: unknown) {
    const body = safeObject(input);
    const sourceId = String(body.deviceId ?? body.hardwareId ?? "").trim();
    const vendor = String(body.vendor ?? "").trim();
    const model = String(body.model ?? "").trim();
    const displayName = String(body.displayName ?? body.name ?? model).trim();
    if (!sourceId || !vendor || !model || !displayName) {
      throw new BadRequestException("设备信息不完整");
    }
    const capabilities = Array.isArray(body.capabilities)
      ? [...new Set(body.capabilities.map(String).map((item) => item.trim()).filter(Boolean))]
      : [];
    if (capabilities.length > 200) throw new BadRequestException("设备能力数量异常");
    const hardwareKey = sha256(`${userId}:${sourceId}`);
    const device = await this.prisma.deviceBinding.upsert({
      where: { hardwareKey },
      create: {
        userId,
        hardwareKey,
        vendor,
        model,
        displayName,
        firmware: body.firmware ? String(body.firmware) : null,
        capabilities: capabilities as Prisma.InputJsonValue,
        syncCursor: body.syncCursor ? String(body.syncCursor) : null,
        lastSeenAt: new Date(),
      },
      update: {
        userId,
        vendor,
        model,
        displayName,
        firmware: body.firmware ? String(body.firmware) : null,
        capabilities: capabilities as Prisma.InputJsonValue,
        syncCursor: body.syncCursor ? String(body.syncCursor) : null,
        unboundAt: null,
        lastSeenAt: new Date(),
      },
    });
    return this.contract(device);
  }

  async list(userId: string) {
    const devices = await this.prisma.deviceBinding.findMany({
      where: { userId, unboundAt: null },
      orderBy: { lastSeenAt: "desc" },
    });
    return devices.map((item) => this.contract(item));
  }

  async updateCapabilities(userId: string, id: string, input: unknown) {
    const body = safeObject(input);
    const capabilities = Array.isArray(body.capabilities)
      ? [...new Set(body.capabilities.map(String).map((item) => item.trim()).filter(Boolean))]
      : [];
    const device = await this.prisma.deviceBinding.findFirst({ where: { id, userId } });
    if (!device || device.unboundAt) throw new NotFoundException("未找到已连接的设备");
    return this.contract(
      await this.prisma.deviceBinding.update({
        where: { id },
        data: {
          capabilities: capabilities as Prisma.InputJsonValue,
          firmware: body.firmware ? String(body.firmware) : device.firmware,
          syncCursor: body.syncCursor ? String(body.syncCursor) : device.syncCursor,
          lastSeenAt: new Date(),
        },
      }),
    );
  }

  async unbind(userId: string, id: string) {
    const result = await this.prisma.deviceBinding.updateMany({
      where: { id, userId, unboundAt: null },
      data: { unboundAt: new Date() },
    });
    if (!result.count) throw new NotFoundException("未找到已连接的设备");
    return { unbound: true };
  }

  private contract(device: {
    id: string;
    hardwareKey: string;
    vendor: string;
    model: string;
    displayName: string;
    firmware: string | null;
    capabilities: Prisma.JsonValue;
    syncCursor: string | null;
    lastSeenAt: Date | null;
  }) {
    return {
      id: device.id,
      hardwareKey: device.hardwareKey,
      vendor: device.vendor,
      model: device.model,
      displayName: device.displayName,
      firmware: device.firmware,
      capabilities: Array.isArray(device.capabilities) ? device.capabilities : [],
      syncCursor: device.syncCursor,
      lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
    };
  }
}
