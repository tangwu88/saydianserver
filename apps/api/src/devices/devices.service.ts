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

function escapedRawPayloadPart(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

function serializedRawPayload(body: Record<string, unknown>): string {
  const rawPayload = Object.entries(body)
    .map(([key, value]) => {
      const rendered = typeof value === "string" ? value : JSON.stringify(value);
      return `${escapedRawPayloadPart(key)}=${escapedRawPayloadPart(rendered ?? "")}`;
    })
    .join(" | ");
  if (Buffer.byteLength(rawPayload, "utf8") > 65_535) {
    throw new BadRequestException("设备上报原始数据过大");
  }
  return rawPayload;
}

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 只读确认：此会员在这枚戒指首次入库前是否已有其他终生绑定。
   * 不能重放首次清空授权，也不靠最近连接、名字或当前绑定数量推断。
   * 找不到精确目标或时间无法严格排序时，继续保持未确认。
   */
  async bindingHistoryStatus(userId: string, product: string, deviceId: string) {
    const sourceId = String(deviceId ?? "").trim();
    if (product !== "say-ring" || !sourceId || sourceId.length > 512) {
      throw new BadRequestException("请提供明确的 Say Ring 设备标识");
    }
    const hardwareKey = sha256(`${userId}:${sourceId}`);
    const target = await this.prisma.deviceBinding.findFirst({
      where: { userId, hardwareKey },
      select: { id: true, createdAt: true },
    });
    // PostgreSQL 的事务时间可能早于等待会员行锁的时间。
    // 只接受早于目标 30 秒的既有记录，覆盖下面显式限制的 2 秒排队+
    // 5 秒事务窗口，避免并发首绑的写入顺序与时间顺序不同而误确认。
    const before = target?.createdAt instanceof Date
      ? new Date(target.createdAt.getTime() - 30_000)
      : undefined;
    const earlier = before instanceof Date && Number.isFinite(before.getTime())
      ? await this.prisma.deviceBinding.findFirst({
        where: {
          userId,
          id: { not: target!.id },
          createdAt: { lt: before },
        },
        select: { id: true },
      })
      : null;
    // 不过滤 unboundAt：解绑不应让老会员重新获得清空戒指的资格。
    return { product: "say-ring", deviceId: sourceId, priorBindingConfirmed: !!earlier };
  }

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
    const rawPayload = serializedRawPayload(body);
    const initializeFirstBinding = body.product === "say-ring" &&
      body.initializeFirstBinding === true;
    const connectedAt = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      // Serialize ALL reports, including old clients, for this member. Count
      // lifetime bindings, not just currently bound devices. A lost response
      // deliberately cannot issue a second destructive initialization grant.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
      const firstBinding = initializeFirstBinding &&
        await tx.deviceBinding.count({ where: { userId } }) === 0;
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
          rawPayload,
        },
      });
      return { binding, firstBinding };
    }, { maxWait: 2_000, timeout: 5_000 });
    return {
      ...this.contract(result.binding),
      ...(initializeFirstBinding ? {
        firstBindingInitialization: {
          product: "say-ring", deviceId: sourceId,
          shouldClear: result.firstBinding,
        },
      } : {}),
    };
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
