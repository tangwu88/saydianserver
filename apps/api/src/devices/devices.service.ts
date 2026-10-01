import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma.service";
import { safeObject, sha256 } from "../common/crypto";

function normalizedMacAddress(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (!/^[0-9a-f]{12}$/i.test(raw) && !/^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(raw)) {
    throw new BadRequestException("MAC 地址格式不正确");
  }
  const compact = raw.replace(/[:-]/g, "");
  const normalized = compact.match(/.{2}/g)?.join(":").toUpperCase() ?? "";
  if (!/^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(normalized)) {
    throw new BadRequestException("MAC 地址格式不正确");
  }
  return normalized;
}

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  async bind(userId: string, input: unknown) {
    const body = safeObject(input);
    const sourceId = String(body.deviceId ?? body.hardwareId ?? "").trim();
    const vendor = String(body.vendor ?? "").trim();
    const model = String(body.model ?? "").trim();
    const displayName = String(body.displayName ?? body.name ?? model).trim();
    const macAddress = normalizedMacAddress(body.macAddress);
    if (!sourceId || !vendor || !model || !displayName) {
      throw new BadRequestException("设备信息不完整");
    }
    const capabilities = Array.isArray(body.capabilities)
      ? [...new Set(body.capabilities.map(String).map((item) => item.trim()).filter(Boolean))]
      : [];
    if (capabilities.length > 200) throw new BadRequestException("设备能力数量异常");
    const hardwareKey = sha256(`${userId}:${sourceId}`);
    const firmware = body.firmware ? String(body.firmware).trim() : null;
    const syncCursor = body.syncCursor ? String(body.syncCursor).trim() : null;
    const connectedAt = new Date();
    const device = await this.prisma.$transaction(async (tx) => {
      const binding = await tx.deviceBinding.upsert({
        where: { hardwareKey },
        create: {
          userId,
          hardwareKey,
          vendor,
          model,
          displayName,
          macAddress,
          firmware,
          capabilities: capabilities as Prisma.InputJsonValue,
          syncCursor,
          lastSeenAt: connectedAt,
        },
        update: {
          userId,
          vendor,
          model,
          displayName,
          ...(macAddress ? { macAddress } : {}),
          ...(firmware ? { firmware } : {}),
          capabilities: capabilities as Prisma.InputJsonValue,
          syncCursor,
          unboundAt: null,
          lastSeenAt: connectedAt,
        },
      });
      await tx.deviceConnectionEvent.create({
        data: {
          deviceBindingId: binding.id,
          connectedAt,
          vendor,
          model,
          displayName,
          macAddress,
          firmware,
        },
      });
      return binding;
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
    macAddress: string | null;
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
      macAddress: device.macAddress,
      firmware: device.firmware,
      capabilities: Array.isArray(device.capabilities) ? device.capabilities : [],
      syncCursor: device.syncCursor,
      lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
    };
  }
}
